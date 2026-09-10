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
	"strings"
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
	enrollment := map[string]any{"serial_number": "XE33-test", "model": "XE33 2S", "firmware_version": "test", "agent_version": "2.3.0", "enrollment_token": token, "csr": string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csr}))}
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
	if w = request("POST", "/api/v1/profiles", viewer, map[string]any{}); w.Code != 403 {
		t.Fatal("viewer changed profile", w.Code)
	}
	if w = request("POST", "/api/v1/profiles", admin, map[string]any{}); w.Code != 403 {
		t.Fatal("organization admin reached raw collector API", w.Code)
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
	must("INSERT INTO profiles(id,version,name,definition,organization_id) VALUES($1,1,'custom',$2,$3)", p.ID, string(raw(p)), org)
	must("INSERT INTO assignments VALUES($1,$2,1,true)", id, p.ID)
	acks := 0
	var lastCommand map[string]any
	core.Publish = func(topic string, v any) error {
		if topic == "rms/v1/devices/"+id+"/acks" {
			acks++
		} else if topic == "rms/v1/devices/"+id+"/commands" {
			lastCommand, _ = v.(map[string]any)
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

	// Customer templates use only catalog IDs. A direct binding compiles the
	// selected source into the existing profile contract and drives alerts.
	templateBody := map[string]any{"name": "CPU health", "description": "integration", "definition": map[string]any{"catalog_version": 1, "interval_seconds": 60, "metrics": []any{map[string]any{"metric_id": "system.cpu_usage", "threshold": map[string]any{"warning": map[string]any{"operator": "gt", "value": 50}, "critical": map[string]any{"operator": "gt", "value": 90}}}}, "stale": map[string]any{"enabled": true, "severity": "warning", "missed_intervals": 2}}}
	w = request("POST", "/api/v1/monitoring/templates", admin, templateBody)
	if w.Code != 201 {
		t.Fatal("template create", w.Code, w.Body.String())
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	templateID := result["id"].(string)
	w = request("POST", "/api/v1/monitoring/bindings", admin, map[string]any{"template_id": templateID, "target_type": "device", "target_id": id})
	if w.Code != 201 {
		t.Fatal("template bind", w.Code, w.Body.String())
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	directBindingID := result["id"].(string)
	var compiledID string
	e = db.QueryRow(`SELECT p.id FROM profiles p JOIN assignments a ON a.profile_id=p.id AND a.version=p.version
		WHERE a.device_id=$1 AND a.active AND p.definition->>'source_id'='device_overview' AND p.id<>$2`, id, DeviceOverviewProfileID).Scan(&compiledID)
	if e != nil {
		t.Fatal("compiled profile", e)
	}
	w = request("POST", "/api/v1/monitoring/previews", admin, map[string]any{"device_id": id, "metric_ids": []string{"system.cpu_usage"}})
	if w.Code != 202 {
		t.Fatal("preview dispatch", w.Code, w.Body.String())
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	previewID := result["id"].(string)
	if lastCommand["action"] != "preview_collect" {
		t.Fatal("preview did not dispatch approved collector command", lastCommand)
	}
	core.acceptMonitoringPreview(id, raw(map[string]any{"request_id": previewID, "source_id": "device_overview", "observed_at": now, "status": "ok", "data": map[string]any{"cpu_usage_percent": 12.5}}))
	w = request("GET", "/api/v1/monitoring/previews/"+previewID, admin, nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"complete"`) || !strings.Contains(w.Body.String(), `"available":true`) {
		t.Fatal("preview result", w.Code, w.Body.String())
	}
	boot := randomID()
	pushCPU := func(sequence int64, value float64) {
		t.Helper()
		x := Snapshot{Schema: 1, DeviceID: id, SourceID: "device_overview", ProfileID: compiledID, ProfileVersion: 1, BootID: boot, Sequence: sequence, ObservedAt: now.Add(time.Duration(sequence) * time.Minute), Status: "ok", Data: []byte(fmt.Sprintf(`{"cpu_usage_percent":%g}`, value))}
		if e := core.Ingest(id, raw(x), x.ObservedAt); e != nil {
			t.Fatal(e)
		}
	}
	pushCPU(1, 60)
	pushCPU(2, 60)
	var alertID, alertStatus, alertSeverity string
	if e = db.QueryRow("SELECT id,status,severity FROM alerts WHERE template_id=$1 AND status<>'RESOLVED'", templateID).Scan(&alertID, &alertStatus, &alertSeverity); e != nil || alertStatus != "OPEN" || alertSeverity != "warning" {
		t.Fatal("warning debounce", alertID, alertStatus, alertSeverity, e)
	}
	if w = request("POST", "/api/v1/alerts/"+alertID+"/acknowledge", admin, map[string]any{}); w.Code != 200 {
		t.Fatal("acknowledge", w.Code, w.Body.String())
	}
	pushCPU(3, 95)
	pushCPU(4, 95)
	if e = db.QueryRow("SELECT status,severity FROM alerts WHERE id=$1", alertID).Scan(&alertStatus, &alertSeverity); e != nil || alertStatus != "OPEN" || alertSeverity != "critical" {
		t.Fatal("critical escalation", alertStatus, alertSeverity, e)
	}
	pushCPU(5, 10)
	pushCPU(6, 10)
	var reason string
	if e = db.QueryRow("SELECT status,resolution_reason FROM alerts WHERE id=$1", alertID).Scan(&alertStatus, &reason); e != nil || alertStatus != "RESOLVED" || reason != "recovered" {
		t.Fatal("automatic recovery", alertStatus, reason, e)
	}
	for {
		ok, err := rollupOne(db)
		if err != nil {
			t.Fatal(err)
		}
		if !ok {
			break
		}
	}
	reportBody := map[string]any{"scope_type": "device", "scope_id": id, "template_id": templateID, "from": now.Add(-time.Hour).Format(time.RFC3339), "to": now.Add(24 * time.Hour).Format(time.RFC3339), "resolution": "hour", "page_size": 10}
	if w = request("POST", "/api/v1/reports/telemetry/query", admin, reportBody); w.Code != 200 {
		t.Fatal("report query", w.Code, w.Body.String())
	}
	if w = request("POST", "/api/v1/reports/telemetry/export.csv", admin, reportBody); w.Code != 200 || !strings.Contains(w.Body.String(), "cpu_usage_percent") {
		t.Fatal("report CSV", w.Code, w.Body.String())
	}

	// Group/tag membership is dynamic, while overlapping source requests compile
	// to one profile at the shortest effective interval.
	w = request("POST", "/api/v1/groups", admin, map[string]any{"name": "Inherited monitoring", "description": "integration"})
	if w.Code != 201 {
		t.Fatal("group create", w.Code, w.Body.String())
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	groupID := result["id"].(string)
	if w = request("PUT", "/api/v1/groups/"+groupID+"/devices/"+id, admin, nil); w.Code != 204 {
		t.Fatal("group membership", w.Code, w.Body.String())
	}
	inheritedBody := map[string]any{"name": "Inherited system", "description": "integration", "definition": map[string]any{"catalog_version": 1, "interval_seconds": 300, "metrics": []any{map[string]any{"metric_id": "system.memory_used"}}, "stale": map[string]any{"enabled": false}}}
	w = request("POST", "/api/v1/monitoring/templates", admin, inheritedBody)
	if w.Code != 201 {
		t.Fatal("inherited template", w.Code, w.Body.String())
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	inheritedTemplateID := result["id"].(string)
	if w = request("POST", "/api/v1/monitoring/bindings", admin, map[string]any{"template_id": inheritedTemplateID, "target_type": "group", "target_id": groupID, "interval_seconds": 120}); w.Code != 201 {
		t.Fatal("group binding", w.Code, w.Body.String())
	}
	var effectiveInterval int
	if e = db.QueryRow(`SELECT (p.definition->>'interval_seconds')::integer FROM monitoring_effective_assignments m JOIN profiles p ON p.id=m.profile_id AND p.version=m.profile_version WHERE m.device_id=$1 AND m.source_id='device_overview'`, id).Scan(&effectiveInterval); e != nil || effectiveInterval != 60 {
		t.Fatal("overlapping fastest interval", effectiveInterval, e)
	}
	if w = request("DELETE", "/api/v1/monitoring/bindings/"+directBindingID, admin, nil); w.Code != 204 {
		t.Fatal("direct unassignment", w.Code, w.Body.String())
	}
	if e = db.QueryRow(`SELECT (p.definition->>'interval_seconds')::integer FROM monitoring_effective_assignments m JOIN profiles p ON p.id=m.profile_id AND p.version=m.profile_version WHERE m.device_id=$1 AND m.source_id='device_overview'`, id).Scan(&effectiveInterval); e != nil || effectiveInterval != 120 {
		t.Fatal("group inherited interval", effectiveInterval, e)
	}
	if w = request("DELETE", "/api/v1/groups/"+groupID+"/devices/"+id, admin, nil); w.Code != 204 {
		t.Fatal("group removal", w.Code, w.Body.String())
	}
	var effectiveCount int
	db.QueryRow("SELECT count(*) FROM monitoring_effective_assignments WHERE device_id=$1", id).Scan(&effectiveCount)
	if effectiveCount != 0 {
		t.Fatal("group unassignment retained compiled source", effectiveCount)
	}
	w = request("POST", "/api/v1/tags", admin, map[string]any{"name": "tag-inheritance"})
	if w.Code != 201 {
		t.Fatal("tag create", w.Code, w.Body.String())
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	tagID := result["id"].(string)
	if w = request("PUT", "/api/v1/devices/"+id+"/tags/"+tagID, admin, nil); w.Code != 204 {
		t.Fatal("tag membership", w.Code, w.Body.String())
	}
	if w = request("POST", "/api/v1/monitoring/bindings", admin, map[string]any{"template_id": inheritedTemplateID, "target_type": "tag", "target_id": tagID, "interval_seconds": 180}); w.Code != 201 {
		t.Fatal("tag binding", w.Code, w.Body.String())
	}
	if e = db.QueryRow(`SELECT (p.definition->>'interval_seconds')::integer FROM monitoring_effective_assignments m JOIN profiles p ON p.id=m.profile_id AND p.version=m.profile_version WHERE m.device_id=$1 AND m.source_id='device_overview'`, id).Scan(&effectiveInterval); e != nil || effectiveInterval != 180 {
		t.Fatal("tag inherited interval", effectiveInterval, e)
	}
	if w = request("DELETE", "/api/v1/devices/"+id+"/tags/"+tagID, admin, nil); w.Code != 204 {
		t.Fatal("tag removal", w.Code, w.Body.String())
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
	acksBeforeRevoke := acks
	must("UPDATE devices SET revoked=true WHERE id=$1", id)
	snap.Sequence = 3
	if e = core.Ingest(id, raw(snap), now); e == nil {
		t.Fatal("revoked telemetry accepted")
	}
	if acks != acksBeforeRevoke {
		t.Fatal("ack before successful commit", acks)
	}
	t.Log(fmt.Sprintf("schema %s: enrollment, identity, recovery replay, isolation, ingestion, late data, rollups and busy session passed", schema))
}
