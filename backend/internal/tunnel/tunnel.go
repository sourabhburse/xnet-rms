package tunnel

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
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
	RouterConn    *websocket.Conn
	BrowserConn   *websocket.Conn
	Active        bool
	Mutex         sync.Mutex
	InitialBuffer []byte

	// HTTP LuCI proxy support
	HttpLock   sync.Mutex
	PipeWriter *io.PipeWriter
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
			log.Printf("[TUNNEL-WS] Router connection read error for session %s: %v\n", pair.SessionID, err)
			break
		}

		pair.Mutex.Lock()
		pw := pair.PipeWriter
		if pw != nil {
			log.Printf("[TUNNEL-WS] Forwarding %d bytes from router to PipeWriter\n", len(msg))
			_, _ = pw.Write(msg)
		} else if pair.BrowserConn != nil {
			_ = pair.BrowserConn.WriteMessage(msgType, msg)
		} else if len(pair.InitialBuffer) < 65536 {
			pair.InitialBuffer = append(pair.InitialBuffer, msg...)
		}
		pair.Mutex.Unlock()
	}

	// Teardown
	pair.Mutex.Lock()
	pair.Active = false
	pair.RouterConn = nil
	if pair.PipeWriter != nil {
		_ = pair.PipeWriter.CloseWithError(io.EOF)
		pair.PipeWriter = nil
	}
	if pair.BrowserConn != nil {
		_ = pair.BrowserConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "Router disconnected"))
		_ = pair.BrowserConn.Close()
		pair.BrowserConn = nil
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
	if len(pair.InitialBuffer) > 0 {
		_ = conn.WriteMessage(websocket.BinaryMessage, pair.InitialBuffer)
		pair.InitialBuffer = nil
	}
	pair.Mutex.Unlock()

	log.Printf("[TUNNEL] Browser attached to session %s\n", pair.SessionID)

	for {
		msgType, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}

		pair.Mutex.Lock()
		if pair.RouterConn != nil {
			_ = pair.RouterConn.WriteMessage(msgType, msg)
		}
		pair.Mutex.Unlock()
	}

	log.Printf("[TUNNEL] Browser disconnected from session %s\n", pair.SessionID)

	pair.Mutex.Lock()
	pair.BrowserConn = nil
	if pair.RouterConn != nil {
		_ = pair.RouterConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "Browser disconnected"))
		_ = pair.RouterConn.Close()
		pair.RouterConn = nil
	}
	pair.Active = false
	pair.Mutex.Unlock()
}

