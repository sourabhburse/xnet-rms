package rms

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"testing"
	"time"
)

func TestSnapshotValidation(t *testing.T) {
	now := time.Now().UTC()
	id := randomID()
	s := Snapshot{Schema: 1, DeviceID: id, ProfileID: randomID(), ProfileVersion: 1, SourceID: "ipsec", BootID: randomID(), Sequence: 1, ObservedAt: now, Status: "ok", Data: []byte(`{}`)}
	if _, e := DecodeSnapshot(raw(s), id, now); e != nil {
		t.Fatal(e)
	}
	for _, b := range [][]byte{append(raw(s), []byte(` {}`)...), []byte(`{`), make([]byte, MaxSnapshot+1)} {
		if _, e := DecodeSnapshot(b, id, now); e == nil {
			t.Fatal("accepted malformed snapshot")
		}
	}
	if _, e := DecodeSnapshot(raw(s), randomID(), now); e == nil {
		t.Fatal("accepted another identity")
	}
	s.ObservedAt = now.Add(6 * time.Minute)
	if _, e := DecodeSnapshot(raw(s), id, now); e == nil {
		t.Fatal("accepted future clock")
	}
}
func TestTypedEntities(t *testing.T) {
	p := Profile{Entities: "/tunnels", EntityKey: "/name", Fields: []Field{{ID: "state", Path: "/state", Kind: "state", Status: map[string]string{"UP": "healthy"}}, {ID: "bytes", Path: "/bytes", Kind: "counter"}}}
	values, e := Extract(p, []byte(`{"tunnels":[{"name":"vpn/a","state":"UP","bytes":42}]}`))
	if e != nil || len(values) != 2 {
		t.Fatal(values, e)
	}
	for _, v := range values {
		if v.Kind == "state" && v.State != "healthy" {
			t.Fatal(v)
		}
	}
	for _, s := range []string{`{"tunnels":[{"name":"a"},{"name":"a"}]}`, `{"tunnels":[{"state":"UP"}]}`, `{"tunnels":[{"name":"a","bytes":-1}]}`} {
		if _, e := Extract(p, []byte(s)); e == nil {
			t.Fatal("accepted invalid entity", s)
		}
	}
}
func TestFieldTypeAggregates(t *testing.T) {
	a := Accumulate(Aggregate{}, Selected{Kind: "gauge", Value: float64(2)}, nil)
	a = Accumulate(a, Selected{Kind: "gauge", Value: float64(4)}, nil)
	if a.Average == nil || *a.Average != 3 {
		t.Fatal(a)
	}
	prev := Selected{Kind: "counter", Value: float64(100)}
	a = Accumulate(Aggregate{}, Selected{Kind: "counter", Value: float64(5)}, &prev)
	if a.Resets != 1 || a.Delta != 5 || a.Average != nil {
		t.Fatal(a)
	}
	a = Accumulate(Aggregate{}, Selected{Kind: "state", Value: "UP"}, nil)
	if a.Average != nil || a.Last != "UP" {
		t.Fatal(a)
	}
}

func TestBuiltInDeviceOverviewProfile(t *testing.T) {
	p := Profile{
		ID:          DeviceOverviewProfileID,
		Version:     1,
		Name:        "Device overview telemetry",
		SourceID:    "device_overview",
		Type:        "builtin",
		CollectorID: "device_overview",
		Interval:    60,
		Timeout:     10,
		MaxOutput:   32768,
		Fields: []Field{
			{ID: "cpu_usage_percent", Path: "/cpu_usage_percent", Label: "CPU", Unit: "%", Kind: "gauge"},
			{ID: "registration", Path: "/registration", Label: "Registration", Kind: "state"},
		},
	}
	if e := p.Validate(); e != nil {
		t.Fatal(e)
	}
	p.CollectorID = "untrusted"
	if p.Validate() == nil {
		t.Fatal("accepted unsupported built-in collector")
	}
}

func TestMonitoringTemplateValidationAndThresholdPriority(t *testing.T) {
	warning, critical := float64(70), float64(90)
	def := monitoringTemplateDefinition{CatalogVersion: monitoringCatalogVersion, IntervalSeconds: 60, Metrics: []templateMetric{{MetricID: "system.cpu_usage", Threshold: &metricThreshold{Warning: &thresholdCondition{Operator: "gt", Value: &warning}, Critical: &thresholdCondition{Operator: "gt", Value: &critical}}}}, Stale: staleRule{Enabled: true, Severity: "warning", MissedIntervals: 2}}
	if err := validateTemplateDefinition(&def); err != nil {
		t.Fatal(err)
	}
	if severity := thresholdSeverity(def.Metrics[0].Threshold, Selected{Kind: "gauge", Value: float64(95)}); severity != "critical" {
		t.Fatalf("critical must win over warning, got %s", severity)
	}
	if severity := thresholdSeverity(def.Metrics[0].Threshold, Selected{Kind: "gauge", Value: float64(80)}); severity != "warning" {
		t.Fatalf("expected warning, got %s", severity)
	}
	def.Metrics[0].MetricID = "unknown.raw.ubus"
	if validateTemplateDefinition(&def) == nil {
		t.Fatal("accepted metric outside the server-owned catalog")
	}
}

