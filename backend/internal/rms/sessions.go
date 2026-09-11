package rms

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"database/sql"
	"encoding/pem"
	"fmt"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

type Session struct {
	ID            string     `json:"id"`
	DeviceID      string     `json:"device_id"`
	DeviceName    string     `json:"device_name,omitempty"`
	DeviceSerial  string     `json:"device_serial,omitempty"`
	DeviceModel   string     `json:"device_model,omitempty"`
	DeviceFirmware string    `json:"device_firmware,omitempty"`
	UserID        string     `json:"user_id"`
	Protocol      string     `json:"protocol"`
	ExpiresAt     time.Time  `json:"expires_at"`
	BrowserHash   string     `json:"browser_hash,omitempty"`
	SSHPrivateKey string     `json:"ssh_private_key,omitempty"`
	SSHSigner     ssh.Signer `json:"-"`
}

const (
	initialSessionTTL  = 15 * time.Minute
	sessionExtension   = 15 * time.Minute
	maxSessionLifetime = 60 * time.Minute
)

func (s *Core) createSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeviceID string `json:"device_id"`
		Protocol string `json:"protocol"`
	}
	if !body(w, r, &req) {
		return
	}
	if req.Protocol != "HTTP_LUCI" && req.Protocol != "SSH_LUCI" && req.Protocol != "TERMINAL_SSH" {
		fail(w, 400, "protocol outside release 1")
		return
	}
	if !s.scopedDevice(r, req.DeviceID) {
		fail(w, 404, "device not found")
		return
	}
	a := actor(r)
	id, ticket := randomID(), secret()
	expires := time.Now().Add(initialSessionTTL)
	needsSSH := req.Protocol == "TERMINAL_SSH" || req.Protocol == "SSH_LUCI"
	var pubSSH string
	var privPEM []byte
	expiredSessionIDs := []string{}
	if needsSSH {
		var err error
		privPEM, pubSSH, _, err = generateSSHKeypair(id)
		if err != nil {
			fail(w, 500, "failed to generate session key")
			return
		}
		// Keep the key available before the session is committed. If any
		// database step fails, the deferred cleanup below removes it again.
		s.sshKeys.Store(id, string(privPEM))
	}
	committed := false
	defer func() {
		if needsSSH && !committed {
			s.sshKeys.Delete(id)
		}
		if committed {
			for _, expiredID := range expiredSessionIDs {
				s.sshKeys.Delete(expiredID)
			}
		}
	}()
	tx, e := s.DB.Begin()
	if e != nil {
		fail(w, 503, "sessions unavailable")
		return
	}
	defer tx.Rollback()
	_, e = tx.Exec("SELECT pg_advisory_xact_lock(781332)")
	if e != nil {
		fail(w, 503, "sessions unavailable")
		return
	}
	expiredSessionIDs, e = expireSessions(tx)
	if e != nil {
		fail(w, 503, "sessions unavailable")
		return
	}
	var active int
	e = tx.QueryRow("SELECT count(*) FROM sessions WHERE closed_at IS NULL").Scan(&active)
	if e != nil || active >= 25 {
		fail(w, 429, "session capacity reached")
		return
	}
	var org string
	var online bool
	e = tx.QueryRow("SELECT organization_id,last_seen>now()-interval '180 seconds' AND NOT revoked FROM devices WHERE id=$1 FOR SHARE", req.DeviceID).Scan(&org, &online)
	if e != nil || !online {
		fail(w, 409, "device unavailable")
		return
	}
	_, e = tx.Exec("INSERT INTO sessions(id,device_id,user_id,protocol,ticket_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)", id, req.DeviceID, a.ID, req.Protocol, digest(ticket), expires)
	if e != nil {
		fail(w, 409, "router busy")
		return
	}
	if e = audit(tx, org, a.ID, "session.open", id); e != nil {
		fail(w, 503, "session creation failed")
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, 503, "session creation failed")
		return
	}
	committed = true
	gateway := "https://" + s.Config.TunnelDomain + ":" + s.Config.TunnelPort
	command := map[string]any{"action": "open_session", "session_id": id, "protocol": req.Protocol, "expires_at": expires.Unix(), "gateway_url": gateway}
	if pubSSH != "" {
		command["public_key"] = pubSSH
	}
	if s.Publish == nil || s.Publish("rms/v1/devices/"+req.DeviceID+"/commands", command) != nil {
		s.finishSession(id)
		fail(w, 503, "router command dispatch failed")
		return
	}
	resp := map[string]any{
		"id":         id,
		"expires_at": expires,
		"launch_url": "https://" + id + "." + s.Config.TunnelDomain + ":" + s.Config.TunnelPort + "/launch?ticket=" + ticket,
	}
	if len(privPEM) > 0 && req.Protocol == "TERMINAL_SSH" {
		resp["private_key"] = string(privPEM)
	}
	output(w, 201, resp)
}
func (s *Core) sessions(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, a)
	if !ok { fail(w, 400, "invalid organization"); return }
	s.rows(w, `SELECT row_to_json(t) FROM (SELECT s.id,s.device_id,s.user_id,s.protocol,s.expires_at,s.closed_at FROM sessions s JOIN devices d ON d.id=s.device_id WHERE ($1='' OR d.organization_id=$1) AND s.closed_at IS NULL ORDER BY s.created_at DESC) t`, org)
}

