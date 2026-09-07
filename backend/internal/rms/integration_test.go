package rms

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"github.com/golang-jwt/jwt/v5"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

// Uses a fresh schema, never drops or truncates an existing application schema.
func TestPostgresLifecycle(t *testing.T) {
	dsn := os.Getenv("RMS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set RMS_TEST_DATABASE_URL for PostgreSQL integration tests")
	}
	db, e := OpenDB(dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	schema := "rms_test_" + randomID()
	if _, e = db.Exec("CREATE SCHEMA " + schema); e != nil {
		t.Fatal(e)
	}
	defer db.Exec("DROP SCHEMA " + schema + " CASCADE")
	if _, e = db.Exec("SET search_path TO " + schema); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 2; i++ {
		if e = Migrate(db); e != nil {
			t.Fatal(e)
		}
	}
	if e = CheckSchema(db); e != nil {
		t.Fatal(e)
	}
	now := time.Now().UTC()
	if e = Partitions(db, now); e != nil {
		t.Fatal(e)
	}
	dir := t.TempDir()
	if e = InitPKI(dir, []string{"localhost"}); e != nil {
		t.Fatal(e)
	}
	ca, _ := LoadAuthority(dir)
	core := &Core{DB: db, CA: ca, Config: Config{PKIDir: dir, PublicURL: "https://localhost", MQTTPublicHost: "localhost", TunnelDomain: "remote.localhost", TunnelPort: "9443", RevokedDir: t.TempDir()}}
	t.Setenv("JWT_SECRET", "12345678901234567890123456789012ab")
	org, other, admin, viewer := randomID(), randomID(), randomID(), randomID()
	must := func(q string, args ...any) {
		t.Helper()
		if _, e := db.Exec(q, args...); e != nil {
			t.Fatal(e)
		}
	}
	must("INSERT INTO organizations VALUES($1,'one'),($2,'two')", org, other)
	must("INSERT INTO users(id,organization_id,email,password_hash,role) VALUES($1,$2,'admin@one','unused','ORG_ADMIN'),($3,$4,'viewer@two','unused','VIEWER')", admin, org, viewer, other)
	token := secret()
	must("INSERT INTO enrollment_tokens(id,organization_id,name,token_hash,max_uses) VALUES($1,$2,'imported',$3,1)", randomID(), org, digest(token))
	request := func(method, path, user string, v any) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, bytes.NewReader(raw(v)))
		if user != "" {
			tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": user, "iss": "xnet-rms", "exp": now.Add(time.Hour).Unix()})
			signed, _ := tok.SignedString([]byte(os.Getenv("JWT_SECRET")))
			r.Header.Set("Authorization", "Bearer "+signed)
		}
		w := httptest.NewRecorder()
		core.Handler().ServeHTTP(w, r)
		return w
	}
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	csr, _ := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{}, key)
	enrollment := map[string]any{"serial_number": "XE33-test", "model": "XE33 2S", "firmware_version": "test", "enrollment_token": token, "csr": string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csr}))}
	w := request("POST", "/api/v1/provision/check-in", "", enrollment)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var result map[string]any
	json.Unmarshal(w.Body.Bytes(), &result)
	id := result["device_id"].(string)
	w = request("POST", "/api/v1/provision/check-in", "", enrollment)
	if w.Code != 200 {
		t.Fatal("idempotent enroll", w.Code, w.Body.String())
	}
	enrollment["serial_number"] = "second"
	if w = request("POST", "/api/v1/provision/check-in", "", enrollment); w.Code != 403 {
		t.Fatal("token use bound", w.Code)
	}
	enrollment["serial_number"] = "XE33-test"
	otherKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	csr, _ = x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{}, otherKey)
	enrollment["csr"] = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csr}))
	if w = request("POST", "/api/v1/provision/check-in", "", enrollment); w.Code != 409 {
		t.Fatal("identity overwrite", w.Code)
	}
	for _, path := range []string{"snapshots", "history"} {
		if w = request("GET", "/api/v1/devices/"+id+"/"+path, viewer, nil); w.Code != 404 {
			t.Fatal("cross customer read", w.Code)
		}
	}
	if w = request("POST", "/api/v1/profiles", admin, map[string]any{}); w.Code != 403 {
		t.Fatal("customer changed profile", w.Code)
	}
	if w = request("POST", "/api/v1/sessions", viewer, map[string]any{"device_id": id, "protocol": "HTTP_LUCI"}); w.Code != 403 {
		t.Fatal("viewer remote access", w.Code)
	}
	w = request("POST", "/api/v1/provision/challenge", "", map[string]string{"device_id": id})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	h := sha256.Sum256([]byte(result["message"].(string)))
	sig, _ := ecdsa.SignASN1(rand.Reader, key, h[:])
	proof := map[string]any{"device_id": id, "challenge_id": result["challenge_id"], "signature": base64.StdEncoding.EncodeToString(sig)}
	if w = request("POST", "/api/v1/provision/recover", "", proof); w.Code != 200 {
		t.Fatal("recovery", w.Body.String())
	}
	if w = request("POST", "/api/v1/provision/recover", "", proof); w.Code != 403 {
		t.Fatal("replayed challenge", w.Code)
	}
	p := Profile{ID: randomID(), Version: 1, SourceID: "custom", Name: "Custom", Type: "ubus", Object: "system", Method: "info", Interval: 60, Timeout: 5, MaxOutput: 32768, Fields: []Field{{ID: "value", Path: "/value", Kind: "gauge"}}}
	must("INSERT INTO profiles VALUES($1,1,'custom',$2)", p.ID, string(raw(p)))
	must("INSERT INTO assignments VALUES($1,$2,1,true)", id, p.ID)
	acks := 0
	core.Publish = func(topic string, v any) error {
		if topic == "rms/v1/devices/"+id+"/acks" {
			acks++
		}
		return nil
	}
	snap := Snapshot{Schema: 1, DeviceID: id, SourceID: p.SourceID, ProfileID: p.ID, ProfileVersion: 1, BootID: randomID(), Sequence: 1, ObservedAt: now, Status: "ok", Data: []byte(`{"value":42}`)}
	for i := 0; i < 2; i++ {
		if e = core.Ingest(id, raw(snap), now); e != nil {
			t.Fatal(e)
		}
	}
	var n int
	db.QueryRow("SELECT count(*) FROM snapshot_history").Scan(&n)
	if n != 1 || acks != 2 {
		t.Fatal("dedup/ack", n, acks)
	}
	snap.Sequence = 2
	snap.ObservedAt = now.Add(-time.Minute)
	if e = core.Ingest(id, raw(snap), now); e != nil {
		t.Fatal(e)
	}
	db.QueryRow("SELECT sequence FROM current_snapshots WHERE device_id=$1", id).Scan(&n)
	if n != 1 {
		t.Fatal("late snapshot replaced current")
	}
	for {
		ok, e := rollupOne(db)
		if e != nil {
			t.Fatal(e)
		}
		if !ok {
			break
		}
	}
	must("UPDATE devices SET last_seen=now() WHERE id=$1", id)
	if w = request("GET", "/api/v1/devices", admin, nil); w.Code != 200 {
		t.Fatal("fleet", w.Body.String())
	}
	if w = request("POST", "/api/v1/sessions", admin, map[string]any{"device_id": id, "protocol": "HTTP_LUCI"}); w.Code != 201 {
		t.Fatal("session", w.Body.String())
	}
	if w = request("POST", "/api/v1/sessions", admin, map[string]any{"device_id": id, "protocol": "HTTP_LUCI"}); w.Code != 409 {
		t.Fatal("busy", w.Code)
	}
	must("UPDATE devices SET revoked=true WHERE id=$1", id)
	snap.Sequence = 3
	if e = core.Ingest(id, raw(snap), now); e == nil {
		t.Fatal("revoked telemetry accepted")
	}
	if acks != 3 {
		t.Fatal("ack before successful commit", acks)
	}
	t.Log(fmt.Sprintf("schema %s: enrollment, identity, recovery replay, isolation, ingestion, late data, rollups and busy session passed", schema))
}
