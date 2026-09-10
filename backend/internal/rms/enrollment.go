package rms

import (
	"bytes"
	"crypto/x509"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"time"
)

func (s *Core) enroll(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Serial   string `json:"serial_number"`
		Model    string `json:"model"`
		Firmware string `json:"firmware_version"`
		Token    string `json:"enrollment_token"`
		CSR      string `json:"csr"`
	}
	if !body(w, r, &req) {
		return
	}
	csr, e := parseCSR(req.CSR)
	if e != nil || len(req.Serial) == 0 || len(req.Serial) > 128 || len(req.Model) > 128 || len(req.Firmware) > 128 {
		fail(w, 400, "valid identity and P-256 CSR required")
		return
	}
	pub, _ := x509.MarshalPKIXPublicKey(csr.PublicKey)
	tx, e := s.DB.Begin()
	if e != nil {
		fail(w, 503, "enrollment unavailable")
		return
	}
	defer tx.Rollback()
	if enrollmentLock(tx) != nil {
		fail(w, 503, "enrollment unavailable")
		return
	}
	var tokenID, org string
	var max sql.NullInt64
	var used int
	e = tx.QueryRow("SELECT id,organization_id,max_uses,used_count FROM enrollment_tokens WHERE token_hash=$1 AND NOT revoked AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE", digest(req.Token)).Scan(&tokenID, &org, &max, &used)
	if e != nil {
		fail(w, 403, "enrollment rejected")
		return
	}
	var id, oldOrg string
	var oldPub []byte
	var revoked bool
	e = tx.QueryRow("SELECT id,organization_id,public_key,revoked FROM devices WHERE serial_number=$1 FOR UPDATE", req.Serial).Scan(&id, &oldOrg, &oldPub, &revoked)
	if e == sql.ErrNoRows {
		if cutoff := os.Getenv("RMS_LEGACY_ENROLLMENT_UNTIL"); cutoff != "" {
			until, parseErr := time.Parse(time.RFC3339, cutoff)
			if parseErr != nil || !time.Now().Before(until) {
				onboardingError(w, 410, "agent_upgrade_required")
				return
			}
		}
		var reserved bool
		if tx.QueryRow("SELECT EXISTS(SELECT 1 FROM pending_devices WHERE serial_number=$1) OR EXISTS(SELECT 1 FROM registrations WHERE serial_number=$1 AND NOT canceled)", req.Serial).Scan(&reserved) != nil || reserved {
			onboardingError(w, 409, "identity_conflict")
			return
		}

		if max.Valid && int64(used) >= max.Int64 {
			fail(w, 403, "token exhausted")
			return
		}
		id = randomID()
		_, e = tx.Exec("INSERT INTO devices(id,organization_id,serial_number,model,firmware_version,public_key) VALUES($1,$2,$3,$4,$5,$6)", id, org, req.Serial, req.Model, req.Firmware, pub)
		if e == nil {
			_, e = tx.Exec("UPDATE enrollment_tokens SET used_count=used_count+1 WHERE id=$1", tokenID)
		}
	} else if e == nil && (revoked || oldOrg != org || !bytes.Equal(pub, oldPub)) {
		fail(w, 409, "identity already registered; use certificate recovery")
		return
	}
	if e != nil {
		fail(w, 409, "enrollment conflict")
		return
	}
	if e = assignDefaultTelemetry(tx, id); e != nil {
		fail(w, 503, "enrollment failed")
		return
	}
	cert, e := s.CA.Issue(id, csr.PublicKey, time.Now())
	if e == nil {
		e = audit(tx, org, "", "device.enroll", id)
	}
	if e != nil || tx.Commit() != nil {
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
