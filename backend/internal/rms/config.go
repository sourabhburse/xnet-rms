package rms

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	DatabaseURL, PKIDir, Listen, PublicURL, MQTTURL, MQTTPublicHost, CoreURL, TunnelDomain, TunnelPort, RevokedDir string
	RawDays, SummaryDays                                                                                           int
}

func FromEnv() (Config, error) {
	c := Config{DatabaseURL: os.Getenv("DATABASE_URL"), PKIDir: os.Getenv("RMS_PKI_DIR"), Listen: os.Getenv("RMS_LISTEN"), PublicURL: os.Getenv("RMS_PUBLIC_URL"), MQTTURL: os.Getenv("RMS_MQTT_URL"), MQTTPublicHost: os.Getenv("RMS_MQTT_HOST"), CoreURL: os.Getenv("RMS_CORE_URL"), TunnelDomain: os.Getenv("RMS_TUNNEL_DOMAIN"), TunnelPort: os.Getenv("RMS_TUNNEL_PORT"), RevokedDir: os.Getenv("RMS_REVOKED_DIR")}
	c.RawDays, _ = strconv.Atoi(os.Getenv("RMS_RAW_DAYS"))
	c.SummaryDays, _ = strconv.Atoi(os.Getenv("RMS_SUMMARY_DAYS"))
	if c.PKIDir == "" {
		c.PKIDir = "/etc/xnet-rms/pki"
	}
	if c.Listen == "" {
		c.Listen = ":8443"
	}
	if c.TunnelPort == "" {
		c.TunnelPort = "9443"
	}
	return c, nil
}
func (c Config) Validate() error {
	if c.DatabaseURL == "" || c.RevokedDir == "" || c.MQTTPublicHost == "" || c.TunnelDomain == "" {
		return errors.New("DATABASE_URL, RMS_REVOKED_DIR, RMS_MQTT_HOST and RMS_TUNNEL_DOMAIN are required")
	}
	for _, s := range []string{c.PublicURL, c.CoreURL} {
		u, e := url.Parse(s)
		if e != nil || u.Scheme != "https" || u.Host == "" {
			return errors.New("core and public URLs must use HTTPS")
		}
	}
	if c.RawDays < 1 || c.SummaryDays < c.RawDays {
		return errors.New("explicit approved RMS_RAW_DAYS and RMS_SUMMARY_DAYS >= raw retention required")
	}
	return nil
}
func randomID() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func secret() string         { return randomID() + randomID() }
func digest(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func validID(s string) bool {
	if len(s) != 32 {
		return false
	}
	_, e := hex.DecodeString(s)
	return e == nil && strings.ToLower(s) == s
}
func safeName(s string) bool {
	if len(s) < 1 || len(s) > 64 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || strings.ContainsRune("_-", c)) {
			return false
		}
	}
	return true
}

func (c Config) ValidateTunnel() error {
	if c.TunnelDomain == "" || strings.ContainsAny(c.TunnelDomain, "/:@ ") {
		return errors.New("RMS_TUNNEL_DOMAIN must be a DNS hostname")
	}
	u, e := url.Parse(c.CoreURL)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" {
		return errors.New("RMS_CORE_URL must be an HTTPS origin")
	}
	return nil
}

// sameOrigin compares browser Origin values as origins rather than raw
// strings. Browsers normalize scheme/host casing and treat an omitted HTTPS
// port as equivalent to :443; configuration files and forwarded requests may
// use either spelling. Paths, queries, fragments and credentials are never
// part of an allowed origin.
func sameOrigin(expected, actual string) bool {
	expectedURL, expectedErr := url.Parse(strings.TrimSpace(expected))
	actualURL, actualErr := url.Parse(strings.TrimSpace(actual))
	if expectedErr != nil || actualErr != nil || expectedURL == nil || actualURL == nil {
		return false
	}
	if !strings.EqualFold(expectedURL.Scheme, "https") || !strings.EqualFold(actualURL.Scheme, "https") {
		return false
	}
	if expectedURL.User != nil || actualURL.User != nil || expectedURL.RawQuery != "" || actualURL.RawQuery != "" || expectedURL.Fragment != "" || actualURL.Fragment != "" {
		return false
	}
	if (expectedURL.Path != "" && expectedURL.Path != "/") || (actualURL.Path != "" && actualURL.Path != "/") {
		return false
	}
	if !strings.EqualFold(expectedURL.Hostname(), actualURL.Hostname()) {
		return false
	}
	expectedPort, actualPort := expectedURL.Port(), actualURL.Port()
	if expectedPort == "" {
		expectedPort = "443"
	}
	if actualPort == "" {
		actualPort = "443"
	}
	return expectedPort == actualPort
}
