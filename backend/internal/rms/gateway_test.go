package rms

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"io"
	"net"
	"net/http"
	"net/url"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestCacheableLuCIAsset(t *testing.T) {
	for _, path := range []string{"/luci-static/resources/luci.js?v=git-1", "/luci-static/resources/cascade.css", "/brand.png"} {
		r := &http.Request{Method: http.MethodGet, URL: &url.URL{Path: path}}
		if !cacheableLuCIAsset(r, http.StatusOK) {
			t.Errorf("expected cacheable asset: %s", path)
		}
	}
	for _, path := range []string{"/cgi-bin/luci/admin/status/overview", "/cgi-bin/luci/admin/uci/apply", "/cgi-bin/luci/admin/ubus"} {
		r := &http.Request{Method: http.MethodGet, URL: &url.URL{Path: path}}
		if cacheableLuCIAsset(r, http.StatusOK) {
			t.Errorf("expected dynamic path to remain uncached: %s", path)
		}
	}
	post := &http.Request{Method: http.MethodPost, URL: &url.URL{Path: "/luci-static/resources/luci.js"}}
	if cacheableLuCIAsset(post, http.StatusOK) {
		t.Fatal("cached a non-GET request")
	}
}

func TestLuciUpstreamPathMapsUbusEndpoint(t *testing.T) {
	for _, tc := range []struct {
		request, want string
	}{
		{"/", "/cgi-bin/luci/"},
		{"/ubus/?session=1", "/cgi-bin/luci/admin/ubus/?session=1"},
		{"/ubus", "/cgi-bin/luci/admin/ubus"},
		{"/luci-static/resources/ui.js?v=1", "/luci-static/resources/ui.js?v=1"},
	} {
		path := luciUpstreamPath(tc.request)
		if path != tc.want {
			t.Errorf("upstream path for %q = %q, want %q", tc.request, path, tc.want)
		}
	}
}

func TestForwardLuciRequestHeadersPreservesRouterLoginCookie(t *testing.T) {
	in := http.Header{
		"Cookie":     []string{"__Host-rms_session=rms-session; sysauth=router-session"},
		"Connection": []string{"keep-alive"},
		"User-Agent": []string{"test-browser"},
	}
	out := forwardLuciRequestHeaders(in)
	if got := out.Get("Cookie"); got != "sysauth=router-session" {
		t.Fatalf("router login cookie was not forwarded: %q", got)
	}
	if out.Get("Connection") != "" {
		t.Fatal("hop-by-hop connection header was forwarded")
	}
	if out.Get("User-Agent") != "test-browser" {
		t.Fatal("browser headers were not preserved")
	}
	if !safeHeader("Cookie") {
		t.Fatal("router login cookie is not an allowed proxy header")
	}
}

func TestSameOriginNormalizesEquivalentHTTPSOrigins(t *testing.T) {
	for _, tc := range []struct {
		expected, actual string
		want            bool
	}{
		{"https://example.test", "https://EXAMPLE.TEST:443", true},
		{"https://example.test:8445", "https://example.test:8445", true},
		{"https://example.test:8445/", "https://example.test:8445", true},
		{"https://example.test:8445", "https://example.test", false},
		{"https://example.test:8445", "http://example.test:8445", false},
		{"https://example.test:8445", "https://example.test:8445/path", false},
	} {
		if got := sameOrigin(tc.expected, tc.actual); got != tc.want {
			t.Errorf("sameOrigin(%q, %q) = %v, want %v", tc.expected, tc.actual, got, tc.want)
		}
	}
}

func TestTunnelOriginAllowsAuthenticatedDashboardOrigin(t *testing.T) {
	if !tunnelOriginAllowed("https://dashboard.example:8445", "session.dashboard.example:9443", "https://dashboard.example:8445", false) {
		t.Fatal("dashboard origin should be accepted for an authenticated tunnel session")
	}
	if tunnelOriginAllowed("https://dashboard.example:8445", "session.dashboard.example:9443", "https://other.example:8445", false) {
		t.Fatal("unrelated origin should remain rejected")
	}
	if !tunnelOriginAllowed("https://dashboard.example:8445", "session.dashboard.example:9443", "null", true) {
		t.Fatal("opaque LuCI origin should be accepted after session authentication")
	}
	if tunnelOriginAllowed("https://dashboard.example:8445", "session.dashboard.example:9443", "null", false) {
		t.Fatal("opaque terminal origin should remain rejected")
	}
}

func TestTunnelPageRendersHTMLForDocumentRequests(t *testing.T) {
	g := &Gateway{Config: Config{PublicURL: "https://rms.example"}}
	r := httptest.NewRequest(http.MethodGet, "https://session.rms.example/", nil)
	r.Header.Set("Accept", "text/html,application/xhtml+xml")
	w := httptest.NewRecorder()

	g.tunnelPage(w, r, http.StatusBadGateway, "SESSION ENDED", "Remote session ended", "The secure tunnel closed while LuCI was loading.", false)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusBadGateway)
	}
	if got := w.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Fatalf("content type = %q", got)
	}
	body := w.Body.String()
	for _, want := range []string{"XNET RMS", "Remote session ended", "The secure tunnel closed", "Open XNET RMS", "Close tab"} {
		if !strings.Contains(body, want) {
			t.Errorf("HTML page does not contain %q", want)
		}
	}
}