// extendSession adds one bounded extension to an active remote session. The
// total lifetime is capped so an abandoned browser or router tunnel cannot be
// kept alive indefinitely. The router receives the same absolute expiry so its
// local tunnel watchdog stays in sync with the database and gateway.
func (s *Core) extendSession(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	id := r.PathValue("id")

	var device, owner, org string
	var oldExpiry, createdAt time.Time
	e := s.DB.QueryRow(`SELECT s.device_id,s.user_id,s.expires_at,s.created_at,d.organization_id
		FROM sessions s JOIN devices d ON d.id=s.device_id
		WHERE s.id=$1 AND s.closed_at IS NULL`, id).Scan(&device, &owner, &oldExpiry, &createdAt, &org)
	if e != nil || !s.scopedDevice(r, device) {
		fail(w, 404, "session not found")
		return
	}
	if a.Role == "OPERATOR" && a.ID != owner {
		fail(w, 403, "only owner or administrator may extend session")
		return
	}

	now := time.Now()
	if !oldExpiry.After(now) {
		fail(w, 409, "session expired")
		return
	}
	newExpiry := oldExpiry.Add(sessionExtension)
	maxExpiry := createdAt.Add(maxSessionLifetime)
	if newExpiry.After(maxExpiry) {
		newExpiry = maxExpiry
	}
	if !newExpiry.After(oldExpiry) {
		fail(w, 409, "session maximum duration reached")
		return
	}

	tx, e := s.DB.Begin()
	if e != nil {
		fail(w, 503, "sessions unavailable")
		return
	}
	defer tx.Rollback()
	var currentExpiry time.Time
	e = tx.QueryRow(`SELECT expires_at FROM sessions WHERE id=$1 AND closed_at IS NULL FOR UPDATE`, id).Scan(&currentExpiry)
	if e != nil || !currentExpiry.After(now) {
		fail(w, 409, "session expired")
		return
	}
	// Recalculate from the row locked above so concurrent extension requests
	// cannot overwrite one another or exceed the lifetime cap.
	newExpiry = currentExpiry.Add(sessionExtension)
	if newExpiry.After(maxExpiry) {
		newExpiry = maxExpiry
	}
	if !newExpiry.After(currentExpiry) {
		fail(w, 409, "session maximum duration reached")
		return
	}
	if _, e = tx.Exec("UPDATE sessions SET expires_at=$1 WHERE id=$2", newExpiry, id); e != nil {
		fail(w, 503, "session extension failed")
		return
	}
	if e = audit(tx, org, a.ID, "session.extend", id); e != nil {
		fail(w, 503, "session extension failed")
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, 503, "session extension failed")
		return
	}

	command := map[string]any{"action": "extend_session", "session_id": id, "expires_at": newExpiry.Unix()}
	if s.Publish == nil || s.Publish("rms/v1/devices/"+device+"/commands", command) != nil {
		// Keep the database and router watchdog aligned when the broker cannot
		// accept the extension. A concurrent extension is left untouched.
		_, _ = s.DB.Exec("UPDATE sessions SET expires_at=$1 WHERE id=$2 AND closed_at IS NULL AND expires_at=$3", currentExpiry, id, newExpiry)
		fail(w, 503, "session extension dispatch failed")
		return
	}
	output(w, 200, map[string]any{
		"id":             id,
		"expires_at":     newExpiry,
		"max_expires_at": maxExpiry,
	})
}
func (s *Core) closeSession(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	id := r.PathValue("id")
	var device, user string
	e := s.DB.QueryRow("SELECT device_id,user_id FROM sessions WHERE id=$1", id).Scan(&device, &user)
	if e != nil || !s.scopedDevice(r, device) {
		fail(w, 404, "session not found")
		return
	}
	if a.Role == "OPERATOR" && a.ID != user {
		fail(w, 403, "only owner or administrator may close session")
		return
	}
	if e = s.finishSessionAs(id, a.ID); e != nil {
		fail(w, 503, "close failed")
		return
	}
	w.WriteHeader(204)
}
func (s *Core) finishSession(id string) error { return s.finishSessionAs(id, "") }
func (s *Core) finishSessionAs(id, closer string) error {
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.Exec("SELECT set_config('rms.actor',$1,true)", closer); e != nil {
		return e
	}
	var user, device, org string
	e = tx.QueryRow("UPDATE sessions SET closed_at=now() WHERE id=$1 AND closed_at IS NULL RETURNING user_id,device_id", id).Scan(&user, &device)
	if e == sql.ErrNoRows {
		s.sshKeys.Delete(id)
		return nil
	}
	if e != nil {
		return e
	}
	if e = tx.QueryRow("SELECT organization_id FROM devices WHERE id=$1", device).Scan(&org); e != nil {
		return e
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	s.sshKeys.Delete(id)

	// Closing the browser already tears down the gateway websocket, but the
	// router-side worker may still be alive until it observes that close. Send
	// an explicit command as well so a subsequent session is not rejected as
	// busy. A failed best-effort publish must not turn a completed DB close
	// into an API error; the websocket cleanup remains the fallback.
	if s.Publish != nil {
		_ = s.Publish("rms/v1/devices/"+device+"/commands", map[string]any{
			"action":     "close_session",
			"session_id": id,
		})
	}
	return nil
}

func closeSessions(tx *sql.Tx, column, value string) ([]string, error) {
	var query string
	switch column {
	case "user_id", "device_id":
		query = "SELECT id FROM sessions WHERE " + column + "=$1 AND closed_at IS NULL FOR UPDATE"
	default:
		return nil, fmt.Errorf("unsupported session filter %q", column)
	}
	rows, e := tx.Query(query, value)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			return nil, e
		}
		ids = append(ids, id)
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	if e = rows.Close(); e != nil {
		return nil, e
	}
	if _, e = tx.Exec("UPDATE sessions SET closed_at=now() WHERE "+column+"=$1 AND closed_at IS NULL", value); e != nil {
		return nil, e
	}
	return ids, nil
}

