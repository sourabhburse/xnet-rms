// Small live qualification check. Creates two test identities, then revokes them.
package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/gorilla/websocket"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"strings"
	"time"
)

const host = "xnet-rms-test.duckdns.org"
const base = "https://" + host + ":8445/api/v1/"

var client = &http.Client{Timeout: 20 * time.Second}
var bearer string

func id() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func api(method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		body = bytes.NewReader(b)
	}
	r, e := http.NewRequest(method, base+path, body)
	if e != nil {
		return e
	}
	r.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		r.Header.Set("Authorization", "Bearer "+bearer)
	}
	res, e := client.Do(r)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("%s %s: HTTP %d", method, path, res.StatusCode)
	}
	if out != nil {
		return json.NewDecoder(res.Body).Decode(out)
	}
	return nil
}
func must(e error) {
	if e != nil {
		panic(e)
	}
}
func wait(t mqtt.Token) {
	if !t.WaitTimeout(10 * time.Second) {
		panic("MQTT timeout")
	}
	must(t.Error())
}

type router struct {
	id   string
	tls  *tls.Config
	mqtt mqtt.Client
	ack  chan []byte
}

func enroll(token string) *router {
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	must(e)
	csr, e := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{}, key)
	must(e)
	var out struct {
		ID          string `json:"device_id"`
		Certificate string `json:"certificate"`
	}
	must(api("POST", "provision/check-in", map[string]any{"serial_number": "server-smoke-" + id(), "model": "simulator", "firmware_version": "test", "enrollment_token": token, "csr": string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csr}))}, &out))
	kb, e := x509.MarshalECPrivateKey(key)
	must(e)
	cert, e := tls.X509KeyPair([]byte(out.Certificate), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb}))
	must(e)
	return &router{id: out.ID, tls: &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{cert}}, ack: make(chan []byte, 10)}
}
func (r *router) connect(clientID string) {
	opts := mqtt.NewClientOptions().AddBroker("ssl://" + host + ":8883").SetClientID(clientID).SetTLSConfig(r.tls).SetConnectTimeout(10 * time.Second).SetAutoReconnect(false)
	r.mqtt = mqtt.NewClient(opts)
	wait(r.mqtt.Connect())
	wait(r.mqtt.Subscribe("rms/v1/devices/"+r.id+"/acks", 1, func(_ mqtt.Client, m mqtt.Message) {
		select {
		case r.ack <- append([]byte(nil), m.Payload()...):
		default:
		}
	}))
	wait(r.mqtt.Publish("rms/v1/devices/"+r.id+"/heartbeat", 1, false, `{"status":"online"}`))
}
func snapshots(device string) []map[string]any {
	var out []map[string]any
	must(api("GET", "devices/"+device+"/snapshots", nil, &out))
	return out
}
func main() {
	loginPath := flag.String("login-file", "", "Private initial-login.txt path on VPS")
	run := flag.Bool("run", false, "Authorize creating two simulator identities and bounded live checks")
	flag.Parse()
	if !*run || *loginPath == "" {
		fmt.Println("Use -run -login-file <private initial-login.txt>")
		return
	}
	defer func() {
		if e := recover(); e != nil {
			fmt.Fprintln(os.Stderr, "SMOKE FAILED:", e)
			os.Exit(1)
		}
	}()
	b, e := os.ReadFile(*loginPath)
	must(e)
	login := map[string]string{}
	for _, line := range strings.Split(string(b), "\n") {
		kv := strings.SplitN(line, ": ", 2)
		if len(kv) == 2 {
			login[kv[0]] = kv[1]
		}
	}
	var auth struct {
		Token string `json:"token"`
	}
	must(api("POST", "auth/login", map[string]string{"email": login["Email"], "password": login["Password"]}, &auth))
	bearer = auth.Token
	var org struct {
		ID string `json:"id"`
	}
	must(api("POST", "organizations", map[string]string{"name": "Server qualification " + time.Now().UTC().Format(time.RFC3339)}, &org))
	var token struct {
		Token string `json:"token"`
		ID    string `json:"id"`
	}
	must(api("POST", "enrollment-tokens", map[string]any{"name": "Two simulator devices", "organization_id": org.ID, "max_uses": 2}, &token))
	defer api("DELETE", "enrollment-tokens/"+token.ID, nil, nil)
	a := enroll(token.Token)
	defer api("POST", "devices/"+a.id+"/revoke", map[string]any{}, nil)
	z := enroll(token.Token)
	defer api("POST", "devices/"+z.id+"/revoke", map[string]any{}, nil)
	z.connect(z.id)
	defer z.mqtt.Disconnect(100)
	a.connect(z.id)
	defer a.mqtt.Disconnect(100)
	time.Sleep(time.Second)
	if !z.mqtt.IsConnectionOpen() {
		panic("certificate identity did not prevent client-ID takeover")
	}
	fmt.Println("PASS: certificate identity prevents MQTT client-ID takeover")
	fmt.Println("PASS: two devices enrolled and connected with client certificates")
	var profile struct {
		ID string `json:"id"`
	}
	must(api("POST", "profiles", map[string]any{"name": "Server smoke", "version": 1, "source_id": "smoke", "type": "ubus", "object": "system", "method": "info", "interval_seconds": 60, "timeout_seconds": 5, "max_output_bytes": 1024, "fields": []any{map[string]string{"id": "value", "path": "/value", "kind": "gauge", "label": "Value", "unit": ""}}}, &profile))
	for _, r := range []*router{a, z} {
		must(api("POST", "devices/"+r.id+"/profiles", map[string]any{"profile_id": profile.ID, "version": 1}, nil))
	}
	envelope := map[string]any{"schema_version": 1, "device_id": a.id, "source_id": "smoke", "profile_id": profile.ID, "profile_version": 1, "boot_id": id(), "sequence": 1, "observed_at": time.Now().UTC().Format(time.RFC3339Nano), "status": "ok", "error": "", "dropped": 0, "data": map[string]int{"value": 42}}
	payload, _ := json.Marshal(envelope)
	for i := 0; i < 2; i++ {
		wait(a.mqtt.Publish("rms/v1/devices/"+a.id+"/snapshots", 1, false, payload))
		select {
		case <-a.ack:
		case <-time.After(15 * time.Second):
			panic("application ACK missing")
		}
	}
	if len(snapshots(a.id)) != 1 {
		panic("current snapshot missing")
	}
	var history []map[string]any
	must(api("GET", "devices/"+a.id+"/history?source=smoke", nil, &history))
	if len(history) != 1 {
		panic("duplicate history record")
	}
	fmt.Println("PASS: commit-before-ACK path, replay ACK and deduplicated history")
	envelope["device_id"] = z.id
	payload, _ = json.Marshal(envelope)
	wait(a.mqtt.Publish("rms/v1/devices/"+z.id+"/snapshots", 1, false, payload))
	time.Sleep(2 * time.Second)
	if len(snapshots(z.id)) != 0 {
		panic("cross-device MQTT publication accepted")
	}
	fmt.Println("PASS: broker denied cross-device snapshot publication")
	var session struct {
		ID     string `json:"id"`
		Launch string `json:"launch_url"`
	}
	must(api("POST", "sessions", map[string]string{"device_id": a.id, "protocol": "HTTP_LUCI"}, &session))
	defer api("DELETE", "sessions/"+session.ID, nil, nil)
	dial := websocket.Dialer{TLSClientConfig: z.tls, HandshakeTimeout: 10 * time.Second}
	conn, response, err := dial.Dial("wss://"+host+":9443/router/"+session.ID, nil)
	if err == nil {
		conn.Close()
		panic("wrong router attached")
	}
	if response == nil || response.StatusCode != 403 {
		panic("wrong-router rejection not verified")
	}
	response.Body.Close()
	dial.TLSClientConfig = a.tls
	conn, _, e = dial.Dial("wss://"+host+":9443/router/"+session.ID, nil)
	must(e)
	defer conn.Close()
	go func() {
		for {
			var request map[string]any
			if conn.ReadJSON(&request) != nil {
				return
			}
			if conn.WriteJSON(map[string]any{"status": 200, "headers": map[string]string{"Content-Type": "text/plain"}, "body": []byte("simulated router response")}) != nil {
				return
			}
		}
	}()
	jar, _ := cookiejar.New(nil)
	browser := &http.Client{Jar: jar, Timeout: 20 * time.Second}
	res, e := browser.Get(session.Launch)
	must(e)
	data, e := io.ReadAll(res.Body)
	res.Body.Close()
	must(e)
	if res.StatusCode != 200 || string(data) != "simulated router response" {
		panic("isolated HTTP proxy failed")
	}
	err = api("POST", "sessions", map[string]string{"device_id": a.id, "protocol": "HTTP_LUCI"}, nil)
	if err == nil || !strings.Contains(err.Error(), "409") {
		panic("busy session not rejected")
	}
	must(api("DELETE", "sessions/"+session.ID, nil, nil))
	res, e = browser.Get("https://" + session.ID + "." + host + ":9443/")
	must(e)
	res.Body.Close()
	if res.StatusCode != 403 {
		panic(errors.New("closed browser session still accessible"))
	}
	fmt.Println("PASS: wrong-router rejection, wildcard HTTPS proxy, busy session and closure")
	fmt.Println("SERVER SMOKE PASSED; simulator identities revoked on exit. Physical router behavior remains untested.")
}