// HttpProxyHandler reverse-proxies LuCI HTTP traffic over the established tunnel
func HttpProxyHandler(c *gin.Context) {
	token := c.Param("token")
	if token == "" {
		token, _ = c.Cookie("xnet_luci_token")
	}

	if token == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "LuCI session token required"})
		return
	}

	registryLock.RLock()
	pair, exists := activeTunnels[token]
	registryLock.RUnlock()

	if !exists || time.Now().After(pair.ExpiresAt) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Tunnel session not active or expired"})
		return
	}

	// Wait up to 10 seconds for router to connect if still establishing
	for i := 0; i < 50; i++ {
		pair.Mutex.Lock()
		ready := pair.Active && pair.RouterConn != nil
		pair.Mutex.Unlock()
		if ready {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}

	pair.Mutex.Lock()
	ready := pair.Active && pair.RouterConn != nil
	pair.Mutex.Unlock()
	if !ready {
		c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Router reverse tunnel connection not established yet"})
		return
	}

	// Set cookie so root-relative subrequests (/luci-static/*, /cgi-bin/luci/*) carry the session token
	c.SetCookie("xnet_luci_token", token, 1800, "/", "", false, false)

	// Determine target path on the router
	var targetPath string
	if strings.HasPrefix(c.Request.URL.Path, "/connect/luci/"+token) {
		targetPath = strings.TrimPrefix(c.Request.URL.Path, "/connect/luci/"+token)
		if targetPath == "" || targetPath == "/" {
			targetPath = "/cgi-bin/luci"
		}
	} else {
		targetPath = c.Request.URL.Path
	}
	if c.Request.URL.RawQuery != "" {
		targetPath += "?" + c.Request.URL.RawQuery
	}

	// Lock mutex to serialize HTTP transactions over the single tunnel stream
	pair.HttpLock.Lock()
	defer pair.HttpLock.Unlock()

	bodyBytes, _ := io.ReadAll(c.Request.Body)
	outReq, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, "http://127.0.0.1"+targetPath, bytes.NewReader(bodyBytes))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create proxy request"})
		return
	}

	for k, vv := range c.Request.Header {
		if strings.EqualFold(k, "Upgrade") || strings.EqualFold(k, "Connection") || strings.EqualFold(k, "Sec-WebSocket-Key") || strings.EqualFold(k, "Sec-WebSocket-Version") {
			continue
		}
		for _, v := range vv {
			outReq.Header.Add(k, v)
		}
	}
	outReq.Host = "127.0.0.1"
	outReq.Header.Set("Host", "127.0.0.1")

	var reqBuf bytes.Buffer
	if err := outReq.Write(&reqBuf); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to serialize proxy request"})
		return
	}

	pr, pw := io.Pipe()
	pair.Mutex.Lock()
	pair.PipeWriter = pw
	routerConn := pair.RouterConn
	pair.Mutex.Unlock()

	defer func() {
		pair.Mutex.Lock()
		if pair.PipeWriter == pw {
			pair.PipeWriter = nil
		}
		pair.Mutex.Unlock()
		_ = pw.Close()
		_ = pr.Close()
	}()

	if routerConn == nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Router connection closed"})
		return
	}

	log.Printf("[HTTP-PROXY] Starting proxy request: %s %s (token=%s)\n", c.Request.Method, targetPath, token)

	if err := routerConn.WriteMessage(websocket.BinaryMessage, reqBuf.Bytes()); err != nil {
		log.Printf("[HTTP-PROXY] Error writing to routerConn: %v\n", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to send request to router: " + err.Error()})
		return
	}
	log.Printf("[HTTP-PROXY] Sent %d bytes to router WebSocket for %s\n", reqBuf.Len(), targetPath)

	type readResult struct {
		resp *http.Response
		err  error
	}
	respCh := make(chan readResult, 1)
	go func() {
		resp, err := http.ReadResponse(bufio.NewReader(pr), outReq)
		respCh <- readResult{resp: resp, err: err}
	}()

	var resp *http.Response
	select {
	case res := <-respCh:
		if res.err != nil {
			log.Printf("[HTTP-PROXY] ReadResponse error for %s: %v\n", targetPath, res.err)
			c.JSON(http.StatusBadGateway, gin.H{"error": "Error reading response from router: " + res.err.Error()})
			return
		}
		resp = res.resp
	case <-time.After(30 * time.Second):
		log.Printf("[HTTP-PROXY] Timeout waiting for router response for %s\n", targetPath)
		_ = pw.CloseWithError(errors.New("timeout reading response from router"))
		c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Gateway timeout waiting for router response"})
		return
	case <-c.Request.Context().Done():
		log.Printf("[HTTP-PROXY] Client canceled request for %s\n", targetPath)
		_ = pw.CloseWithError(c.Request.Context().Err())
		return
	}
	defer resp.Body.Close()
	log.Printf("[HTTP-PROXY] ReadResponse success for %s: status=%d, content-length=%d\n", targetPath, resp.StatusCode, resp.ContentLength)

	// Strip frame-blocking headers so LuCI renders cleanly in dashboard iframe
	resp.Header.Del("X-Frame-Options")
	resp.Header.Del("Content-Security-Policy")

	// Rewrite Location redirect headers to point back into the proxy
	loc := resp.Header.Get("Location")
	if loc != "" {
		if strings.HasPrefix(loc, "/cgi-bin/luci") {
			resp.Header.Set("Location", "/connect/luci/"+token+loc)
		} else if strings.HasPrefix(loc, "/") {
			resp.Header.Set("Location", "/connect/luci/"+token+loc)
		}
	}

	// Rewrite cookie paths so session cookies apply globally to the domain
	cookies := resp.Header.Values("Set-Cookie")
	resp.Header.Del("Set-Cookie")
	pathRegex := regexp.MustCompile(`(?i)path=[^;]+`)
	for _, cookieVal := range cookies {
		updatedCookie := pathRegex.ReplaceAllString(cookieVal, "Path=/")
		c.Writer.Header().Add("Set-Cookie", updatedCookie)
	}

	// Write remaining headers
	for k, vv := range resp.Header {
		if strings.EqualFold(k, "Set-Cookie") || strings.EqualFold(k, "X-Frame-Options") || strings.EqualFold(k, "Content-Length") {
			continue
		}
		for _, v := range vv {
			c.Writer.Header().Add(k, v)
		}
	}

	c.Writer.WriteHeader(resp.StatusCode)
	written, copyErr := io.Copy(c.Writer, resp.Body)
	log.Printf("[HTTP-PROXY] Copied %d bytes to client for %s (err: %v)\n", written, targetPath, copyErr)
}

// HttpProxyFallbackHandler catches root-level LuCI requests (/luci-static/*, /cgi-bin/luci/*) and proxies them
func HttpProxyFallbackHandler(c *gin.Context) {
	token, err := c.Cookie("xnet_luci_token")
	if err != nil || token == "" {
		// Fallback: check if activeTunnels has any active LuCI tunnel session
		registryLock.RLock()
		for tok, p := range activeTunnels {
			if p.Protocol == models.ProtocolLuCI && p.Active && time.Now().Before(p.ExpiresAt) {
				token = tok
				break
			}
		}
		registryLock.RUnlock()
	}

	if token == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "No active LuCI session found"})
		return
	}

	c.Params = gin.Params{gin.Param{Key: "token", Value: token}}
	HttpProxyHandler(c)
}