func expireSessions(tx *sql.Tx) ([]string, error) {
	rows, e := tx.Query("UPDATE sessions SET closed_at=now() WHERE closed_at IS NULL AND expires_at<=now() RETURNING id")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			return nil, e
		}
		ids = append(ids, id)
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	if e = rows.Close(); e != nil {
		return nil, e
	}
	return ids, nil
}

func (s *Core) expireSessions() error {
	rows, e := s.DB.Query("UPDATE sessions SET closed_at=now() WHERE closed_at IS NULL AND expires_at<=now() RETURNING id")
	if e != nil {
		return e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return e
		}
		ids = append(ids, id)
	}
	if e = rows.Err(); e != nil {
		rows.Close()
		return e
	}
	if e = rows.Close(); e != nil {
		return e
	}
	for _, id := range ids {
		s.sshKeys.Delete(id)
	}
	return nil
}
func internalOK(r *http.Request) bool {
	return r.TLS != nil && len(r.TLS.VerifiedChains) > 0 && r.TLS.PeerCertificates[0].Subject.CommonName == "rms-tunnel"
}
func (s *Core) internalSession(w http.ResponseWriter, r *http.Request) {
	if !internalOK(r) {
		fail(w, 403, "service certificate required")
		return
	}
	var x Session
	e := s.DB.QueryRow(`SELECT s.id,s.device_id,d.name,d.serial_number,d.model,d.firmware_version,s.user_id,s.protocol,s.expires_at,s.browser_hash FROM sessions s JOIN devices d ON d.id=s.device_id JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.closed_at IS NULL AND s.expires_at>now() AND NOT d.revoked AND NOT u.disabled AND u.role IN ('SUPER_ADMIN','ORG_ADMIN','OPERATOR') AND (u.role='SUPER_ADMIN' OR u.organization_id=d.organization_id)`, r.PathValue("id")).Scan(&x.ID, &x.DeviceID, &x.DeviceName, &x.DeviceSerial, &x.DeviceModel, &x.DeviceFirmware, &x.UserID, &x.Protocol, &x.ExpiresAt, &x.BrowserHash)
	if e != nil {
		fail(w, 403, "session inactive")
		return
	}
	if val, ok := s.sshKeys.Load(x.ID); ok {
		x.SSHPrivateKey = val.(string)
	}
	output(w, 200, x)
}
func (s *Core) internalClaim(w http.ResponseWriter, r *http.Request) {
	if !internalOK(r) {
		fail(w, 403, "service certificate required")
		return
	}
	var req struct {
		Ticket string `json:"ticket"`
		Cookie string `json:"cookie"`
	}
	if !body(w, r, &req) {
		return
	}
	res, e := s.DB.Exec("UPDATE sessions SET ticket_hash='',browser_hash=$1 WHERE id=$2 AND ticket_hash=$3 AND ticket_hash<>'' AND closed_at IS NULL AND expires_at>now()", digest(req.Cookie), r.PathValue("id"), digest(req.Ticket))
	if e != nil {
		fail(w, 503, "claim unavailable")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		fail(w, 403, "ticket invalid or used")
		return
	}
	w.WriteHeader(204)
}

