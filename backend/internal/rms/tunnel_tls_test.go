package rms

import (
	"crypto/tls"
	"crypto/x509"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestTunnelBrowserTLSDoesNotRequestClientCertificate(t *testing.T) {
	dir := t.TempDir()
	domain := "rms.test"
	sessionHost := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa." + domain
	if err := InitPKI(dir, []string{domain, "*." + domain}); err != nil {
		t.Fatal(err)
	}
	config, err := TLSConfig(dir, "server", true)
	if err != nil {
		t.Fatal(err)
	}
	ConfigureTunnelTLS(config, domain)
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/router/test" && len(r.TLS.VerifiedChains) == 0 {
			w.WriteHeader(403)
			return
		}
		w.WriteHeader(204)
	}))
	server.TLS = config
	server.StartTLS()
	defer server.Close()
	ca, err := os.ReadFile(filepath.Join(dir, "ca.crt"))
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(ca)
	for _, tc := range []struct {
		name, host, path string
		requested        bool
		status           int
	}{
		{"browser", sessionHost, "/", false, 204},
		{"browser cannot impersonate router", sessionHost, "/router/test", false, 403},
		{"router requires identity", domain, "/router/test", true, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requested := false
			transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, ServerName: tc.host, GetClientCertificate: func(*tls.CertificateRequestInfo) (*tls.Certificate, error) {
				requested = true
				return &tls.Certificate{}, nil
			}}}
			defer transport.CloseIdleConnections()
			client := &http.Client{Transport: transport}
			res, err := client.Get(server.URL + tc.path)
			if err != nil {
				t.Fatal(err)
			}
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
			if requested != tc.requested || res.StatusCode != tc.status {
				t.Fatalf("certificate requested=%v status=%d", requested, res.StatusCode)
			}
		})
	}
}
