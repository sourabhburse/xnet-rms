package rms

import (
	"bytes"
	"crypto/x509"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

func (s *Core) enroll(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Serial      string            `json:"serial_number"`
		MAC         string            `json:"lan_mac,omitempty"`
		Identifiers map[string]string `json:"identifiers,omitempty"`
		Model       string            `json:"model"`
		Firmware    string            `json:"firmware_version"`
		Agent       string            `json:"agent_version,omitempty"`
		Token       string            `json:"enrollment_token"`
		CSR         string            `json:"csr"`
	}
	if !body(w, r, &req) {
		return
	}
	csr, err := parseCSR(req.CSR)
	req.Serial = strings.TrimSpace(req.Serial)
	if err != nil || req.Serial == "" || len(req.Serial) > 128 || len(req.Model) > 128 || len(req.Firmware) > 128 || len(req.Agent) > 64 {
		fail(w, 400, "valid identity and P-256 CSR required")
		return
	}
	tx, err := s.DB.Begin()
	if err != nil {
		fail(w, 503, "enrollment unavailable")
		return
	}
	defer tx.Rollback()
	if err = enrollmentLock(tx); err != nil {
		fail(w, 503, "enrollment unavailable")
		return
	}
	var tokenID, org string
	var max sql.NullInt64
	var used int
	err = tx.QueryRow("SELECT id,organization_id,max_uses,used_count FROM enrollment_tokens WHERE token_hash=$1 AND NOT revoked AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE", digest(req.Token)).Scan(&tokenID, &org, &max, &used)
	if err != nil {
		fail(w, 403, "enrollment rejected")
		return
	}
	if max.Valid && int64(used) >= max.Int64 {
		fail(w, 403, "token exhausted")
		return
	}
	identifiers := requestIdentifierMap(req.Identifiers, req.MAC)
	for kind, value := range identifiers {
		value = strings.TrimSpace(value)
		switch strings.ToLower(kind) {
		case "mac":
			value, err = normalizeMAC(value)
		case "imei":
			value, err = normalizeIMEI(value)
		}
		if err != nil || value == "" || len(value) > 256 {
			fail(w, 400, "invalid device identifier")
			return
		}
		identifiers[strings.ToLower(kind)] = value
	}
	productID, revision, err := resolveProduct(tx, req.Model)
	if err != nil {
		fail(w, 503, "product lookup unavailable")
		return
	}
	if productID != "" {
		if normalized, normalizeErr := normalizeIdentifiers(revision.IdentitySchema, identifiers); normalizeErr == nil {
			identifiers = normalized
		} else {
			// The legacy endpoint predates product identity metadata. Preserve
			// compatibility by accepting its serial-only requests as unrecognized.
			productID, revision = "", &productRevision{}
		}
	} else if identifiers, err = normalizeIdentifiers(nil, identifiers); err != nil {
		fail(w, 400, "invalid device identifier")
		return
	}
	claimIdentifiers := requestIdentifierMap(identifiers, "")
	claimIdentifiers["serial"] = req.Serial
	claims := productClaims(revision, claimIdentifiers)
	owner, err := identityOwnerFor(tx, "serial", req.Serial)
	if err != nil {
		fail(w, 503, "enrollment unavailable")
		return
	}
	if owner != nil {
		if err = identityClaimsConflict(tx, claims, owner); err != nil {
			fail(w, 409, "identity already registered")
			return
		}
	} else if err = identityClaimsConflict(tx, claims, nil); err != nil {
		fail(w, 409, "identity already registered")
		return
	}
	pub, _ := x509.MarshalPKIXPublicKey(csr.PublicKey)
	if owner != nil {
		if owner.Kind != "device" {
			fail(w, 409, "identity is reserved for pending enrollment")
			return
		}
		var id, oldOrg string
		var oldPub []byte
		var revoked bool
		if err = tx.QueryRow("SELECT id,organization_id,public_key,revoked FROM devices WHERE id=$1 FOR UPDATE", owner.ID).Scan(&id, &oldOrg, &oldPub, &revoked); err != nil {
			fail(w, 503, "enrollment unavailable")
			return
		}
		if revoked || oldOrg != org || !bytes.Equal(pub, oldPub) {
			fail(w, 409, "identity already registered; use certificate recovery")
			return
		}
		if lastIssued, issueErr := lastCertIssuedAt(tx, id); issueErr != nil {
			fail(w, 503, "enrollment unavailable")
			return
		} else if !lastIssued.IsZero() && time.Until(lastIssued.AddDate(1, 0, 0)) > 90*24*time.Hour {
			fail(w, 409, "not within renewal window; use certificate renewal closer to expiry")
			return
		}
		if _, err = tx.Exec("UPDATE devices SET model=$2,firmware_version=$3,agent_version=coalesce(nullif($4,''),agent_version),identifiers=identifiers||$5 WHERE id=$1", id, req.Model, req.Firmware, req.Agent, raw(identifiers)); err != nil {
			fail(w, 409, "enrollment conflict")
			return
		}
		if err = ensureIdentityClaims(tx, "device", id, claims); err != nil {
			fail(w, 409, "enrollment conflict")
			return
		}
		if err = assignDefaultTelemetry(tx, id); err != nil {
			fail(w, 503, "enrollment failed")
			return
		}
		cert, issueErr := s.CA.Issue(id, csr.PublicKey, time.Now())
		if issueErr == nil {
			issueErr = audit(tx, oldOrg, "", "device.enroll", id)
		}
		if issueErr != nil || tx.Commit() != nil {
			fail(w, 503, "enrollment failed")
			return
		}
		output(w, 200, map[string]any{"device_id": id, "certificate": cert, "mqtt_host": s.Config.MQTTPublicHost, "mqtt_port": 8883})
		return
	}
	if cutoff := os.Getenv("RMS_LEGACY_ENROLLMENT_UNTIL"); cutoff != "" {
		until, parseErr := time.Parse(time.RFC3339, cutoff)
		if parseErr != nil || !time.Now().Before(until) {
			onboardingError(w, 410, "agent_upgrade_required")
			return
		}
	}
	id := randomID()
	var productValue, revisionValue any
	if productID != "" {
		productValue, revisionValue = productID, revision.Version
	}
	_, err = tx.Exec("INSERT INTO devices(id,organization_id,serial_number,product_id,product_revision,identifiers,model,firmware_version,agent_version,public_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", id, org, req.Serial, productValue, revisionValue, raw(identifiers), req.Model, req.Firmware, req.Agent, pub)
	if err == nil {
		err = insertIdentityClaims(tx, "device", id, claims)
	}
	if err == nil {
		_, err = tx.Exec("UPDATE enrollment_tokens SET used_count=used_count+1 WHERE id=$1", tokenID)
	}
	if err == nil {
		err = assignDefaultTelemetry(tx, id)
	}
	cert := ""
	if err == nil {
		cert, err = s.CA.Issue(id, csr.PublicKey, time.Now())
	}
	if err == nil {
		err = audit(tx, org, "", "device.enroll", id)
	}
	if err != nil || tx.Commit() != nil {
		fail(w, 503, "enrollment failed")
		return
	}
	output(w, 200, map[string]any{"device_id": id, "certificate": cert, "mqtt_host": s.Config.MQTTPublicHost, "mqtt_port": 8883})
}
func (s *Core) challenge(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeviceID string `json:"device_id"`
	}
	if !body(w, r, &req) {
		return
	}
	if !validID(req.DeviceID) {
		fail(w, 400, "invalid device")
		return
	}
	id := randomID()
	message := "xnet-rms/recovery/v1:" + req.DeviceID + ":" + id + ":" + secret()
	res, e := s.DB.Exec("INSERT INTO recovery_challenges SELECT $1,id,$2,now()+interval '120 seconds' FROM devices WHERE id=$3 AND NOT revoked AND (SELECT count(*) FROM recovery_challenges WHERE device_id=$3 AND expires_at>now())<4", id, message, req.DeviceID)
	if e != nil {
		fail(w, 503, "recovery unavailable")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		fail(w, 429, "recovery unavailable or too many pending challenges")
		return
	}
	output(w, 200, map[string]string{"challenge_id": id, "message": message})
}
func (s *Core) recoverCertificate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeviceID    string `json:"device_id"`
		ChallengeID string `json:"challenge_id"`
		Signature   string `json:"signature"`
	}
	if !body(w, r, &req) {
		return
	}
	tx, e := s.DB.Begin()
	if e != nil {
		fail(w, 503, "recovery unavailable")
		return
	}
	defer tx.Rollback()
	var pub []byte
	var org, msg string
	e = tx.QueryRow("SELECT d.public_key,d.organization_id,c.message FROM devices d JOIN recovery_challenges c ON c.device_id=d.id WHERE d.id=$1 AND c.id=$2 AND c.expires_at>now() AND NOT d.revoked FOR UPDATE OF c,d", req.DeviceID, req.ChallengeID).Scan(&pub, &org, &msg)
	if e != nil || !verifyProof(pub, msg, req.Signature) {
		fail(w, 403, "recovery proof rejected")
		return
	}
	key, e := x509.ParsePKIXPublicKey(pub)
	var cert string
	if e == nil {
		cert, e = s.CA.Issue(req.DeviceID, key, time.Now())
	}
	if e == nil {
		_, e = tx.Exec("DELETE FROM recovery_challenges WHERE id=$1", req.ChallengeID)
	}
	if e == nil {
		e = audit(tx, org, "", "certificate.recover", req.DeviceID)
	}
	if e != nil || tx.Commit() != nil {
		fail(w, 503, "recovery failed")
		return
	}
	output(w, 200, map[string]string{"certificate": cert, "device_id": req.DeviceID})
}

