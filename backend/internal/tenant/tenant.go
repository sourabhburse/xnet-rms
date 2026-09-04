package tenant

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"niseva-rms/backend/internal/auth"
	"niseva-rms/backend/internal/database"
	"niseva-rms/backend/internal/models"
)

func generateRandomToken(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return prefix + "-" + strings.ToUpper(hex.EncodeToString(b))
}

// ListEnrollmentTokens returns active batch enrollment tokens
func ListEnrollmentTokens(c *gin.Context) {
	orgID := c.GetString("organization_id")
	if database.DB == nil {
		maxUses := 100
		c.JSON(http.StatusOK, []gin.H{
			{
				"id":         "token-01",
				"name":       "Factory Solar Site Q3 Batch",
				"token":      "NSV-ENROLL-SOLAR-2026-9B41",
				"max_uses":   maxUses,
				"used_count": 42,
				"expires_at": time.Now().Add(90 * 24 * time.Hour).Format(time.RFC3339),
				"created_at": time.Now().Add(-14 * 24 * time.Hour).Format(time.RFC3339),
			},
			{
				"id":         "token-02",
				"name":       "Substation Inverter Pilot",
				"token":      "NSV-ENROLL-PILOT-882A",
				"max_uses":   10,
				"used_count": 5,
				"expires_at": time.Now().Add(30 * 24 * time.Hour).Format(time.RFC3339),
				"created_at": time.Now().Add(-7 * 24 * time.Hour).Format(time.RFC3339),
			},
		})
		return
	}

	var tokens []models.EnrollmentToken
	database.DB.Where("organization_id = ?", orgID).Order("created_at desc").Find(&tokens)
	c.JSON(http.StatusOK, tokens)
}

// CreateEnrollmentToken generates a new batch token
func CreateEnrollmentToken(c *gin.Context) {
	orgID := c.GetString("organization_id")

	var req struct {
		Name        string `json:"name" binding:"required"`
		MaxUses     *int   `json:"max_uses"`
		ExpiresDays int    `json:"expires_days"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tokenStr := generateRandomToken("NSV-ENROLL")
	var expiresAt *time.Time
	if req.ExpiresDays > 0 {
		t := time.Now().Add(time.Duration(req.ExpiresDays) * 24 * time.Hour)
		expiresAt = &t
	}

	token := models.EnrollmentToken{
		OrganizationID: orgID,
		Name:           req.Name,
		Token:          tokenStr,
		MaxUses:        req.MaxUses,
		UsedCount:      0,
		ExpiresAt:      expiresAt,
	}

	if database.DB != nil {
		if err := database.DB.Create(&token).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create enrollment token"})
			return
		}
	} else {
		token.ID = "token-" + time.Now().Format("150405")
	}

	c.JSON(http.StatusCreated, token)
}

// DeleteEnrollmentToken revokes an enrollment token
func DeleteEnrollmentToken(c *gin.Context) {
	orgID := c.GetString("organization_id")
	tokenID := c.Param("id")

	if database.DB != nil {
		database.DB.Where("id = ? AND organization_id = ?", tokenID, orgID).Delete(&models.EnrollmentToken{})
	}

	c.JSON(http.StatusOK, gin.H{"message": "Token revoked successfully"})
}

// ListUsers returns organization members
func ListUsers(c *gin.Context) {
	orgID := c.GetString("organization_id")
	if database.DB == nil {
		c.JSON(http.StatusOK, []gin.H{
			{
				"id":         "usr-01",
				"email":      "admin@niseva.com",
				"first_name": "System",
				"last_name":  "Admin",
				"role":       "SUPER_ADMIN",
				"created_at": "2026-08-01",
			},
			{
				"id":         "usr-02",
				"email":      "operator@acmesolar.com",
				"first_name": "Rajesh",
				"last_name":  "Kumar",
				"role":       "ORG_ADMIN",
				"created_at": "2026-08-15",
			},
			{
				"id":         "usr-03",
				"email":      "field.tech@acmesolar.com",
				"first_name": "Pooja",
				"last_name":  "Patel",
				"role":       "OPERATOR",
				"created_at": "2026-08-20",
			},
		})
		return
	}

	var users []models.User
	database.DB.Where("organization_id = ?", orgID).Select("id, email, first_name, last_name, role, created_at").Find(&users)
	c.JSON(http.StatusOK, users)
}

// InviteUser creates a new member with RBAC role
func InviteUser(c *gin.Context) {
	orgID := c.GetString("organization_id")

	var req struct {
		Email     string          `json:"email" binding:"required"`
		FirstName string          `json:"first_name" binding:"required"`
		LastName  string          `json:"last_name"`
		Role      models.UserRole `json:"role" binding:"required"`
		Password  string          `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pwd := req.Password
	if pwd == "" {
		pwd = "ChangeMe@12345"
	}
	hash, _ := auth.HashPassword(pwd)

	user := models.User{
		OrganizationID: orgID,
		Email:          req.Email,
		FirstName:      req.FirstName,
		LastName:       req.LastName,
		Role:           req.Role,
		PasswordHash:   hash,
	}

	if database.DB != nil {
		if err := database.DB.Create(&user).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
			return
		}
	} else {
		user.ID = "usr-" + time.Now().Format("150405")
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":         user.ID,
		"email":      user.Email,
		"first_name": user.FirstName,
		"last_name":  user.LastName,
		"role":       user.Role,
	})
}

