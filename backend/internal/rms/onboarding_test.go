package rms

import (
	"strings"
	"testing"
)

func TestNormalizeMAC(t *testing.T) {
	got, err := normalizeMAC("00:1e:42:16:b0:81")
	if err != nil || got != "00:1E:42:16:B0:81" {
		t.Fatalf("normalized MAC = %q, %v", got, err)
	}
	for _, value := range []string{"", "01:02:03:04:05:06", "00:00:00:00:00:00", "not-a-mac"} {
		if _, err := normalizeMAC(value); err == nil {
			t.Fatalf("expected invalid MAC %q", value)
		}
	}
}

func TestRegistrationCSV(t *testing.T) {
	rows, err := parseRegistrationCSV(strings.NewReader("name,serial_number,lan_mac,tags\nrouter,09544244,00:1E:42:16:B0:81,site-a; edge\n"))
	if err != nil || len(rows) != 1 || rows[0].Serial != "09544244" || len(rows[0].Tags) != 2 {
		t.Fatalf("CSV parse = %#v, %v", rows, err)
	}
	if _, err := parseRegistrationCSV(strings.NewReader("bad,header\n")); err == nil {
		t.Fatal("expected invalid CSV header")
	}
}

func TestNormalizeRegistration(t *testing.T) {
	v := registrationInput{Name: "  edge  ", Serial: " 09544244 ", MAC: "00:1e:42:16:b0:81", Tags: []string{" edge ", "edge", ""}}
	if err := normalizeRegistration(&v); err != nil {
		t.Fatal(err)
	}
	if v.Name != "edge" || v.Serial != "09544244" || len(v.Tags) != 1 || v.Tags[0] != "edge" {
		t.Fatalf("normalized registration = %#v", v)
	}
}

func TestProductDefinedRegistrationIdentity(t *testing.T) {
	schema := []IdentityRule{{Kind: "imei", Label: "IMEI", Required: true, Normalize: "imei", Unique: true}}
	v := registrationInput{Name: "cellular gateway", Serial: "GW-01", Identifiers: map[string]string{"imei": "490154203237518"}}
	if err := normalizeRegistration(&v, schema); err != nil {
		t.Fatal(err)
	}
	if v.Identifiers["imei"] != "490154203237518" || v.MAC != "" {
		t.Fatalf("normalized product identity = %#v", v)
	}
	if err := normalizeRegistration(&registrationInput{Name: "missing", Serial: "GW-02", Identifiers: map[string]string{}}, schema); err == nil {
		t.Fatal("accepted registration without required product identifier")
	}
}

func TestProductDefinedRegistrationCSV(t *testing.T) {
	schema := []IdentityRule{{Kind: "imei", Label: "IMEI", Required: true, Normalize: "imei", Unique: true}}
	rows, err := parseRegistrationCSV(strings.NewReader("name,serial_number,imei,tags\ngateway,GW-01,490154203237518,site-a\n"), schema)
	if err != nil || len(rows) != 1 || rows[0].Identifiers["imei"] != "490154203237518" {
		t.Fatalf("product CSV parse = %#v, %v", rows, err)
	}
}

func TestProductIdentityHelpers(t *testing.T) {
	if !modelPatternMatches("XNET cellular gateway", "%cellular%") || modelPatternMatches("2S", "%cellular%") {
		t.Fatal("model pattern matching failed")
	}
	revision := &productRevision{IdentitySchema: []IdentityRule{{Kind: "imei", Unique: true}}}
	claims := productClaims(revision, map[string]string{"serial": "GW-01", "imei": "490154203237518", "vendor": "ignored"})
	if len(claims) != 2 || claims["serial"] != "GW-01" || claims["imei"] != "490154203237518" {
		t.Fatalf("product claims = %#v", claims)
	}
}
