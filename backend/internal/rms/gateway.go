package rms

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gorilla/websocket"
	"html"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

type Gateway struct {
	Config Config
	Client *http.Client
	UI     fs.FS
	mu     sync.Mutex
	pairs  map[string]*Pair
}
type Pair struct {
	session             Session
	router, browser     *websocket.Conn
	mu, write, httpLock sync.Mutex
	responses           chan []byte
	done                chan struct{}
	once                sync.Once
	sshOnce             sync.Once
	sshClient           *ssh.Client
	sshTransport        *http.Transport
	sshErr              error
	initial             []byte
	routerIn            *io.PipeReader
	routerOut           *io.PipeWriter
}

func (g *Gateway) ensureLuciSSH(p *Pair) error {
	p.sshOnce.Do(func() {
		signer, err := ssh.ParsePrivateKey([]byte(p.session.SSHPrivateKey))
		if err != nil {
			p.sshErr = err
			return
		}
		pr, pw := io.Pipe()
		p.mu.Lock()
		initial := p.initial
		p.initial = nil
		p.routerIn, p.routerOut = pr, pw
		p.mu.Unlock()
		conn := &wsNetConn{r: io.MultiReader(bytes.NewReader(initial), pr), p: p}
		cfg := &ssh.ClientConfig{
			User:            "root",
			Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
			HostKeyCallback: ssh.InsecureIgnoreHostKey(),
			HostKeyAlgorithms: []string{
				ssh.KeyAlgoRSA,
				ssh.KeyAlgoRSASHA256,
				ssh.KeyAlgoRSASHA512,
				ssh.KeyAlgoED25519,
			},
			Timeout: 10 * time.Second,
		}
		ncc, chans, reqs, err := ssh.NewClientConn(conn, "127.0.0.1:22", cfg)
		if err != nil {
			p.sshErr = err
			return
		}
		client := ssh.NewClient(ncc, chans, reqs)
		transport := &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return client.Dial("tcp", "127.0.0.1:80")
			},
			// The OpenWrt uhttpd configuration on the XE33 2S allows three
			// concurrent requests (max_requests=3).  Letting the browser open
			// eight SSH direct-tcpip channels at once makes uhttpd reject one of
			// LuCI's module requests, leaving the page stuck while collecting data.
			MaxConnsPerHost:     3,
			MaxIdleConns:        3,
			MaxIdleConnsPerHost: 3,
			IdleConnTimeout:     30 * time.Second,
		}
		p.mu.Lock()
		p.sshClient, p.sshTransport = client, transport
		p.mu.Unlock()
	})
	return p.sshErr
}

func isLuciStatic(path string) bool {
	if strings.HasPrefix(path, "/luci-static/") {
		return true
	}
	for _, ext := range []string{".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf"} {
		if strings.HasSuffix(strings.ToLower(path), ext) {
			return true
		}
	}
	return false
}

func copyLuciResponseHeaders(dst, src http.Header) {
	for k, values := range src {
		switch strings.ToLower(k) {
		case "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade":
			continue
		}
		for _, value := range values {
			dst.Add(k, value)
		}
	}
}

func injectLuciLoadingFallback(body []byte) []byte {
	lower := bytes.ToLower(body)
	marker := []byte("</head>")
	idx := bytes.Index(lower, marker)
	if idx < 0 {
		return body
	}
	const fallback = `<style id="xnet-rms-loading-fallback">.main > .loading{display:none!important}</style>`
	out := make([]byte, 0, len(body)+len(fallback))
	out = append(out, body[:idx]...)
	out = append(out, fallback...)
	out = append(out, body[idx:]...)
	return out
}

func forwardLuciRequestHeaders(src http.Header) http.Header {
	dst := src.Clone()
	dst.Del("Connection")
	if cookie := dst.Get("Cookie"); cookie != "" {
		kept := make([]string, 0, 2)
		for _, part := range strings.Split(cookie, ";") {
			part = strings.TrimSpace(part)
			if part == "" || strings.HasPrefix(part, "__Host-rms_session=") {
				continue
			}
			kept = append(kept, part)
		}
		if len(kept) == 0 {
			dst.Del("Cookie")
		} else {
			dst.Set("Cookie", strings.Join(kept, "; "))
		}
	}
	return dst
}

func luciUpstreamPath(requestURI string) string {
	if requestURI == "/" {
		return "/cgi-bin/luci/"
	}
	if strings.HasPrefix(requestURI, "/ubus") && (requestURI == "/ubus" || strings.HasPrefix(requestURI, "/ubus/")) {
		return "/cgi-bin/luci/admin/ubus" + strings.TrimPrefix(requestURI, "/ubus")
	}
	return requestURI
}