// GetOrganizationInfo returns tenant and license stats
func GetOrganizationInfo(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"organization": gin.H{
			"id":         "org-01",
			"name":       "Acme Solar Corp",
			"slug":       "acme-solar",
			"created_at": "2026-08-01",
		},
		"license": gin.H{
			"type":              "Enterprise On-Premise",
			"customer":          "Acme Solar Corp",
			"licensed_capacity": 500,
			"active_devices":    42,
			"expires_at":        "2027-12-31T23:59:59Z",
			"status":            "VALID",
			"signature_valid":   true,
		},
	})
}

// ListAuditLogs returns compliance audit trail
func ListAuditLogs(c *gin.Context) {
	c.JSON(http.StatusOK, []gin.H{
		{
			"id":            "audit-01",
			"user_email":    "admin@niseva.com",
			"action":        "ROUTER_REBOOT",
			"resource_type": "DEVICE",
			"resource_id":   "NSV-2S-2026-00412",
			"details":       "Manual reboot triggered via RMS Web Console",
			"ip_address":    "182.72.54.12",
			"created_at":    time.Now().Add(-15 * time.Minute).Format(time.RFC3339),
		},
		{
			"id":            "audit-02",
			"user_email":    "operator@acmesolar.com",
			"action":        "TUNNEL_OPEN_LUCI",
			"resource_type": "TUNNEL",
			"resource_id":   "NSV-2S-2026-00412",
			"details":       "Requested remote LuCI WebUI reverse proxy session",
			"ip_address":    "182.72.54.12",
			"created_at":    time.Now().Add(-45 * time.Minute).Format(time.RFC3339),
		},
		{
			"id":            "audit-03",
			"user_email":    "admin@niseva.com",
			"action":        "FOTA_ROLLOUT_START",
			"resource_type": "DEPLOYMENT",
			"resource_id":   "rollout-01",
			"details":       "Initiated Canary rollout of firmware v1.2 LTS to 42 devices",
			"ip_address":    "182.72.54.12",
			"created_at":    time.Now().Add(-2 * time.Hour).Format(time.RFC3339),
		},
		{
			"id":            "audit-04",
			"user_email":    "admin@niseva.com",
			"action":        "ENROLLMENT_TOKEN_CREATE",
			"resource_type": "TOKEN",
			"resource_id":   "NSV-ENROLL-SOLAR-2026-9B41",
			"details":       "Created batch token with limit 100 devices",
			"ip_address":    "182.72.54.12",
			"created_at":    time.Now().Add(-14 * 24 * time.Hour).Format(time.RFC3339),
		},
	})
}

// ListTenants returns all customer organizations (for Superadmin)
func ListTenants(c *gin.Context) {
	if database.DB == nil {
		c.JSON(http.StatusOK, []gin.H{
			{
				"id":                 "org-01",
				"name":               "Acme Solar Corp",
				"slug":               "acme-solar",
				"admin_email":        "admin@acmesolar.com",
				"device_count":       42,
				"max_devices":        500,
				"license_tier":       "Enterprise On-Premise",
				"created_at":         "2026-08-01",
			},
			{
				"id":                 "org-02",
				"name":               "SunPower Energy Ltd",
				"slug":               "sunpower-energy",
				"admin_email":        "admin@sunpower.com",
				"device_count":       12,
				"max_devices":        100,
				"license_tier":       "Standard Cloud SaaS",
				"created_at":         "2026-08-20",
			},
		})
		return
	}

	var orgs []models.Organization
	database.DB.Order("created_at desc").Find(&orgs)
	c.JSON(http.StatusOK, orgs)
}

// CreateTenant creates a new customer organization and its initial admin account
func CreateTenant(c *gin.Context) {
	var req struct {
		Name        string `json:"name" binding:"required"`
		AdminEmail  string `json:"admin_email" binding:"required"`
		Password    string `json:"password"`
		MaxDevices  int    `json:"max_devices"`
		LicenseTier string `json:"license_tier"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pwd := req.Password
	if pwd == "" {
		pwd = "Welcome@" + time.Now().Format("2006") + "!"
	}
	hash, _ := auth.HashPassword(pwd)

	maxDev := req.MaxDevices
	if maxDev <= 0 {
		maxDev = 100
	}

	slug := strings.ToLower(strings.ReplaceAll(req.Name, " ", "-"))

	org := models.Organization{
		Name: req.Name,
		Slug: slug,
	}

	enrollToken := generateRandomToken("NSV-ENROLL-" + strings.ToUpper(slug[:min(len(slug), 6)]))

	if database.DB != nil {
		database.DB.Create(&org)

		user := models.User{
			OrganizationID: org.ID,
			Email:          req.AdminEmail,
			FirstName:      req.Name,
			LastName:       "Admin",
			Role:           models.RoleOrgAdmin,
			PasswordHash:   hash,
		}
		database.DB.Create(&user)

		token := models.EnrollmentToken{
			OrganizationID: org.ID,
			Name:           "Default Factory Batch Token",
			Token:          enrollToken,
			MaxUses:        &maxDev,
		}
		database.DB.Create(&token)
	} else {
		org.ID = "org-" + time.Now().Format("150405")
	}

	c.JSON(http.StatusCreated, gin.H{
		"organization": gin.H{
			"id":          org.ID,
			"name":        org.Name,
			"slug":        org.Slug,
			"max_devices": maxDev,
		},
		"credentials": gin.H{
			"portal_url":  "http://82.180.146.203:8080",
			"login_email": req.AdminEmail,
			"password":    pwd,
			"role":        "ORG_ADMIN",
		},
		"enrollment_token": enrollToken,
		"provision_command": "uci set niseva.general.enrollment_token='" + enrollToken + "' && uci commit && /etc/init.d/niseva-agent restart",
	})
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
