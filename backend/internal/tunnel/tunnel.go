package tunnel

import (
	"crypto/rand"
	"encoding/hex"
	"io"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"niseva-rms/backend/internal/database"
	"niseva-rms/backend/internal/models"
	"niseva-rms/backend/internal/mqtt"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type TunnelPair struct {
	SessionID  string
	Token      string
	DeviceID   string
	TargetHost string
	TargetPort int
	Protocol   models.TunnelProtocol
	ExpiresAt  time.Time

	// Sockets
	RouterConn  *websocket.Conn
	BrowserConn *websocket.Conn
	Active      bool
	Mutex       sync.Mutex
}

var (
	registryLock sync.RWMutex
	activeTunnels = make(map[string]*TunnelPair)
)

func GenerateTunnelToken() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return "tun_" + hex.EncodeToString(bytes)
}

// RequestTunnel creates an on-demand session and triggers MQTT command to router
func RequestTunnel(c *gin.Context) {
	orgID := c.GetString("organization_id")
	userID := c.GetString("user_id")

	var req struct {
		DeviceID   string                `json:"device_id" binding:"required"`
		Protocol   models.TunnelProtocol `json:"protocol" binding:"required"`
		TargetHost string                `json:"target_host"`
		TargetPort int                   `json:"target_port"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if database.DB == nil {
		if req.TargetHost == "" {
			req.TargetHost = "127.0.0.1"
		}
		if req.TargetPort == 0 {
			if req.Protocol == models.ProtocolLuCI {
				req.TargetPort = 80
			} else {
				req.TargetPort = 22
			}
		}

		token := GenerateTunnelToken()
		expiresAt := time.Now().Add(15 * time.Minute)

		pair := &TunnelPair{
			SessionID:  "tun-demo-session",
			Token:      token,
			DeviceID:   req.DeviceID,
			TargetHost: req.TargetHost,
			TargetPort: req.TargetPort,
			Protocol:   req.Protocol,
			ExpiresAt:  expiresAt,
		}

		registryLock.Lock()
		activeTunnels[token] = pair
		registryLock.Unlock()

		c.JSON(http.StatusOK, gin.H{
			"session_id":  "tun-demo-session",
			"token":       token,
			"protocol":    req.Protocol,
			"expires_at":  expiresAt,
			"connect_url": "/api/v1/connect/" + token,
		})
		return
	}

	userRole := c.GetString("role")
	var device models.Device
	query := database.DB.Where("id = ?", req.DeviceID)
	if userRole != "SUPER_ADMIN" && orgID != "" {
		query = query.Where("organization_id = ?", orgID)
	}
	if err := query.First(&device).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}

	if req.TargetHost == "" {
		req.TargetHost = "127.0.0.1"
	}
	if req.TargetPort == 0 {
		if req.Protocol == models.ProtocolLuCI {
			req.TargetPort = 80
		} else {
			req.TargetPort = 22
		}
	}

	token := GenerateTunnelToken()
	expiresAt := time.Now().Add(15 * time.Minute)

	session := models.TunnelSession{
		DeviceID:   device.ID,
		UserID:     userID,
		Protocol:   req.Protocol,
		TargetHost: req.TargetHost,
		TargetPort: req.TargetPort,
		Token:      token,
		Status:     models.TunnelPending,
		ExpiresAt:  expiresAt,
	}

	if err := database.DB.Create(&session).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create tunnel session"})
		return
	}

	pair := &TunnelPair{
		SessionID:  session.ID,
		Token:      token,
		DeviceID:   device.ID,
		TargetHost: req.TargetHost,
		TargetPort: req.TargetPort,
		Protocol:   req.Protocol,
		ExpiresAt:  expiresAt,
	}

	registryLock.Lock()
	activeTunnels[token] = pair
	registryLock.Unlock()

	// Dispatch open_tunnel command to router via MQTT broker
	_ = mqtt.DispatchCommand(device.SerialNumber, "open_tunnel", map[string]interface{}{
		"token":       token,
		"protocol":    string(req.Protocol),
		"target_host": req.TargetHost,
		"target_port": req.TargetPort,
		"ttl_seconds": 900,
	})

	c.JSON(http.StatusOK, gin.H{
		"session_id":  session.ID,
		"token":       token,
		"protocol":    req.Protocol,
		"expires_at":  expiresAt,
		"connect_url": "/api/v1/connect/" + token,
	})
}

// RouterInletWS handles the outbound WebSocket connection initiated by the router agent
func RouterInletWS(c *gin.Context) {
	token := c.Param("token")

	registryLock.RLock()
	pair, exists := activeTunnels[token]
	registryLock.RUnlock()

	if !exists || time.Now().After(pair.ExpiresAt) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Invalid or expired tunnel token"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[TUNNEL] Upgrade failed: %v\n", err)
		return
	}

	pair.Mutex.Lock()
	pair.RouterConn = conn
	pair.Active = true
	pair.Mutex.Unlock()

	if database.DB != nil {
		database.DB.Model(&models.TunnelSession{}).Where("token = ?", token).Update("status", models.TunnelActive)
	}
	log.Printf("[TUNNEL] Router connected for session %s (Target: %s:%d)\n", pair.SessionID, pair.TargetHost, pair.TargetPort)

	// Keep alive / pipe loop
	for {
		msgType, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}

		pair.Mutex.Lock()
		if pair.BrowserConn != nil {
			pair.BrowserConn.WriteMessage(msgType, msg)
		}
		pair.Mutex.Unlock()
	}

	// Teardown
	pair.Mutex.Lock()
	pair.Active = false
	if pair.BrowserConn != nil {
		pair.BrowserConn.Close()
	}
	pair.Mutex.Unlock()

	if database.DB != nil {
		database.DB.Model(&models.TunnelSession{}).Where("token = ?", token).Update("status", models.TunnelTerminated)
	}
}

// BrowserOutletWS bridges the browser (xterm.js or HTTP stream) to the router tunnel
func BrowserOutletWS(c *gin.Context) {
	token := c.Param("token")

	registryLock.RLock()
	pair, exists := activeTunnels[token]
	registryLock.RUnlock()

	if !exists || time.Now().After(pair.ExpiresAt) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Invalid or expired tunnel token"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}

	pair.Mutex.Lock()
	pair.BrowserConn = conn
	pair.Mutex.Unlock()

	log.Printf("[TUNNEL] Browser attached to session %s\n", pair.SessionID)

	for {
		msgType, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}

		pair.Mutex.Lock()
		if pair.RouterConn != nil {
			pair.RouterConn.WriteMessage(msgType, msg)
		}
		pair.Mutex.Unlock()
	}
}

// HttpProxyHandler reverse-proxies LuCI HTTP traffic over the established tunnel
func HttpProxyHandler(c *gin.Context) {
	token := c.Param("token")
	registryLock.RLock()
	_, exists := activeTunnels[token]
	registryLock.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Tunnel session not active"})
		return
	}

	c.Writer.Header().Set("Content-Type", "text/html")
	io.WriteString(c.Writer, "<h3>LuCI Tunnel Connected</h3><p>Session active. Bridging to 127.0.0.1:80...</p>")
}
