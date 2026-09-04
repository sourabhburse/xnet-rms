package main

import (
	"embed"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"niseva-rms/backend/internal/alerts"
	"niseva-rms/backend/internal/auth"
	"niseva-rms/backend/internal/configs"
	"niseva-rms/backend/internal/database"
	"niseva-rms/backend/internal/deployments"
	"niseva-rms/backend/internal/devices"
	"niseva-rms/backend/internal/models"
	"niseva-rms/backend/internal/mqtt"
	"niseva-rms/backend/internal/telemetry"
	"niseva-rms/backend/internal/tenant"
	"niseva-rms/backend/internal/tunnel"
)

//go:embed dist/*
var staticFS embed.FS

func main() {
	log.Println("==================================================")
	log.Println(" Starting XNET Cloud RMS Enterprise Server (Go)")
	log.Println("==================================================")

	// 1. Initialize PostgreSQL Database
	db, err := database.InitDB()
	if err != nil {
		log.Printf("[WARN] Database connection pending or offline: %v (running with fallback)", err)
	}
	_ = db

	// 2. Initialize MQTT Broker Connection asynchronously
	go func() {
		if err := mqtt.InitMQTT(); err != nil {
			log.Printf("[WARN] MQTT broker connection pending: %v (will retry)", err)
		}
	}()

	// 3. Setup Gin HTTP Engine
	r := gin.Default()

	// Enable CORS for frontend development
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization"}
	r.Use(cors.New(config))

	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "UP", "version": "1.0.0", "service": "xnet-rms"})
	})

	// -------------------------------------------------------------
	// PUBLIC ROUTER BOOTSTRAP & INTERNAL BROKER WEBHOOKS
	// -------------------------------------------------------------
	r.POST("/api/v1/provision/check-in", devices.RouterCheckIn)
	r.POST("/api/v1/internal/mqtt/auth", devices.InternalMqttAuth)

	// -------------------------------------------------------------
	// RMS CONNECT WEBSOCKET & TUNNEL GATEWAYS
	// -------------------------------------------------------------
	r.GET("/tunnel-inlet/:token", tunnel.RouterInletWS)
	r.GET("/connect/terminal/:token", tunnel.BrowserOutletWS)
	r.Any("/connect/luci/:token/*path", tunnel.HttpProxyHandler)

	// -------------------------------------------------------------
	// AUTHENTICATION ROUTES
	// -------------------------------------------------------------
	r.POST("/api/v1/auth/login", func(c *gin.Context) {
		var req struct {
			Email    string `json:"email" binding:"required"`
			Password string `json:"password" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Email and password required"})
			return
		}

		if database.DB == nil {
			// Demo / offline fallback authentication
			if req.Email == "admin@niseva.com" && req.Password == "Admin@12345" {
				token, _ := auth.GenerateToken(&models.User{
					ID:             "admin-01",
					Email:          "admin@niseva.com",
					Role:           models.RoleSuperAdmin,
					OrganizationID: "org-01",
				})
				c.JSON(http.StatusOK, gin.H{
					"token": token,
					"user": gin.H{
						"id":              "admin-01",
						"email":           "admin@niseva.com",
						"first_name":      "System",
						"last_name":       "Admin",
						"role":            "SUPER_ADMIN",
						"organization_id": "org-01",
					},
				})
				return
			}
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
			return
		}

		var user models.User
		if err := database.DB.Where("email = ?", req.Email).First(&user).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
			return
		}

		if !auth.CheckPassword(req.Password, user.PasswordHash) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
			return
		}

		token, err := auth.GenerateToken(&user)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"token": token,
			"user": gin.H{
				"id":              user.ID,
				"email":           user.Email,
				"first_name":      user.FirstName,
				"last_name":       user.LastName,
				"role":            user.Role,
				"organization_id": user.OrganizationID,
			},
		})
	})

	// -------------------------------------------------------------
	// PROTECTED MULTI-TENANT API ROUTES
	// -------------------------------------------------------------
	api := r.Group("/api/v1")
	api.Use(auth.AuthMiddleware())
	{
		// Current User Context
		api.GET("/auth/me", func(c *gin.Context) {
			claims, _ := c.Get("claims")
			c.JSON(http.StatusOK, claims)
		})

		// Dashboard Summary
		api.GET("/dashboard/summary", telemetry.GetDashboardSummary)

		// Device & Hardware Product Models
		api.GET("/products", devices.ListProducts)
		api.GET("/devices", devices.ListDevices)
		api.GET("/devices/:id", devices.GetDevice)
		api.POST("/devices/claim", devices.ClaimDevice)
		api.GET("/devices/:id/telemetry", telemetry.GetDeviceTelemetry)

		// Router Commands
		api.POST("/devices/:id/reboot", func(c *gin.Context) {
			orgID := c.GetString("organization_id")
			deviceID := c.Param("id")

			if database.DB == nil {
				c.JSON(http.StatusOK, gin.H{"message": "Reboot command dispatched to router (demo mode)"})
				return
			}

			userRole := c.GetString("role")
			var device models.Device
			query := database.DB.Where("id = ?", deviceID)
			if userRole != "SUPER_ADMIN" && orgID != "" {
				query = query.Where("organization_id = ?", orgID)
			}
			if err := query.First(&device).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
				return
			}

			err := mqtt.DispatchCommand(device.SerialNumber, "reboot", map[string]interface{}{
				"delay_seconds": 3,
			})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to dispatch reboot command"})
				return
			}

			database.DB.Model(&device).Update("status", models.DeviceStatusRebooting)
			c.JSON(http.StatusOK, gin.H{"message": "Reboot command dispatched to router " + device.SerialNumber})
		})

		// RMS Connect Tunnel Request
		api.POST("/tunnels/request", tunnel.RequestTunnel)

		// Config Profiles
		api.GET("/config-profiles", configs.ListProfiles)
		api.POST("/config-profiles", configs.CreateProfile)
		api.POST("/config-profiles/:id/push", configs.PushProfile)

		// FOTA & Packages
		api.GET("/firmware", deployments.ListFirmware)
		api.POST("/firmware", deployments.CreateFirmware)
		api.GET("/packages", deployments.ListPackages)
		api.GET("/deployments", deployments.ListRollouts)
		api.POST("/deployments/start", deployments.StartRollout)

		// Alerts & Rules
		api.GET("/alerts/rules", alerts.ListRules)
		api.GET("/alerts/incidents", alerts.ListIncidents)
		api.POST("/alerts/incidents/:id/acknowledge", alerts.AcknowledgeIncident)
		api.POST("/alerts/incidents/:id/resolve", alerts.ResolveIncident)
		api.POST("/alerts/test", alerts.TestWebhook)

		// Tenant, Security, Tokens & RBAC
		api.GET("/tenants", tenant.ListTenants)
		api.POST("/tenants", tenant.CreateTenant)
		api.GET("/enrollment-tokens", tenant.ListEnrollmentTokens)
		api.POST("/enrollment-tokens", tenant.CreateEnrollmentToken)
		api.DELETE("/enrollment-tokens/:id", tenant.DeleteEnrollmentToken)
		api.GET("/users", tenant.ListUsers)
		api.POST("/users", tenant.InviteUser)
		api.GET("/organization", tenant.GetOrganizationInfo)
		api.GET("/audit-logs", tenant.ListAuditLogs)
	}

	// -------------------------------------------------------------
	// EMBEDDED REACT UI STATIC FILE SERVER & SPA ROUTING
	// -------------------------------------------------------------
	subFS, err := fs.Sub(staticFS, "dist")
	if err == nil {
		fileServer := http.FileServer(http.FS(subFS))
		r.NoRoute(func(c *gin.Context) {
			path := c.Request.URL.Path

			if strings.HasPrefix(path, "/api") || strings.HasPrefix(path, "/tunnel") || strings.HasPrefix(path, "/connect") {
				c.JSON(http.StatusNotFound, gin.H{"error": "API endpoint not found"})
				return
			}

			cleanPath := strings.TrimPrefix(path, "/")
			if cleanPath != "" {
				if f, err := subFS.Open(cleanPath); err == nil {
					f.Close()
					fileServer.ServeHTTP(c.Writer, c.Request)
					return
				}
			}

			c.Header("Content-Type", "text/html; charset=utf-8")
			indexFile, err := subFS.Open("index.html")
			if err == nil {
				defer indexFile.Close()
				if seeker, ok := indexFile.(io.ReadSeeker); ok {
					http.ServeContent(c.Writer, c.Request, "index.html", time.Now(), seeker)
					return
				}
			}

			c.String(http.StatusNotFound, "XNET Cloud RMS UI could not be loaded")
		})
	}

	// 4. Start HTTP Server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("[HTTP] XNET Cloud RMS Server listening on port :%s\n", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Server failed to run: %v", err)
	}
}