func TestTunnelPageKeepsJSONForNonDocumentRequests(t *testing.T) {
	g := &Gateway{}
	r := httptest.NewRequest(http.MethodGet, "https://session.rms.example/ubus", nil)
	r.Header.Set("Accept", "application/json")
	w := httptest.NewRecorder()

	g.tunnelPage(w, r, http.StatusBadGateway, "SESSION ENDED", "Remote session ended", "The secure tunnel closed.", false)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusBadGateway)
	}
	if got := w.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("content type = %q, want application/json", got)
	}
	if strings.Contains(w.Body.String(), "<html") {
		t.Fatal("non-document request received an HTML page")
	}
}

func TestWsNetConnAdapter(t *testing.T) {
	pr, pw := io.Pipe()
	defer pr.Close()
	defer pw.Close()

	initial := []byte("SSH-2.0-Dropbear_2019.78\r\n")
	conn := &wsNetConn{
		r: io.MultiReader(bytes.NewReader(initial), pr),
		p: &Pair{},
	}

	buf := make([]byte, 64)
	n, err := conn.Read(buf)
	if err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if !bytes.Contains(buf[:n], []byte("SSH-2.0-Dropbear")) {
		t.Errorf("unexpected banner: %s", string(buf[:n]))
	}

	if conn.LocalAddr().String() != "127.0.0.1:0" {
		t.Errorf("unexpected LocalAddr: %s", conn.LocalAddr().String())
	}
	if conn.RemoteAddr().String() != "127.0.0.1:22" {
		t.Errorf("unexpected RemoteAddr: %s", conn.RemoteAddr().String())
	}
}

func TestSSHClientBridgeHandshake(t *testing.T) {
	// Generate server host key
	_, serverPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("host key gen failed: %v", err)
	}
	serverSigner, err := ssh.NewSignerFromKey(serverPriv)
	if err != nil {
		t.Fatalf("signer failed: %v", err)
	}

	// Generate client key
	clientPub, clientPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("client key gen failed: %v", err)
	}
	clientSigner, err := ssh.NewSignerFromKey(clientPriv)
	if err != nil {
		t.Fatalf("client signer failed: %v", err)
	}
	clientSSHPub, err := ssh.NewPublicKey(clientPub)
	if err != nil {
		t.Fatalf("client ssh pubkey failed: %v", err)
	}

	serverConfig := &ssh.ServerConfig{
		PublicKeyCallback: func(conn ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			if bytes.Equal(key.Marshal(), clientSSHPub.Marshal()) {
				return nil, nil
			}
			return nil, ssh.ErrNoAuth
		},
	}
	serverConfig.AddHostKey(serverSigner)

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}
	defer l.Close()

	serverDone := make(chan struct{})
	go func() {
		defer close(serverDone)
		c1, err := l.Accept()
		if err != nil {
			return
		}
		defer c1.Close()

		sConn, chans, reqs, sErr := ssh.NewServerConn(c1, serverConfig)
		if sErr != nil {
			t.Errorf("server handshake failed: %v", sErr)
			return
		}
		defer sConn.Close()
		go ssh.DiscardRequests(reqs)

		for newChannel := range chans {
			if newChannel.ChannelType() != "session" {
				newChannel.Reject(ssh.UnknownChannelType, "unknown channel type")
				continue
			}
			channel, requests, cErr := newChannel.Accept()
			if cErr != nil {
				t.Errorf("accept channel failed: %v", cErr)
				return
			}
			defer channel.Close()

			go func() {
				for req := range requests {
					switch req.Type {
					case "pty-req":
						req.Reply(true, nil)
					case "shell":
						req.Reply(true, nil)
						channel.Write([]byte("root@router:~# "))
					default:
						req.Reply(false, nil)
					}
				}
			}()

			buf := make([]byte, 128)
			n, _ := channel.Read(buf)
			if string(buf[:n]) == "uname -a\n" {
				channel.Write([]byte("Linux router 5.4.0 mips\r\n"))
			}
			return
		}
	}()

	c2, err := net.Dial("tcp", l.Addr().String())
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer c2.Close()

	clientConfig := &ssh.ClientConfig{
		User:            "root",
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(clientSigner)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         5 * time.Second,
	}

	ncc, chans, reqs, err := ssh.NewClientConn(c2, "127.0.0.1:22", clientConfig)
	if err != nil {
		t.Fatalf("client handshake failed: %v", err)
	}
	client := ssh.NewClient(ncc, chans, reqs)
	defer client.Close()

	sess, err := client.NewSession()
	if err != nil {
		t.Fatalf("client session failed: %v", err)
	}
	defer sess.Close()

	if err := sess.RequestPty("xterm-256color", 30, 100, ssh.TerminalModes{ssh.ECHO: 1}); err != nil {
		t.Fatalf("request pty failed: %v", err)
	}

	stdin, err := sess.StdinPipe()
	if err != nil {
		t.Fatalf("stdin failed: %v", err)
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout failed: %v", err)
	}

	if err := sess.Shell(); err != nil {
		t.Fatalf("shell failed: %v", err)
	}

	buf := make([]byte, 128)
	n, err := stdout.Read(buf)
	if err != nil {
		t.Fatalf("stdout read prompt failed: %v", err)
	}
	if !bytes.Contains(buf[:n], []byte("root@router")) {
		t.Errorf("expected prompt, got: %s", string(buf[:n]))
	}

	if _, err := stdin.Write([]byte("uname -a\n")); err != nil {
		t.Fatalf("stdin write failed: %v", err)
	}

	n, err = stdout.Read(buf)
	if err != nil {
		t.Fatalf("stdout read response failed: %v", err)
	}
	if !bytes.Contains(buf[:n], []byte("Linux router")) {
		t.Errorf("expected Linux router, got: %s", string(buf[:n]))
	}

	<-serverDone
}