// lastCertIssuedAt reconstructs the most recent time a certificate was
// issued for a device from the audit trail (enrollment, renewal, or
// recovery all record an entry there). A zero time means no matching record
// was found and callers should treat that permissively - older devices may
// predate one of these action types being audited.
func lastCertIssuedAt(tx *sql.Tx, deviceID string) (time.Time, error) {
	var t sql.NullTime
	e := tx.QueryRow("SELECT max(created_at) FROM audit_logs WHERE resource_id=$1 AND action IN ('device.enroll','certificate.recover','certificate.renew')", deviceID).Scan(&t)
	if e != nil {
		return time.Time{}, e
	}
	if !t.Valid {
		return time.Time{}, nil
	}
	return t.Time, nil
}

func (s *Core) renew(w http.ResponseWriter, r *http.Request) {
	id, e := s.deviceIdentity(r)
	if e != nil {
		fail(w, 403, "device authentication required")
		return
	}
	cert := r.TLS.PeerCertificates[0]
	if time.Until(cert.NotAfter) > 90*24*time.Hour {
		fail(w, 409, "not within renewal window")
		return
	}
	issued, e := s.CA.Issue(id, cert.PublicKey, time.Now())
	if e != nil {
		fail(w, 503, "renewal unavailable")
		return
	}
	// Best-effort: the certificate is already valid and issued regardless of
	// whether this audit write succeeds, so a failure here must not be
	// reported to the device as a renewal failure - it would only cause an
	// unnecessary duplicate reissue. It does, however, feed enroll()'s
	// rotation-window reconstruction, so record it when possible.
	var org string
	if tx, e2 := s.DB.Begin(); e2 == nil {
		if e2 = tx.QueryRow("SELECT organization_id FROM devices WHERE id=$1", id).Scan(&org); e2 == nil {
			e2 = audit(tx, org, "", "certificate.renew", id)
		}
		if e2 != nil || tx.Commit() != nil {
			tx.Rollback()
			log.Printf("certificate.renew audit failed for device %s: %v", id, e2)
		}
	}
	output(w, 200, map[string]string{"certificate": issued, "device_id": id})
}
func (s *Core) agentProfiles(w http.ResponseWriter, r *http.Request) {
	id, e := s.deviceIdentity(r)
	if e != nil {
		fail(w, 403, "device authentication required")
		return
	}
	rows, e := jsonRows(s.DB, "SELECT p.definition FROM profiles p JOIN assignments a ON a.profile_id=p.id AND a.version=p.version WHERE a.device_id=$1 AND a.active ORDER BY p.id", id)
	if e != nil {
		fail(w, 503, "profiles unavailable")
		return
	}
	output(w, 200, map[string]any{"profiles": rows})
}
func raw(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
