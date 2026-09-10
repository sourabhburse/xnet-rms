package rms

import (
	"context"
	"crypto/x509"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Core struct {
	DB      *sql.DB
	Config  Config
	CA      *Authority
	Publish func(string, any) error
	sshKeys sync.Map
}
type Actor struct {
	ID    string `json:"id"`
	Org   string `json:"organization_id"`
	Email string `json:"email"`
	Role  string `json:"role"`
}
type actorKey struct{}

func actor(r *http.Request) Actor { return r.Context().Value(actorKey{}).(Actor) }
func output(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, msg string) {
	output(w, status, map[string]string{"error": msg})
}
func body(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 256*1024)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		fail(w, 400, "invalid JSON request")
		return false
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		fail(w, 400, "one JSON document required")
		return false
	}
	return true
}
func (s *Core) Handler() http.Handler {
	m := http.NewServeMux()
	limiter := newEntryLimiter()
	m.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		ctx, c := context.WithTimeout(r.Context(), time.Second)
		defer c()
		if s.DB.PingContext(ctx) != nil {
			fail(w, 503, "database unavailable")
			return
		}
		output(w, 200, map[string]string{"status": "UP", "service": "rms-core"})
	})
	m.HandleFunc("POST /api/v1/auth/login", s.login)
	m.HandleFunc("POST /api/v1/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "rms_auth", Value: "", Path: "/api/v1", HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
		w.WriteHeader(204)
	})
	m.HandleFunc("POST /api/v1/provision/bootstrap/challenge", s.bootstrapChallenge)
	m.HandleFunc("POST /api/v1/provision/bootstrap/check-in", s.bootstrapCheckin)
	m.HandleFunc("GET /api/v1/pending-devices", s.protect("ORG_ADMIN", s.pendingDevices))
	m.HandleFunc("POST /api/v1/pending-devices/{id}/claim", s.protect("ORG_ADMIN", s.claimPending))
	m.HandleFunc("GET /api/v1/registrations", s.protect("ORG_ADMIN", s.registrations))
	m.HandleFunc("POST /api/v1/registrations", s.protect("ORG_ADMIN", s.createRegistrations))
	m.HandleFunc("PATCH /api/v1/registrations/{id}", s.protect("ORG_ADMIN", s.editRegistration))
	m.HandleFunc("DELETE /api/v1/registrations/{id}", s.protect("ORG_ADMIN", s.editRegistration))
	m.HandleFunc("POST /api/v1/registrations/preview", s.protect("ORG_ADMIN", s.previewCSV))
	m.HandleFunc("GET /api/v1/tags", s.protect("VIEWER", s.tags))
	m.HandleFunc("POST /api/v1/tags", s.protect("ORG_ADMIN", s.createTag))
	m.HandleFunc("GET /api/v1/groups", s.protect("VIEWER", s.groups))
	m.HandleFunc("POST /api/v1/groups", s.protect("ORG_ADMIN", s.createGroup))
	m.HandleFunc("PATCH /api/v1/groups/{id}", s.protect("ORG_ADMIN", s.updateGroup))
	m.HandleFunc("DELETE /api/v1/groups/{id}", s.protect("ORG_ADMIN", s.deleteGroup))
	m.HandleFunc("GET /api/v1/groups/{id}/devices", s.protect("VIEWER", s.groupDevices))
	m.HandleFunc("PUT /api/v1/groups/{id}/devices/{device}", s.protect("ORG_ADMIN", s.groupDevice))
	m.HandleFunc("DELETE /api/v1/groups/{id}/devices/{device}", s.protect("ORG_ADMIN", s.groupDevice))
	m.HandleFunc("GET /api/v1/dashboard", s.protect("VIEWER", s.dashboard))
	m.HandleFunc("POST /api/v1/provision/check-in", s.enroll)
	m.HandleFunc("POST /api/v1/provision/challenge", s.challenge)
	m.HandleFunc("POST /api/v1/provision/recover", s.recoverCertificate)
	m.HandleFunc("POST /api/v1/provision/renew", s.renew)
	m.HandleFunc("GET /api/v1/agent/profiles", s.agentProfiles)
	m.HandleFunc("GET /api/v1/agent/bundles/{id}", s.agentBundle)
	m.HandleFunc("GET /internal/sessions/{id}", s.internalSession)
	m.HandleFunc("POST /internal/sessions/{id}/close", s.internalClose)
	m.HandleFunc("POST /internal/sessions/{id}/claim", s.internalClaim)
	m.HandleFunc("POST /internal/reconcile", s.internalReconcile)
	m.HandleFunc("GET /api/v1/auth/me", s.protect("VIEWER", func(w http.ResponseWriter, r *http.Request) { output(w, 200, actor(r)) }))
	m.HandleFunc("GET /api/v1/devices", s.protect("VIEWER", s.listDevices))
	m.HandleFunc("GET /api/v1/devices/{id}/snapshots", s.protect("VIEWER", s.snapshots))
	m.HandleFunc("GET /api/v1/devices/{id}/history", s.protect("VIEWER", s.history))
	m.HandleFunc("POST /api/v1/devices/{id}/revoke", s.protect("SUPER_ADMIN", s.revoke))
	m.HandleFunc("GET /api/v1/organizations", s.protect("SUPER_ADMIN", s.organizations))
	m.HandleFunc("POST /api/v1/organizations", s.protect("SUPER_ADMIN", s.createOrganization))
	m.HandleFunc("GET /api/v1/users", s.protect("ORG_ADMIN", s.users))
	m.HandleFunc("POST /api/v1/users", s.protect("ORG_ADMIN", s.createUser))
	m.HandleFunc("POST /api/v1/users/{id}/disable", s.protect("ORG_ADMIN", s.disableUser))
	m.HandleFunc("GET /api/v1/enrollment-tokens", s.protect("ORG_ADMIN", s.tokens))
	m.HandleFunc("POST /api/v1/enrollment-tokens", s.protect("ORG_ADMIN", s.createToken))
	m.HandleFunc("DELETE /api/v1/enrollment-tokens/{id}", s.protect("ORG_ADMIN", s.deleteToken))
	m.HandleFunc("GET /api/v1/profiles", s.protect("VIEWER", s.profiles))
	m.HandleFunc("POST /api/v1/profiles", s.protect("SUPER_ADMIN", s.createProfile))
	m.HandleFunc("POST /api/v1/devices/{id}/profiles", s.protect("SUPER_ADMIN", s.assignProfile))
	m.HandleFunc("POST /api/v1/bundles", s.protect("SUPER_ADMIN", s.createBundle))
	m.HandleFunc("GET /api/v1/bundles", s.protect("SUPER_ADMIN", s.bundles))
	m.HandleFunc("GET /api/v1/audit-logs", s.protect("ORG_ADMIN", s.auditLogs))
	m.HandleFunc("POST /api/v1/sessions", s.protect("OPERATOR", s.createSession))
	m.HandleFunc("GET /api/v1/sessions", s.protect("OPERATOR", s.sessions))
	m.HandleFunc("DELETE /api/v1/sessions/{id}", s.protect("OPERATOR", s.closeSession))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.Method != "GET" {
			origin := r.Header.Get("Origin")
			if origin != "" && !sameOrigin(s.Config.PublicURL, origin) {
				log.Printf("rms core origin rejected host=%q origin=%q expected=%q", r.Host, origin, s.Config.PublicURL)
				fail(w, 403, "origin rejected")
				return
			}
		}
		if (r.URL.Path == "/api/v1/auth/login" || strings.HasPrefix(r.URL.Path, "/api/v1/provision/")) && !limiter.allow(r.RemoteAddr, time.Now()) {
			fail(w, 429, "request limit reached; retry later")
			return
		}
		m.ServeHTTP(w, r)
	})
}
func roleAllows(have, want string) bool {
	rank := map[string]int{"VIEWER": 1, "OPERATOR": 2, "ORG_ADMIN": 3, "SUPER_ADMIN": 4}
	return rank[have] > 0 && rank[want] > 0 && rank[have] >= rank[want]
}
func (s *Core) protect(role string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if len(os.Getenv("JWT_SECRET")) < 32 {
			fail(w, 503, "authentication unavailable")
			return
		}
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if token == "" {
			if c, e := r.Cookie("rms_auth"); e == nil {
				token = c.Value
			}
		}
		claims := jwt.MapClaims{}
		_, e := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) { return []byte(os.Getenv("JWT_SECRET")), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("xnet-rms"), jwt.WithExpirationRequired())
		if e != nil {
			fail(w, 401, "login required")
			return
		}
		id, _ := claims.GetSubject()
		var a Actor
		e = s.DB.QueryRow("SELECT id,coalesce(organization_id,''),email,role FROM users WHERE id=$1 AND NOT disabled", id).Scan(&a.ID, &a.Org, &a.Email, &a.Role)
		if e != nil {
			fail(w, 401, "account unavailable")
			return
		}
		if !roleAllows(a.Role, role) {
			fail(w, 403, "insufficient permissions")
			return
		}
		h(w, r.WithContext(context.WithValue(r.Context(), actorKey{}, a)))
	}
}
func (s *Core) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !body(w, r, &req) {
		return
	}
	var a Actor
	var hash string
	e := s.DB.QueryRow("SELECT id,coalesce(organization_id,''),email,role,password_hash FROM users WHERE email=$1 AND NOT disabled", strings.ToLower(req.Email)).Scan(&a.ID, &a.Org, &a.Email, &a.Role, &hash)
	if e != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		fail(w, 401, "invalid credentials")
		return
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": a.ID, "iss": "xnet-rms", "exp": time.Now().Add(8 * time.Hour).Unix()})
	signed, e := t.SignedString([]byte(os.Getenv("JWT_SECRET")))
	if e != nil {
		fail(w, 500, "login unavailable")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "rms_auth", Value: signed, Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode, Path: "/api/v1", MaxAge: 28800})
	output(w, 200, map[string]any{"token": signed, "user": a})
}
func (s *Core) deviceIdentity(r *http.Request) (string, error) {
	if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 {
		return "", errors.New("client certificate required")
	}
	cert := r.TLS.PeerCertificates[0]
	id := cert.Subject.CommonName
	if !validID(id) {
		return "", errors.New("device identity required")
	}
	if _, err := os.Stat(filepath.Join(s.Config.RevokedDir, id)); err == nil || !os.IsNotExist(err) {
		return "", errors.New("device revoked or revocation store unavailable")
	}
	key, e := x509.MarshalPKIXPublicKey(cert.PublicKey)
	if e != nil {
		return "", e
	}
	var ok bool
	e = s.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM devices WHERE id=$1 AND public_key=$2 AND NOT revoked)", id, key).Scan(&ok)
	if e != nil || !ok {
		return "", errors.New("device disabled or unknown")
	}
	return id, nil
}
func (s *Core) scopedDevice(r *http.Request, id string) bool {
	a := actor(r)
	var ok bool
	s.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM devices WHERE id=$1 AND ($2='SUPER_ADMIN' OR organization_id=$3))", id, a.Role, a.Org).Scan(&ok)
	return ok
}
func (s *Core) rows(w http.ResponseWriter, q string, args ...any) {
	v, e := jsonRows(s.DB, q, args...)
	if e != nil {
		fail(w, 503, "query unavailable")
		return
	}
	output(w, 200, v)
}
func scopedOrganization(r *http.Request, a Actor) (string, bool) {
	if a.Role != "SUPER_ADMIN" {
		return a.Org, true
	}
	org := r.URL.Query().Get("organization_id")
	if org != "" && !validID(org) {
		return "", false
	}
	return org, true
}
func (s *Core) dashboard(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, a)
	if !ok {
		fail(w, 400, "invalid organization")
		return
	}
	var total, online, revoked int
	err := s.DB.QueryRow("SELECT count(*),count(*) FILTER(WHERE last_seen>now()-interval '180 seconds' AND NOT revoked),count(*) FILTER(WHERE revoked) FROM devices WHERE $1='' OR organization_id=$1", org).Scan(&total, &online, &revoked)
	if err != nil {
		fail(w, 503, "dashboard unavailable")
		return
	}
	output(w, 200, map[string]int{"total": total, "online": online, "offline": total - online - revoked, "revoked": revoked})
}
func (s *Core) listDevices(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, a)
	if !ok {
		fail(w, 400, "invalid organization")
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	if page > 10000 {
		fail(w, 400, "page too large")
		return
	}
	q := r.URL.Query().Get("q")
	source := r.URL.Query().Get("source")
	field := r.URL.Query().Get("field")
	value := r.URL.Query().Get("value")
	status := r.URL.Query().Get("status")
	if status != "" && status != "ONLINE" && status != "OFFLINE" && status != "REVOKED" {
		fail(w, 400, "invalid status")
		return
	}
	filter := ` ($1='' OR d.organization_id=$1) AND ($2='' OR d.serial_number ILIKE '%'||$2||'%' OR d.name ILIKE '%'||$2||'%' OR d.lan_mac ILIKE '%'||$2||'%' OR d.model ILIKE '%'||$2||'%') AND ($6='' OR EXISTS(SELECT 1 FROM device_tags dt JOIN tags tg ON tg.id=dt.tag_id WHERE dt.device_id=d.id AND tg.name=$6)) AND ($3='' OR EXISTS(SELECT 1 FROM current_snapshots f WHERE f.device_id=d.id AND f.source_id=$3 AND f.fields->$4->>'value'=$5)) AND ($7='' OR CASE WHEN d.revoked THEN 'REVOKED' WHEN d.last_seen>now()-interval '180 seconds' THEN 'ONLINE' ELSE 'OFFLINE' END=$7) `
	args := []any{org, q, source, field, value, r.URL.Query().Get("tag"), status}
	var total int
	if s.DB.QueryRow("SELECT count(*) FROM devices d WHERE "+filter, args...).Scan(&total) != nil {
		fail(w, 503, "query unavailable")
		return
	}
	rows, e := jsonRows(s.DB, `SELECT row_to_json(t) FROM (SELECT d.id,d.organization_id,d.name,d.lan_mac,coalesce((SELECT jsonb_agg(t.name ORDER BY t.name) FROM device_tags dt JOIN tags t ON t.id=dt.tag_id WHERE dt.device_id=d.id),'[]') AS tags,coalesce((SELECT jsonb_agg(g.name ORDER BY g.name) FROM device_group_members gm JOIN device_groups g ON g.id=gm.group_id WHERE gm.device_id=d.id),'[]') AS groups,d.serial_number,d.model,d.firmware_version,d.revoked,d.last_seen,CASE WHEN d.revoked THEN 'REVOKED' WHEN d.last_seen>now()-interval '180 seconds' THEN 'ONLINE' ELSE 'OFFLINE' END AS status,coalesce((SELECT jsonb_agg(jsonb_build_object('source_id',c.source_id,'fields',c.fields,'status',c.status,'received_at',c.received_at,'observed_at',c.observed_at,'stale',c.observed_at<now()-((p.definition->>'interval_seconds')::integer*2)*interval '1 second')) FROM current_snapshots c JOIN profiles p ON p.id=c.profile_id AND p.version=c.profile_version WHERE c.device_id=d.id),'[]') AS sources FROM devices d WHERE `+filter+` ORDER BY serial_number LIMIT 100 OFFSET $8) t`, append(args, (page-1)*100)...)
	if e != nil {
		fail(w, 503, "query unavailable")
		return
	}
	output(w, 200, map[string]any{"items": rows, "total": total})
}
func (s *Core) snapshots(w http.ResponseWriter, r *http.Request) {
	if !s.scopedDevice(r, r.PathValue("id")) {
		fail(w, 404, "device not found")
		return
	}
	s.rows(w, `SELECT row_to_json(t) FROM (SELECT c.*,p.definition FROM current_snapshots c JOIN profiles p ON p.id=c.profile_id AND p.version=c.profile_version WHERE device_id=$1) t`, r.PathValue("id"))
}
func (s *Core) history(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.scopedDevice(r, id) {
		fail(w, 404, "device not found")
		return
	}
	if r.URL.Query().Get("summary") == "1" {
		s.rows(w, `SELECT row_to_json(t) FROM (SELECT * FROM hourly_summaries WHERE device_id=$1 AND source_id=$2 ORDER BY hour DESC LIMIT 720) t`, id, r.URL.Query().Get("source"))
		return
	}
	s.rows(w, `SELECT row_to_json(t) FROM (SELECT observed_at,status,fields FROM snapshot_history WHERE device_id=$1 AND source_id=$2 ORDER BY observed_at DESC LIMIT 1000) t`, id, r.URL.Query().Get("source"))
}
func (s *Core) organizations(w http.ResponseWriter, r *http.Request) {
	s.rows(w, "SELECT row_to_json(o) FROM organizations o ORDER BY name")
}
func (s *Core) createOrganization(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if !body(w, r, &req) {
		return
	}
	if len(req.Name) < 1 || len(req.Name) > 128 {
		fail(w, 400, "name required")
		return
	}
	id := randomID()
	tx, e := s.DB.Begin()
	if e != nil {
		fail(w, 503, "database unavailable")
		return
	}
	defer tx.Rollback()
	_, e = tx.Exec("INSERT INTO organizations VALUES($1,$2)", id, req.Name)
	if e == nil {
		e = audit(tx, id, actor(r).ID, "organization.create", id)
	}
	if e != nil || tx.Commit() != nil {
		fail(w, 500, "create failed")
		return
	}
	output(w, 201, map[string]string{"id": id})
}
func (s *Core) users(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, a)
	if !ok { fail(w, 400, "invalid organization"); return }
	s.rows(w, "SELECT row_to_json(t) FROM (SELECT id,organization_id,email,role,disabled FROM users WHERE $1='' OR organization_id=$1) t", org)
}
func (s *Core) createUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
		Org      string `json:"organization_id"`
	}
	if !body(w, r, &req) {
		return
	}
	a := actor(r)
	if a.Role != "SUPER_ADMIN" {
		req.Org = a.Org
	}
	if !validID(req.Org) || !strings.Contains(req.Email, "@") || len(req.Password) < 12 || len(req.Password) > 72 || !(req.Role == "ORG_ADMIN" || req.Role == "OPERATOR" || req.Role == "VIEWER") {
		fail(w, 400, "valid organization, role, email and 12–72 byte password required")
		return
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if e != nil {
		fail(w, 400, "invalid password")
		return
	}
	id := randomID()
	tx, e := s.DB.Begin()
	if e != nil {
		fail(w, 503, "database unavailable")
		return
	}
	defer tx.Rollback()
	_, e = tx.Exec("INSERT INTO users VALUES($1,$2,$3,$4,$5,false)", id, req.Org, strings.ToLower(req.Email), string(hash), req.Role)
	if e == nil {
		e = audit(tx, req.Org, a.ID, "user.create", id)
	}
	if e != nil || tx.Commit() != nil {
		fail(w, 409, "user creation failed")
		return
	}
	output(w, 201, map[string]string{"id": id})
}
func (s *Core) disableUser(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	id := r.PathValue("id")
	if id == a.ID {
		fail(w, 400, "cannot disable yourself")
		return
	}
	tx, e := s.DB.Begin()
	if e != nil {
		fail(w, 503, "update unavailable")
		return
	}
	defer tx.Rollback()
	var org sql.NullString
	e = tx.QueryRow("UPDATE users SET disabled=true WHERE id=$1 AND role<>'SUPER_ADMIN' AND ($2='SUPER_ADMIN' OR organization_id=$3) RETURNING organization_id", id, a.Role, a.Org).Scan(&org)
	if e == sql.ErrNoRows {
		fail(w, 404, "user not found")
		return
	}
	if e != nil {
		fail(w, 503, "update unavailable")
		return
	}
	sessionIDs, e := closeSessions(tx, "user_id", id)
	if e == nil {
		e = audit(tx, org.String, a.ID, "user.disable", id)
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, 503, "update unavailable")
		return
	}
	for _, sessionID := range sessionIDs {
		s.sshKeys.Delete(sessionID)
	}
	output(w, 200, map[string]bool{"disabled": true})
}
func (s *Core) tokens(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, a)
	if !ok { fail(w, 400, "invalid organization"); return }
	s.rows(w, "SELECT row_to_json(t) FROM (SELECT e.id,e.organization_id,e.name,e.expires_at,e.max_uses,e.used_count,e.revoked,coalesce((SELECT jsonb_agg(g.id ORDER BY g.name) FROM enrollment_token_groups tg JOIN device_groups g ON g.id=tg.group_id WHERE tg.token_id=e.id),'[]') AS group_ids FROM enrollment_tokens e WHERE $1='' OR e.organization_id=$1) t", org)
}
func (s *Core) createToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name      string     `json:"name"`
		Token     string     `json:"token"`
		Org       string     `json:"organization_id"`
		MaxUses   *int       `json:"max_uses"`
		ExpiresAt *time.Time `json:"expires_at"`
		GroupIDs  []string   `json:"group_ids"`
	}
	if !body(w, r, &req) {
		return
	}
	a := actor(r)
	if a.Role != "SUPER_ADMIN" {
		req.Org = a.Org
		if req.Token != "" {
			fail(w, 403, "only platform administrators import tokens")
			return
		}
	}
	if req.Token == "" {
		req.Token = secret()
	}
	if !validID(req.Org) || len(req.Token) < 32 || len(req.Token) > 256 || len(req.Name) == 0 {
		fail(w, 400, "organization, name and at least 32-byte token required")
		return
	}
	id := randomID()
	tx, e := s.DB.Begin()
	if e != nil { fail(w, 503, "database unavailable"); return }
	defer tx.Rollback()
	_, e = tx.Exec("INSERT INTO enrollment_tokens(id,organization_id,name,token_hash,max_uses,expires_at) VALUES($1,$2,$3,$4,$5,$6)", id, req.Org, req.Name, digest(req.Token), req.MaxUses, req.ExpiresAt)
	for _, groupID := range req.GroupIDs {
		if e != nil { break }
		var groupOrg string
		e = tx.QueryRow("SELECT organization_id FROM device_groups WHERE id=$1", groupID).Scan(&groupOrg)
		if e == nil && groupOrg != req.Org { e = errors.New("group organization mismatch") }
		if e == nil { _, e = tx.Exec("INSERT INTO enrollment_token_groups(token_id,group_id) VALUES($1,$2)", id, groupID) }
	}
	if e == nil { e = audit(tx, req.Org, a.ID, "token.create", id) }
	if e != nil || tx.Commit() != nil {
		fail(w, 409, "token creation failed")
		return
	}
	output(w, 201, map[string]string{"id": id, "token": req.Token})
}
func (s *Core) deleteToken(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	tx, e := s.DB.Begin()
	if e != nil {
		fail(w, 503, "update failed")
		return
	}
	defer tx.Rollback()
	if enrollmentLock(tx) != nil {
		fail(w, 503, "update failed")
		return
	}
	var org string
	e = tx.QueryRow("UPDATE enrollment_tokens SET revoked=true WHERE id=$1 AND ($2='SUPER_ADMIN' OR organization_id=$3) RETURNING organization_id", r.PathValue("id"), a.Role, a.Org).Scan(&org)
	if e != nil {
		fail(w, 404, "token not found")
		return
	}
	_, e = tx.Exec("UPDATE pending_devices SET canceled=true WHERE token_id=$1 AND device_id IS NULL", r.PathValue("id"))
	if e == nil {
		e = audit(tx, org, a.ID, "token.revoke", r.PathValue("id"))
	}
	if e != nil || tx.Commit() != nil {
		fail(w, 503, "update failed")
		return
	}
	w.WriteHeader(204)
}
func (s *Core) auditLogs(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, a)
	if !ok { fail(w, 400, "invalid organization"); return }
	s.rows(w, "SELECT row_to_json(t) FROM (SELECT * FROM audit_logs WHERE $1='' OR organization_id=$1 ORDER BY id DESC LIMIT 500) t", org)
}
func (s *Core) revoke(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		fail(w, 400, "invalid device")
		return
	}
	if e := os.MkdirAll(s.Config.RevokedDir, 0755); e != nil {
		fail(w, 503, "revocation store unavailable")
		return
	}
	if e := os.WriteFile(filepath.Join(s.Config.RevokedDir, id), []byte("revoked\n"), 0644); e != nil {
		fail(w, 503, "revocation store unavailable")
		return
	}
	tx, e := s.DB.Begin()
	if e != nil {
		fail(w, 503, "database unavailable")
		return
	}
	defer tx.Rollback()
	var org string
	e = tx.QueryRow("UPDATE devices SET revoked=true WHERE id=$1 RETURNING organization_id", id).Scan(&org)
	if e == nil {
		var sessionIDs []string
		sessionIDs, e = closeSessions(tx, "device_id", id)
		if e == nil {
			if e = audit(tx, org, actor(r).ID, "device.revoke", id); e == nil {
				e = tx.Commit()
				if e == nil {
					for _, sessionID := range sessionIDs {
						s.sshKeys.Delete(sessionID)
					}
				}
			}
		}
	}
	if e != nil {
		fail(w, 503, "revocation failed closed; retry required")
		return
	}
	output(w, 200, map[string]bool{"revoked": true})
}
func BootstrapAdmin(d *sql.DB, email, password string) error {
	if len(password) < 12 || len(password) > 72 || !strings.Contains(email, "@") {
		return errors.New("admin email and password of 12–72 bytes required")
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if e != nil {
		return e
	}
	_, e = d.Exec("INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,'SUPER_ADMIN')", randomID(), strings.ToLower(email), string(hash))
	return e
}