func tunnelOriginAllowed(publicURL, host, origin string, allowOpaque bool) bool {
	if origin == "" || (allowOpaque && origin == "null") {
		return true
	}
	if sameOrigin("https://"+host, origin) {
		return true
	}
	// LuCI can be embedded or submitted from the authenticated dashboard
	// while the tunnel itself lives on the per-session hostname. The session
	// cookie is host-only, so this does not grant access without the tunnel's
	// own browser session authorization above.
	return publicURL != "" && sameOrigin(publicURL, origin)
}

// The RMS session authorizes the tunnel only. LuCI authenticates the browser
// with the router's own login page and sysauth cookie.
func (g *Gateway) luci(w http.ResponseWriter, r *http.Request, id string, p *Pair) {
	if err := g.ensureLuciSSH(p); err != nil {
		log.Printf("rms tunnel session %s LuCI SSH setup failed: %v", id, err)
		g.tunnelPage(w, r, 502, "ROUTER UNAVAILABLE", "Router connection lost", "The router did not accept the secure LuCI connection. Try starting a new session from the device details page.", false)
		return
	}
	p.mu.Lock()
	transport := p.sshTransport
	p.mu.Unlock()
	if transport == nil {
		g.tunnelPage(w, r, 502, "ROUTER UNAVAILABLE", "LuCI transport unavailable", "The secure router transport is no longer available. Start a new remote session and try again.", false)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 256*1024)
	// LuCI's browser-side RPC client uses /ubus/, while this firmware exposes
	// the ubus CGI handler below /cgi-bin/luci/admin/ubus. Keep the browser URL
	// unchanged and translate only the upstream hop.
	path := luciUpstreamPath(r.URL.RequestURI())
	out := r.Clone(r.Context())
	out.URL = &url.URL{Scheme: "http", Host: "127.0.0.1", Path: path}
	if q := strings.IndexByte(path, '?'); q >= 0 {
		out.URL.Path, out.URL.RawQuery = path[:q], path[q+1:]
	}
	out.RequestURI = ""
	out.Host = "127.0.0.1"
	out.Header = forwardLuciRequestHeaders(r.Header)
	resp, err := transport.RoundTrip(out)
	if err != nil {
		log.Printf("rms tunnel session %s LuCI request failed path=%s: %v", id, r.URL.Path, err)
		g.tunnelPage(w, r, 502, "ROUTER UNAVAILABLE", "Router connection lost", "The router stopped responding to the LuCI request. Start a new session and try again.", false)
		return
	}
	defer resp.Body.Close()
	copyLuciResponseHeaders(w.Header(), resp.Header)
	if isLuciStatic(path) {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	} else {
		w.Header().Set("Cache-Control", "no-store")
	}
	if location := w.Header().Get("Location"); location != "" {
		u, err := url.Parse(location)
		if err == nil && u.IsAbs() && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost") {
			w.Header().Set("Location", u.RequestURI())
		}
	}
	if r.Method == http.MethodGet && strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "text/html") && resp.Header.Get("Content-Encoding") == "" {
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
		if readErr != nil {
			log.Printf("rms tunnel session %s LuCI HTML read failed path=%s: %v", id, r.URL.Path, readErr)
		}
		body = injectLuciLoadingFallback(body)
		w.Header().Del("Content-Length")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(body)
		return
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, 1024*1024))
}

type HTTPFrame struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	Body    []byte            `json:"body"`
	Status  int               `json:"status,omitempty"`
}

func NewGateway(c Config, ui fs.FS) (*Gateway, error) {
	tc, e := TLSConfig(c.PKIDir, "rms-tunnel", false)
	if e != nil {
		return nil, e
	}
	return &Gateway{Config: c, Client: &http.Client{Transport: &http.Transport{TLSClientConfig: tc}, Timeout: 5 * time.Second}, UI: ui, pairs: map[string]*Pair{}}, nil
}
func (g *Gateway) call(method, path string, payload any, out any) error {
	var b io.Reader
	if payload != nil {
		b = bytes.NewReader(raw(payload))
	}
	req, e := http.NewRequest(method, g.Config.CoreURL+path, b)
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	res, e := g.Client.Do(req)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return errors.New("core rejected session")
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(res.Body, 65536)).Decode(out)
	}
	return nil
}
func (g *Gateway) close(id string, p *Pair) {
	p.once.Do(func() {
		log.Printf("rms tunnel session %s closing", id)
		close(p.done)
		p.mu.Lock()
		if p.sshTransport != nil {
			p.sshTransport.CloseIdleConnections()
		}
		if p.sshClient != nil {
			p.sshClient.Close()
		}
		if p.routerOut != nil {
			p.routerOut.Close()
		}
		if p.routerIn != nil {
			p.routerIn.Close()
		}
		if p.browser != nil {
			p.browser.Close()
		}
		p.mu.Unlock()
		p.router.Close()
		g.mu.Lock()
		delete(g.pairs, id)
		g.mu.Unlock()
		g.call("POST", "/internal/sessions/"+id+"/close", nil, nil)
	})
}
func (g *Gateway) Reconcile() error { return g.call("POST", "/internal/reconcile", nil, nil) }

