package rms

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gorilla/websocket"
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
	initial             []byte
	routerIn            *io.PipeReader
	routerOut           *io.PipeWriter
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
			fail(w, 404, "session host required")
			return
		}
		id := strings.TrimSuffix(host, suffix)
		if !validID(id) {
			fail(w, 404, "invalid session")
			return
		}
		var session Session
		if err := g.call("GET", "/internal/sessions/"+id, nil, &session); err != nil {
			log.Printf("rms tunnel session %s inactive: %v path=%s", id, err, r.URL.Path)
			fail(w, 403, "session inactive")
			return
		}
		log.Printf("rms tunnel session %s request path=%s protocol=%s", id, r.URL.Path, session.Protocol)
		if r.URL.Path == "/launch" {
			cookie := secret()
			if g.call("POST", "/internal/sessions/"+id+"/claim", map[string]string{"ticket": r.URL.Query().Get("ticket"), "cookie": cookie}, nil) != nil {
				fail(w, 403, "launch ticket invalid or used")
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
			fail(w, 403, "session login required")
			return
		}
		if r.Header.Get("Origin") != "" && r.Header.Get("Origin") != "https://"+r.Host {
			fail(w, 403, "origin rejected")
			return
		}
		g.mu.Lock()
		p := g.pairs[id]
		g.mu.Unlock()
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
			w.Write(data)
			return
		}
		if p == nil && session.Protocol == "HTTP_LUCI" {
			// The browser follows /launch immediately. Give the router's
			// outbound WebSocket a short, bounded window to attach so LuCI
			// does not fail its first document request during normal MQTT
			// and TLS startup latency.
			deadline := time.Now().Add(10 * time.Second)
			for p == nil && time.Now().Before(deadline) {
				time.Sleep(100 * time.Millisecond)
				g.mu.Lock()
				p = g.pairs[id]
				g.mu.Unlock()
			}
		}
		if p == nil {
			log.Printf("rms tunnel session %s has no router pair path=%s", id, r.URL.Path)
			w.Header().Set("Retry-After", "2")
			fail(w, 503, "router connecting; retry shortly")
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
		_, b, e := p.router.ReadMessage()
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
	case "content-type", "accept", "accept-language", "user-agent", "referer", "origin", "x-requested-with", "x-csrf-token", "location", "set-cookie", "cache-control", "content-disposition":
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
	for k, v := range r.Header {
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
		fail(w, 502, "router unavailable")
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
		fail(w, 504, "router timeout")
	case <-p.done:
		fail(w, 502, "session closed")
	case data := <-p.responses:
		var res HTTPFrame
		if json.Unmarshal(data, &res) != nil || res.Status < 200 || res.Status > 599 {
			log.Printf("rms tunnel session %s invalid router response path=%s", id, r.URL.Path)
			g.close(id, p)
			fail(w, 502, "invalid router response")
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
