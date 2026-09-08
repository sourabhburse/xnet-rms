package main

import (
	"crypto/tls"
	"crypto/x509"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"

	"github.com/gorilla/websocket"
)

func main() {
	caPath := flag.String("ca", "", "PEM CA certificate to trust for the RMS tunnel")
	flag.Parse()
	if flag.NArg() != 1 {
		log.Fatalf("Usage: %s [-ca ca.crt] <launch-url>", os.Args[0])
	}
	u, err := proxyURL(flag.Arg(0))
	if err != nil {
		log.Fatalf("invalid url: %v", err)
	}

	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}
	if *caPath != "" {
		pem, err := os.ReadFile(*caPath)
		if err != nil {
			log.Fatalf("read CA certificate: %v", err)
		}
		pool, err := x509.SystemCertPool()
		if err != nil || pool == nil {
			pool = x509.NewCertPool()
		}
		if !pool.AppendCertsFromPEM(pem) {
			log.Fatalf("CA file does not contain a PEM certificate")
		}
		tlsConfig.RootCAs = pool
	}
	dialer := websocket.Dialer{TLSClientConfig: tlsConfig}
	headers := http.Header{}
	ws, _, err := dialer.Dial(u.String(), headers)
	if err != nil {
		log.Fatalf("websocket dial failed: %v", err)
	}
	defer ws.Close()

	// ws -> stdout
	go func() {
		for {
			_, msg, err := ws.ReadMessage()
			if err != nil {
				os.Exit(0)
			}
			os.Stdout.Write(msg)
		}
	}()

	// stdin -> ws
	buf := make([]byte, 4096)
	for {
		n, err := os.Stdin.Read(buf)
		if n > 0 {
			if err := ws.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				os.Exit(0)
			}
		}
		if err != nil {
			if err == io.EOF {
				ws.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
			}
			os.Exit(0)
		}
	}
}

// proxyURL accepts the launch URL returned by the RMS API as well as a raw
// ws:// or wss:// endpoint. The launch endpoint is intentionally converted to
// /raw so the helper can be used as an OpenSSH ProxyCommand without following
// an HTTP redirect or exposing the session cookie to a shell.
func proxyURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil, err
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	case "ws", "wss":
	default:
		return nil, fmt.Errorf("URL must use http(s) or ws(s)")
	}
	if u.Path == "/launch" {
		if u.Query().Get("ticket") == "" {
			return nil, fmt.Errorf("launch URL is missing its ticket")
		}
		u.Path = "/raw"
	}
	return u, nil
}