func terminalPage(data []byte, session Session) []byte {
	deviceName := session.DeviceName
	if deviceName == "" {
		deviceName = session.DeviceSerial
	}
	page := string(data)
	for placeholder, value := range map[string]string{
		"__XNET_DEVICE_NAME__":     deviceName,
		"__XNET_DEVICE_SERIAL__":   session.DeviceSerial,
		"__XNET_DEVICE_MODEL__":    session.DeviceModel,
		"__XNET_DEVICE_FIRMWARE__": session.DeviceFirmware,
	} {
		page = strings.ReplaceAll(page, placeholder, html.EscapeString(value))
	}
	return []byte(page)
}

func acceptsHTML(r *http.Request) bool {
	return strings.Contains(strings.ToLower(r.Header.Get("Accept")), "text/html")
}

func (g *Gateway) tunnelLoadingPage(w http.ResponseWriter, r *http.Request) {
	if acceptsHTML(r) {
		w.Header().Set("Refresh", "2")
	}
	g.tunnelPage(w, r, 503, "CONNECTING", "Connecting to router", "The router is still establishing its secure tunnel. This page will refresh automatically when LuCI is ready.", true)
}

func (g *Gateway) tunnelPage(w http.ResponseWriter, r *http.Request, status int, eyebrow, title, message string, retry bool) {
	if !acceptsHTML(r) {
		fail(w, status, message)
		return
	}
	markClass := ""
	if eyebrow == "CONNECTING" {
		markClass = " loading"
	}
	primary := `<button class="action primary" type="button" onclick="location.reload()">Try again</button>`
	if !retry {
		primary = `<button class="action primary" type="button" onclick="window.close();this.textContent='You can close this tab'">Close tab</button>`
	}
	returnLink := ""
	if g.Config.PublicURL != "" {
		returnLink = fmt.Sprintf(`<a class="action" href="%s">Open XNET RMS</a>`, html.EscapeString(g.Config.PublicURL))
	}
	document := fmt.Sprintf(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#203864"><title>%s · XNET RMS</title>
<style>
:root{color-scheme:light;--navy:#203864;--azure:#668bce;--bg:#f5f6f9;--ink:#191c23;--muted:#6d7482;--border:#e5e7ec}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 8%% 0%%,rgba(102,139,206,.16),transparent 31rem),var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.app{min-height:100vh}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px;padding:0 28px;color:#fff;background:linear-gradient(135deg,#142747,var(--navy));box-shadow:0 8px 24px rgba(32,56,100,.14)}
.brand{display:flex;align-items:center;gap:11px}.mark{position:relative;width:43px;height:24px;transform-origin:center}.mark i{position:absolute;top:5px;width:14px;height:14px;border-radius:99px;background:#fff}.mark i:nth-child(1){left:0;opacity:.92}.mark i:nth-child(2){left:9px;opacity:.76}.mark i:nth-child(3){left:18px;opacity:.6}.mark i:nth-child(4){left:27px;opacity:.44}.mark.loading{animation:breathe 2s ease-in-out infinite;will-change:transform,filter}@keyframes breathe{0%%,100%%{transform:scale(.92);filter:drop-shadow(0 0 0 rgba(143,181,240,0))}50%%{transform:scale(1.06);filter:drop-shadow(0 0 14px rgba(143,181,240,.48))}}@media(prefers-reduced-motion:reduce){.mark.loading{animation:none}}.name{font-size:14px;font-weight:700}.caption{margin-top:2px;color:rgba(255,255,255,.62);font-size:10px;letter-spacing:.08em;text-transform:uppercase}
.main{display:grid;place-items:center;width:min(760px,calc(100%% - 32px));min-height:calc(100vh - 64px);margin:0 auto;padding:32px 0}.card{width:100%%;overflow:hidden;border:1px solid var(--border);border-radius:14px;background:#fff;box-shadow:0 14px 40px rgba(25,28,35,.08)}.head{display:flex;align-items:flex-start;gap:14px;padding:24px;border-bottom:1px solid var(--border)}.icon{display:grid;flex:0 0 42px;width:42px;height:42px;place-items:center;border-radius:11px;color:#fff;background:var(--navy);font-family:ui-monospace,monospace;font-size:14px;font-weight:700}.eyebrow{margin:1px 0 7px;color:var(--azure);font-size:10px;font-weight:800;letter-spacing:.1em}.head h1{margin:0;font-size:20px;letter-spacing:-.02em}.head p{margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.6}.body{padding:24px}.status{display:inline-flex;align-items:center;gap:7px;border:1px solid #f1c5cd;border-radius:99px;padding:5px 9px;color:#bb2d46;background:#fcecef;font-size:10px;font-weight:800;letter-spacing:.06em}.dot{width:7px;height:7px;border-radius:99px;background:#bb2d46}.detail{margin:18px 0 0;padding:13px 14px;border-radius:9px;background:#f5f6f9;color:var(--muted);font-size:12px;line-height:1.6}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}.action{display:inline-flex;align-items:center;justify-content:center;border:1px solid #d8dce5;border-radius:7px;padding:9px 13px;color:var(--navy);background:#fff;font:inherit;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer}.action:hover{background:#f2f4f7}.action.primary{border-color:var(--navy);color:#fff;background:var(--navy)}.action.primary:hover{background:#29477d}.foot{padding:0 24px 22px;color:var(--muted);font-size:10.5px}@media(max-width:640px){.topbar{padding:0 16px}.caption{display:none}.main{width:min(100%% - 20px,760px);padding:18px 0}.head,.body{padding:18px}.foot{padding:0 18px 18px}}
</style></head>
<body><div class="app"><header class="topbar"><div class="brand"><div class="mark%s" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div><div class="name">XNET RMS</div><div class="caption">Secure remote access</div></div></div><span class="status"><span class="dot"></span>%s</span></header><main class="main"><section class="card"><div class="head"><div class="icon">&gt;_</div><div><div class="eyebrow">REMOTE SESSION</div><h1>%s</h1><p>%s</p></div></div><div class="body"><div class="detail">This page is served by XNET RMS because the router tunnel is not available for the current request. Your dashboard session and router login remain separate.</div><div class="actions">%s%s</div></div><div class="foot">For security, remote sessions expire automatically and cannot be resumed after they close.</div></section></main></div></body></html>`, html.EscapeString(title), markClass, html.EscapeString(eyebrow), html.EscapeString(title), html.EscapeString(message), primary, returnLink)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, document)
}

func (g *Gateway) Shutdown() {
	g.mu.Lock()
	pairs := map[string]*Pair{}
	for id, p := range g.pairs {
		pairs[id] = p
	}
	g.mu.Unlock()
	for id, p := range pairs {
		g.close(id, p)
	}
}
func (g *Gateway) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.URL.Path == "/health" {
			output(w, 200, map[string]string{"status": "UP", "service": "rms-tunnel"})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/router/") {
			g.router(w, r)
			return
		}
		host := r.Host
		if h, _, e := net.SplitHostPort(host); e == nil {
			host = h
		}
		suffix := "." + g.Config.TunnelDomain
		if !strings.HasSuffix(host, suffix) {
			g.tunnelPage(w, r, 404, "INVALID ADDRESS", "Session host required", "Open this link from an active XNET RMS remote session.", false)
			return
		}
		id := strings.TrimSuffix(host, suffix)
		if !validID(id) {
			g.tunnelPage(w, r, 404, "INVALID SESSION", "Invalid remote session", "The session link is not valid. Start a new session from the XNET RMS device page.", false)
			return
		}
		var session Session
		if err := g.call("GET", "/internal/sessions/"+id, nil, &session); err != nil {
			log.Printf("rms tunnel session %s inactive: %v path=%s", id, err, r.URL.Path)
			g.tunnelPage(w, r, 403, "SESSION ENDED", "Remote session unavailable", "This remote session has ended or expired. Start a new session from the XNET RMS device details page.", false)
			return
		}
		log.Printf("rms tunnel session %s request path=%s protocol=%s", id, r.URL.Path, session.Protocol)
		if r.URL.Path == "/launch" {
			cookie := secret()
			if g.call("POST", "/internal/sessions/"+id+"/claim", map[string]string{"ticket": r.URL.Query().Get("ticket"), "cookie": cookie}, nil) != nil {
				g.tunnelPage(w, r, 403, "LINK EXPIRED", "Launch link unavailable", "This one-time launch link has already been used or has expired. Start a new remote session.", false)
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "__Host-rms_session", Value: cookie, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: int(time.Until(session.ExpiresAt).Seconds())})
			http.Redirect(w, r, "/", 303)
			return
		}
		if r.URL.Path == "/raw" && r.URL.Query().Get("ticket") != "" {
			cookie := secret()
			if g.call("POST", "/internal/sessions/"+id+"/claim", map[string]string{"ticket": r.URL.Query().Get("ticket"), "cookie": cookie}, nil) == nil {
				_ = g.call("GET", "/internal/sessions/"+id, nil, &session)
				r.AddCookie(&http.Cookie{Name: "__Host-rms_session", Value: cookie})
			}
		}
		cookie, e := r.Cookie("__Host-rms_session")
		if e != nil || session.BrowserHash == "" || subtle.ConstantTimeCompare([]byte(digest(cookie.Value)), []byte(session.BrowserHash)) != 1 {
			g.tunnelPage(w, r, 403, "AUTHORIZATION REQUIRED", "Remote session not claimed", "Open the original launch link to authorize this browser session before loading the router interface.", false)
			return
		}
		// Keep the browser cookie aligned with the extended session expiry while
		// LuCI remains open in another tab.
		if maxAge := int(time.Until(session.ExpiresAt).Seconds()); maxAge > 0 {
			http.SetCookie(w, &http.Cookie{Name: "__Host-rms_session", Value: cookie.Value, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: maxAge})
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			expected := "https://" + r.Host
			if !tunnelOriginAllowed(g.Config.PublicURL, r.Host, origin, session.Protocol == "SSH_LUCI") {
				log.Printf("rms tunnel origin rejected host=%q origin=%q expected=%q path=%s", r.Host, origin, expected, r.URL.Path)
				fail(w, 403, "origin rejected")
				return
			}
		}
		g.mu.Lock()
		p := g.pairs[id]
		g.mu.Unlock()
		if p == nil && session.Protocol == "SSH_LUCI" && r.URL.Path == "/" && acceptsHTML(r) {
			w.Header().Set("Retry-After", "2")
			g.tunnelLoadingPage(w, r)
			return
		}
		if r.URL.Path == "/close" {
			if r.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			if p != nil {
				g.close(id, p)
			} else {
				_ = g.call("POST", "/internal/sessions/"+id+"/close", nil, nil)
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if p == nil && (session.Protocol == "HTTP_LUCI" || session.Protocol == "SSH_LUCI") {
			// The browser follows /launch immediately. Give the router's
			// outbound WebSocket a short, bounded window to attach before serving
			// the first LuCI document. This avoids requiring a manual refresh when
			// MQTT command delivery and tunnel attachment finish a moment later.
			deadline := time.Now().Add(10 * time.Second)
			for p == nil && time.Now().Before(deadline) {
				time.Sleep(100 * time.Millisecond)
				g.mu.Lock()
				p = g.pairs[id]
				g.mu.Unlock()
			}
		}
		if session.Protocol == "SSH_LUCI" {
			if p == nil {
				w.Header().Set("Retry-After", "2")
				g.tunnelLoadingPage(w, r)
				return
			}
			g.luci(w, r, id, p)
			return
		}
		if session.Protocol == "TERMINAL_SSH" {
			if r.URL.Path == "/ws" {
				if p == nil {
					w.Header().Set("Retry-After", "1")
					fail(w, 503, "router connecting; retry shortly")
					return
				}
				g.terminal(w, r, id, p)
				return
			}
			if r.URL.Path == "/raw" {
				if p == nil {
					w.Header().Set("Retry-After", "1")
					fail(w, 503, "router connecting; retry shortly")
					return
				}
				g.raw(w, r, id, p)
				return
			}
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				http.FileServer(http.FS(g.UI)).ServeHTTP(w, r)
				return
			}
			data, e := fs.ReadFile(g.UI, "terminal.html")
			if e != nil {
				fail(w, 503, "terminal assets unavailable")
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(terminalPage(data, session))
			return
		}
		if p == nil {
			log.Printf("rms tunnel session %s has no router pair path=%s", id, r.URL.Path)
			w.Header().Set("Retry-After", "2")
			g.tunnelLoadingPage(w, r)
			return
		}
		g.proxy(w, r, id, p)
	})
}
func (g *Gateway) router(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/router/")
	if !validID(id) || r.TLS == nil || len(r.TLS.VerifiedChains) == 0 {
		fail(w, 403, "router certificate required")
		return
	}
	var session Session
	if g.call("GET", "/internal/sessions/"+id, nil, &session) != nil || r.TLS.PeerCertificates[0].Subject.CommonName != session.DeviceID {
		fail(w, 403, "wrong router or inactive session")
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, ok := g.pairs[id]; ok || len(g.pairs) >= 25 {
		fail(w, 409, "router already connected or capacity reached")
		return
	}
	up := websocket.Upgrader{HandshakeTimeout: 10 * time.Second, CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") == "" }}
	conn, e := up.Upgrade(w, r, nil)
	if e != nil {
		return
	}
	conn.SetReadLimit(2 * 1024 * 1024)
	p := &Pair{session: session, router: conn, responses: make(chan []byte, 1), done: make(chan struct{})}
	g.pairs[id] = p
	go g.readRouter(id, p)
	go func() {
		tick := time.NewTicker(5 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-p.done:
				return
			case <-tick.C:
				var x Session
				if g.call("GET", "/internal/sessions/"+id, nil, &x) != nil {
					g.close(id, p)
					return
				}
			}
		}
	}()
}

type wsNetConn struct {
	r      io.Reader
	p      *Pair
	closed bool
	mu     sync.Mutex
}

func (c *wsNetConn) Read(b []byte) (int, error) {
	return c.r.Read(b)
}

func (c *wsNetConn) Write(b []byte) (int, error) {
	c.p.write.Lock()
	defer c.p.write.Unlock()
	c.p.router.SetWriteDeadline(time.Now().Add(10 * time.Second))
	err := c.p.router.WriteMessage(websocket.BinaryMessage, b)
	if err != nil {
		return 0, err
	}
	return len(b), nil
}

func (c *wsNetConn) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		c.p.mu.Lock()
		if c.p.routerOut != nil {
			c.p.routerOut.Close()
		}
		if c.p.routerIn != nil {
			c.p.routerIn.Close()
		}
		c.p.mu.Unlock()
	}
	return nil
}

type wsAddr string

func (a wsAddr) Network() string { return "tcp" }
func (a wsAddr) String() string  { return string(a) }

func (c *wsNetConn) LocalAddr() net.Addr                { return wsAddr("127.0.0.1:0") }
func (c *wsNetConn) RemoteAddr() net.Addr               { return wsAddr("127.0.0.1:22") }
func (c *wsNetConn) SetDeadline(t time.Time) error      { return nil }
func (c *wsNetConn) SetReadDeadline(t time.Time) error  { return nil }
func (c *wsNetConn) SetWriteDeadline(t time.Time) error { return nil }

func (g *Gateway) readRouter(id string, p *Pair) {
	defer g.close(id, p)
	for {
		kind, b, e := p.router.ReadMessage()
		if e != nil {
			return
		}
		if p.session.Protocol == "HTTP_LUCI" {
			select {
			case p.responses <- b:
			case <-p.done:
				return
			default:
				return
			}
		} else {
			// Older agents sent a text control frame containing a generated
			// LuCI cookie. Ignore that legacy frame instead of treating it as
			// SSH data; browser requests now carry the router's own login cookie.
			if p.session.Protocol == "SSH_LUCI" && kind == websocket.TextMessage {
				var control struct{ Type string `json:"type"` }
				if json.Unmarshal(b, &control) == nil && control.Type == "luci_session" {
					continue
				}
				continue
			}
			var out *io.PipeWriter
			p.mu.Lock()
			if p.routerOut != nil {
				out = p.routerOut
			} else if p.browser != nil {
				p.browser.SetWriteDeadline(time.Now().Add(10 * time.Second))
				e = p.browser.WriteMessage(websocket.BinaryMessage, b)
			} else if len(p.initial)+len(b) <= 32768 {
				p.initial = append(p.initial, b...)
			}
			p.mu.Unlock()
			if out != nil {
				_, e = out.Write(b)
			}
			if e != nil {
				return
			}
		}
	}
}

func (g *Gateway) terminal(w http.ResponseWriter, r *http.Request, id string, p *Pair) {
	p.mu.Lock()
	if p.browser != nil {
		p.mu.Unlock()
		fail(w, 409, "terminal already attached")
		return
	}
	up := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") == "https://"+r.Host }}
	b, e := up.Upgrade(w, r, nil)
	if e != nil {
		p.mu.Unlock()
		return
	}
	p.browser = b
	b.SetReadLimit(32768)

	if p.session.SSHPrivateKey == "" {
		if len(p.initial) > 0 {
			b.WriteMessage(websocket.BinaryMessage, p.initial)
			p.initial = nil
		}
		p.mu.Unlock()
		defer g.close(id, p)
		for {
			_, data, e := b.ReadMessage()
			if e != nil {
				return
			}
			p.write.Lock()
			p.router.SetWriteDeadline(time.Now().Add(10 * time.Second))
			e = p.router.WriteMessage(websocket.BinaryMessage, data)
			p.write.Unlock()
			if e != nil {
				return
			}
		}
	}

	signer, err := ssh.ParsePrivateKey([]byte(p.session.SSHPrivateKey))
	if err != nil {
		p.mu.Unlock()
		g.close(id, p)
		return
	}

	pr, pw := io.Pipe()
	initial := p.initial
	p.initial = nil
	p.routerIn = pr
	p.routerOut = pw
	p.mu.Unlock()

	defer g.close(id, p)

	conn := &wsNetConn{
		r: io.MultiReader(bytes.NewReader(initial), pr),
		p: p,
	}

	if algoSigner, ok := signer.(ssh.AlgorithmSigner); ok {
		if s, err := ssh.NewSignerWithAlgorithms(algoSigner, []string{ssh.KeyAlgoRSA}); err == nil {
			signer = s
		}
	}

	cfg := &ssh.ClientConfig{
		User:            "root",
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		HostKeyAlgorithms: []string{
			ssh.KeyAlgoRSA,
			ssh.KeyAlgoRSASHA256,
			ssh.KeyAlgoRSASHA512,
			ssh.KeyAlgoED25519,
		},
		Timeout: 10 * time.Second,
	}

	ncc, chans, reqs, err := ssh.NewClientConn(conn, "127.0.0.1:22", cfg)
	if err != nil {
		conn.Close()
		b.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nSSH handshake failed: %v\r\n", err)))
		return
	}
	client := ssh.NewClient(ncc, chans, reqs)
	defer client.Close()

	sess, err := client.NewSession()
	if err != nil {
		return
	}
	defer sess.Close()

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := sess.RequestPty("xterm-256color", 30, 100, modes); err != nil {
		return
	}

	stdin, err := sess.StdinPipe()
	if err != nil {
		return
	}
	defer stdin.Close()

	stdout, err := sess.StdoutPipe()
	if err != nil {
		return
	}

	stderr, err := sess.StderrPipe()
	if err != nil {
		return
	}

	if err := sess.Shell(); err != nil {
		return
	}

	go func() {
		_ = sess.Wait()
		b.Close()
	}()

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				p.mu.Lock()
				b.SetWriteDeadline(time.Now().Add(10 * time.Second))
				werr := b.WriteMessage(websocket.BinaryMessage, buf[:n])
				p.mu.Unlock()
				if werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				p.mu.Lock()
				b.SetWriteDeadline(time.Now().Add(10 * time.Second))
				werr := b.WriteMessage(websocket.BinaryMessage, buf[:n])
				p.mu.Unlock()
				if werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	for {
		_, data, e := b.ReadMessage()
		if e != nil {
			return
		}
		if len(data) > 0 && data[0] == '{' {
			var rmsg struct {
				Type string `json:"type"`
				Cols int    `json:"cols"`
				Rows int    `json:"rows"`
			}
			if json.Unmarshal(data, &rmsg) == nil && rmsg.Type == "resize" && rmsg.Cols > 0 && rmsg.Rows > 0 {
				sess.WindowChange(rmsg.Rows, rmsg.Cols)
				continue
			}
		}
		if _, err := stdin.Write(data); err != nil {
			return
		}
	}
}

func (g *Gateway) raw(w http.ResponseWriter, r *http.Request, id string, p *Pair) {
	p.mu.Lock()
	if p.browser != nil {
		p.mu.Unlock()
		fail(w, 409, "terminal already attached")
		return
	}
	up := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		return origin == "" || origin == "https://"+r.Host
	}}
	rawConn, err := up.Upgrade(w, r, nil)
	if err != nil {
		p.mu.Unlock()
		return
	}
	p.browser = rawConn
	rawConn.SetReadLimit(65536)
	if len(p.initial) > 0 {
		rawConn.WriteMessage(websocket.BinaryMessage, p.initial)
		p.initial = nil
	}
	p.mu.Unlock()
	defer g.close(id, p)
	for {
		_, data, e := rawConn.ReadMessage()
		if e != nil {
			return
		}
		p.write.Lock()
		p.router.SetWriteDeadline(time.Now().Add(10 * time.Second))
		e = p.router.WriteMessage(websocket.BinaryMessage, data)
		p.write.Unlock()
		if e != nil {
			return
		}
	}
}
func safeHeader(k string) bool {
	switch strings.ToLower(k) {
	case "content-type", "accept", "accept-language", "user-agent", "referer", "origin", "x-requested-with", "x-csrf-token", "cookie", "location", "set-cookie", "cache-control", "content-disposition":
		return true
	}
	return false
}
func cacheableLuCIAsset(r *http.Request, status int) bool {
	if status != http.StatusOK || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
		return false
	}
	path := r.URL.Path
	if strings.HasPrefix(path, "/cgi-bin/luci") {
		return false
	}
	if strings.HasPrefix(path, "/luci-static/") || strings.HasPrefix(path, "/cgi-bin/luci-static/") {
		return true
	}
	for _, ext := range []string{".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf"} {
		if strings.HasSuffix(strings.ToLower(path), ext) {
			return true
		}
	}
	return false
}
func (g *Gateway) proxy(w http.ResponseWriter, r *http.Request, id string, p *Pair) {
	p.httpLock.Lock()
	releaseLock := true
	defer func() {
		if releaseLock {
			p.httpLock.Unlock()
		}
	}()
	r.Body = http.MaxBytesReader(w, r.Body, 256*1024)
	b, e := io.ReadAll(r.Body)
	if e != nil {
		fail(w, 413, "request too large")
		return
	}
	headers := map[string]string{}
	for k, v := range forwardLuciRequestHeaders(r.Header) {
		if safeHeader(k) && strings.ToLower(k) != "location" {
			headers[k] = strings.Join(v, ", ")
		}
	}
	path := r.URL.RequestURI()
	// LuCI is mounted below /cgi-bin/luci on OpenWrt. The session launch
	// redirects the browser to / for a clean session URL, so map only that
	// browser-root request to LuCI's actual entry point. Other paths, including
	// /luci-static and /cgi-bin/luci, must pass through unchanged.
	if path == "/" {
		path = "/cgi-bin/luci/"
	}
	frame := HTTPFrame{Method: r.Method, Path: path, Headers: headers, Body: b}
	p.write.Lock()
	p.router.SetWriteDeadline(time.Now().Add(10 * time.Second))
	e = p.router.WriteJSON(frame)
	p.write.Unlock()
	if e != nil {
		log.Printf("rms tunnel session %s router write failed: %v", id, e)
		g.close(id, p)
		g.tunnelPage(w, r, 502, "ROUTER UNAVAILABLE", "Router connection lost", "The secure tunnel closed before the router could receive this LuCI request.", false)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	select {
	case <-ctx.Done():
		log.Printf("rms tunnel session %s request timeout/cancel path=%s: %v", id, r.URL.Path, ctx.Err())
		// LuCI routinely cancels an in-flight status request when the user
		// changes pages. Keep the tunnel alive and consume that request's
		// eventual router response before releasing httpLock, otherwise the
		// next page request can receive a stale response or a closed session.
		releaseLock = false
		go func(path string) {
			select {
			case <-p.responses:
				log.Printf("rms tunnel session %s drained canceled response path=%s", id, path)
			case <-p.done:
				log.Printf("rms tunnel session %s ended while draining path=%s", id, path)
			case <-time.After(30 * time.Second):
				log.Printf("rms tunnel session %s canceled response still pending path=%s", id, path)
			}
			p.httpLock.Unlock()
		}(r.URL.Path)
		g.tunnelPage(w, r, 504, "ROUTER TIMEOUT", "Router request timed out", "The router did not respond in time. The tunnel is still available; try the request again.", true)
	case <-p.done:
		g.tunnelPage(w, r, 502, "SESSION ENDED", "Remote session ended", "The secure tunnel closed while LuCI was loading. Start a new session from the XNET RMS device details page.", false)
	case data := <-p.responses:
		var res HTTPFrame
		if json.Unmarshal(data, &res) != nil || res.Status < 200 || res.Status > 599 {
			log.Printf("rms tunnel session %s invalid router response path=%s", id, r.URL.Path)
			g.close(id, p)
			g.tunnelPage(w, r, 502, "INVALID RESPONSE", "Router response unavailable", "The router returned an invalid response for this LuCI request. Start a new session if the problem continues.", false)
			return
		}
		for k, v := range res.Headers {
			if safeHeader(k) {
				if strings.EqualFold(k, "Location") {
					u, e := url.Parse(v)
					if e != nil {
						continue
					}
					if u.IsAbs() {
						if u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" {
							continue
						}
						v = u.RequestURI()
					}
				}
				w.Header().Set(k, v)
			}
		}
		w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
		if cacheableLuCIAsset(r, res.Status) {
			w.Header().Set("Cache-Control", "private, max-age=3600")
		} else {
			w.Header().Set("Cache-Control", "no-store")
		}
		w.WriteHeader(res.Status)
		w.Write(res.Body)
	}
}
