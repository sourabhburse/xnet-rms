package main

import (
	"crypto/tls"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"

	"github.com/gorilla/websocket"
)

func main() {
	if len(os.Args) < 2 {
		log.Fatalf("Usage: %s <ws(s)://url>", os.Args[0])
	}
	rawURL := os.Args[1]
	u, err := url.Parse(rawURL)
	if err != nil {
		log.Fatalf("invalid url: %v", err)
	}

	dialer := websocket.Dialer{TLSClientConfig: &tls.Config{}}
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