func (s *Core) internalExtend(w http.ResponseWriter, r *http.Request) {
	if !internalOK(r) {
		fail(w, 403, "service certificate required")
		return
	}
	var a Actor
	e := s.DB.QueryRow(`SELECT u.id,coalesce(u.organization_id,''),u.email,u.role
		FROM sessions s JOIN users u ON u.id=s.user_id JOIN devices d ON d.id=s.device_id
		WHERE s.id=$1 AND s.closed_at IS NULL AND s.expires_at>now() AND NOT d.revoked AND NOT u.disabled`, r.PathValue("id")).Scan(&a.ID, &a.Org, &a.Email, &a.Role)
	if e != nil {
		fail(w, 403, "session inactive")
		return
	}
	s.extendSession(w, r.WithContext(context.WithValue(r.Context(), actorKey{}, a)))
}

func (s *Core) internalClose(w http.ResponseWriter, r *http.Request) {
	if !internalOK(r) {
		fail(w, 403, "service certificate required")
		return
	}
	if e := s.finishSession(r.PathValue("id")); e != nil {
		fail(w, 503, "close unavailable")
		return
	}
	w.WriteHeader(204)
}
func (s *Core) internalReconcile(w http.ResponseWriter, r *http.Request) {
	if !internalOK(r) {
		fail(w, 403, "service certificate required")
		return
	}
	rows, e := s.DB.Query("SELECT id FROM sessions WHERE closed_at IS NULL")
	if e != nil {
		fail(w, 503, "reconcile unavailable")
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		if e = s.finishSession(id); e != nil {
			fail(w, 503, "reconcile failed")
			return
		}
	}
	w.WriteHeader(204)
}

func generateSSHKeypair(sessionID string) ([]byte, string, ssh.Signer, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, "", nil, err
	}
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		return nil, "", nil, err
	}
	sshPub, err := ssh.NewPublicKey(&key.PublicKey)
	if err != nil {
		return nil, "", nil, err
	}
	pubSSH := fmt.Sprintf("%s rms-session-%s", strings.TrimSpace(string(ssh.MarshalAuthorizedKey(sshPub))), sessionID)

	privPEM, err := ssh.MarshalPrivateKey(key, "")
	if err != nil {
		return nil, "", nil, err
	}
	privBlock := pem.EncodeToMemory(privPEM)

	return privBlock, pubSSH, signer, nil
}