func TestMonitoringStateThresholdNormalization(t *testing.T) {
	def := monitoringTemplateDefinition{CatalogVersion: monitoringCatalogVersion, IntervalSeconds: 300, Metrics: []templateMetric{{MetricID: "cellular.registration", Threshold: &metricThreshold{States: map[string]string{" Registered Home ": "healthy", "ROAMING": "warning", "not registered": "critical"}}}}}
	if err := validateTemplateDefinition(&def); err != nil {
		t.Fatal(err)
	}
	for value, expected := range map[string]string{"registered home": "healthy", "roaming": "warning", "not registered": "critical"} {
		if actual := thresholdSeverity(def.Metrics[0].Threshold, Selected{Kind: "state", Value: value}); actual != expected {
			t.Fatalf("%s: got %s want %s", value, actual, expected)
		}
	}
}

func TestIPsecBuiltInProfileAllowed(t *testing.T) {
	p, err := compiledProfile(randomID(), "ipsec", compiledSource{interval: 60, fields: map[string]Field{"state": metricByID["ipsec.state"].Field}})
	if err != nil || p.CollectorID != "ipsec" || p.Entities != "/tunnels" || p.EntityKey != "/id" {
		t.Fatal(p, err)
	}
}

func TestCompiledModbusHealthProfile(t *testing.T) {
	p, err := compiledProfile(randomID(), "modbus_health", compiledSource{interval: 300, fields: map[string]Field{"gateway_state": metricByID["industrial.modbus_gateway"].Field}})
	if err != nil || p.CollectorID != "modbus_health" || p.Type != "builtin" || p.MaxOutput != 4096 {
		t.Fatalf("unexpected Modbus profile: %#v %v", p, err)
	}
}

func TestBuiltInDeviceOverviewExtraction(t *testing.T) {
	p := Profile{Fields: []Field{
		{ID: "cpu_usage_percent", Path: "/cpu_usage_percent", Label: "CPU", Unit: "%", Kind: "gauge"},
		{ID: "rssi_dbm", Path: "/rssi_dbm", Label: "RSSI", Unit: "dBm", Kind: "gauge"},
		{ID: "temperature_c", Path: "/temperature_c", Label: "Temperature", Unit: "°C", Kind: "gauge"},
	}}
	values, e := Extract(p, []byte(`{"cpu_usage_percent":12.5,"rssi_dbm":-75,"temperature_c":null}`))
	if e != nil || len(values) != 2 {
		t.Fatal(values, e)
	}
	if values["cpu_usage_percent"].Value != float64(12.5) || values["rssi_dbm"].Value != float64(-75) {
		t.Fatal(values)
	}
}

func TestCertificatesAndProof(t *testing.T) {
	dir := t.TempDir()
	if e := InitPKI(dir, []string{"localhost"}); e != nil {
		t.Fatal(e)
	}
	if InitPKI(dir, []string{"localhost"}) == nil {
		t.Fatal("replaced CA")
	}
	ca, e := LoadAuthority(dir)
	if e != nil {
		t.Fatal(e)
	}
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	id := randomID()
	cert, e := ca.Issue(id, &key.PublicKey, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	block, _ := pem.Decode([]byte(cert))
	c, e := x509.ParseCertificate(block.Bytes)
	if e != nil || c.Subject.CommonName != id {
		t.Fatal(e)
	}
	roots := x509.NewCertPool()
	roots.AddCert(ca.Certificate)
	if _, e = c.Verify(x509.VerifyOptions{Roots: roots, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}); e != nil {
		t.Fatal(e)
	}
	pub, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	h := sha256.Sum256([]byte("fresh challenge"))
	sig, _ := ecdsa.SignASN1(rand.Reader, key, h[:])
	proof := base64.StdEncoding.EncodeToString(sig)
	if !verifyProof(pub, "fresh challenge", proof) || verifyProof(pub, "other challenge", proof) {
		t.Fatal("proof binding failed")
	}
}
