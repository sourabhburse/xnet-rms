package rms

import (
	"bytes"
	"crypto/x509"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

func onboardingError(w http.ResponseWriter, status int, code string) {
	output(w, status, map[string]string{"code": code, "error": strings.ReplaceAll(code, "_", " ")})
}
func normalizeMAC(s string) (string, error) {
	m, e := net.ParseMAC(strings.TrimSpace(s))
	if e != nil || len(m) != 6 || m[0]&1 != 0 || bytes.Equal(m, make([]byte, 6)) {
		return "", errors.New("invalid LAN MAC")
	}
	return strings.ToUpper(m.String()), nil
}
func enrollmentLock(tx *sql.Tx) error {
	_, e := tx.Exec("SELECT pg_advisory_xact_lock(781332)")
	return e
}
func (s *Core) onboardingOrg(r *http.Request, requested string) (string, bool) {
	a := actor(r)
	if a.Role != "SUPER_ADMIN" {
		return a.Org, requested == "" || requested == a.Org
	}
	return requested, validID(requested)
}

type bootstrapRequest struct {
	Serial    string `json:"serial_number"`
	MAC       string `json:"lan_mac"`
	Model     string `json:"model"`
	Firmware  string `json:"firmware_version"`
	Agent     string `json:"agent_version"`
	Token     string `json:"enrollment_token"`
	CSR       string `json:"csr"`
	Challenge string `json:"challenge_id"`
	Signature string `json:"signature"`
}

func (s *Core) bootstrapChallenge(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CSR string `json:"csr"`
	}
	if !body(w, r, &req) {
		return
	}
	csr, e := parseCSR(req.CSR)
	if e != nil {
		onboardingError(w, 400, "invalid_identity")
		return
	}
	pub, _ := x509.MarshalPKIXPublicKey(csr.PublicKey)
	id := randomID()
	msg := "xnet-rms/bootstrap/v1:" + id + ":" + secret()
	tx, e := s.DB.Begin()
	if e != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	defer tx.Rollback()
	// Bound per-key outstanding challenges, including concurrent requests.
	if _, e = tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", digest(string(pub))); e != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	_, e = tx.Exec("DELETE FROM bootstrap_challenges WHERE expires_at<now()")
	var n int
	if e == nil {
		e = tx.QueryRow("SELECT count(*) FROM bootstrap_challenges WHERE public_key=$1", pub).Scan(&n)
	}
	if n >= 4 {
		onboardingError(w, 429, "retry_later")
		return
	}
	if e == nil {
		_, e = tx.Exec("INSERT INTO bootstrap_challenges VALUES($1,$2,$3,now()+interval '120 seconds')", id, pub, msg)
	}
	if e != nil || tx.Commit() != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	output(w, 200, map[string]string{"challenge_id": id, "message": msg})
}
func (s *Core) bootstrapCheckin(w http.ResponseWriter, r *http.Request) {
	var req bootstrapRequest
	if !body(w, r, &req) {
		return
	}
	mac, e := normalizeMAC(req.MAC)
	csr, ce := parseCSR(req.CSR)
	req.Serial = strings.TrimSpace(req.Serial)
	if e != nil || ce != nil || req.Serial == "" || len(req.Serial) > 63 || len(req.Model) > 128 || len(req.Firmware) > 128 || len(req.Agent) > 64 || len(req.Token) > 256 {
		onboardingError(w, 400, "invalid_identity")
		return
	}
	pub, _ := x509.MarshalPKIXPublicKey(csr.PublicKey)
	// Consume proof independently of enrollment outcome; even rejected requests cannot replay it.
	var msg string
	e = s.DB.QueryRow("DELETE FROM bootstrap_challenges WHERE id=$1 AND public_key=$2 AND expires_at>now() RETURNING message", req.Challenge, pub).Scan(&msg)
	if e != nil || !verifyProof(pub, msg, req.Signature) {
		onboardingError(w, 403, "invalid_proof")
		return
	}
	tx, e := s.DB.Begin()
	if e != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	defer tx.Rollback()
	if enrollmentLock(tx) != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	var device, org, serial, oldmac string
	var oldpub []byte
	var revoked bool
	e = tx.QueryRow("SELECT id,organization_id,serial_number,coalesce(lan_mac,''),public_key,revoked FROM devices WHERE serial_number=$1 OR lan_mac=$2", req.Serial, mac).Scan(&device, &org, &serial, &oldmac, &oldpub, &revoked)
	if e == nil {
		if serial != req.Serial || (oldmac != "" && oldmac != mac) || !bytes.Equal(pub, oldpub) {
			onboardingError(w, 409, "identity_conflict")
			return
		}
		if revoked {
			onboardingError(w, 403, "revoked")
			return
		}
		if _, e = tx.Exec("UPDATE devices SET lan_mac=$2,agent_version=$3,firmware_version=$4 WHERE id=$1", device, mac, req.Agent, req.Firmware); e != nil {
			onboardingError(w, 409, "identity_conflict")
			return
		}
		s.finishBootstrap(w, tx, device, org, csr)
		return
	}
	if e != sql.ErrNoRows {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	var pending, tokenID string
	var pendingOrg, pendingToken sql.NullString
	var canceled bool
	e = tx.QueryRow("SELECT id,serial_number,lan_mac,public_key,organization_id,token_id,canceled FROM pending_devices WHERE serial_number=$1 OR lan_mac=$2", req.Serial, mac).Scan(&pending, &serial, &oldmac, &oldpub, &pendingOrg, &pendingToken, &canceled)
	exists := e == nil
	if e != nil && e != sql.ErrNoRows {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	if exists && (serial != req.Serial || oldmac != mac || !bytes.Equal(oldpub, pub)) {
		onboardingError(w, 409, "identity_conflict")
		return
	}
	if canceled {
		onboardingError(w, 403, "invalid_token")
		return
	}
	if req.Token != "" {
		var used int
		var max sql.NullInt64
		e = tx.QueryRow("SELECT id,organization_id,used_count,max_uses FROM enrollment_tokens WHERE token_hash=$1 AND NOT revoked AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE", digest(req.Token)).Scan(&tokenID, &org, &used, &max)
		if e != nil {
			onboardingError(w, 403, "invalid_token")
			return
		}
		if exists && pendingToken.Valid && pendingToken.String != tokenID {
			onboardingError(w, 409, "identity_conflict")
			return
		}
		if !pendingToken.Valid {
			if max.Valid && int64(used) >= max.Int64 {
				onboardingError(w, 403, "token_exhausted")
				return
			}
			if _, e = tx.Exec("UPDATE enrollment_tokens SET used_count=used_count+1 WHERE id=$1", tokenID); e != nil {
				onboardingError(w, 503, "temporarily_unavailable")
				return
			}
		}
	} else if pendingToken.Valid {
		onboardingError(w, 403, "invalid_token")
		return
	}
	if !exists {
		pending = randomID()
		_, e = tx.Exec("INSERT INTO pending_devices(id,serial_number,lan_mac,model,firmware_version,agent_version,public_key,organization_id,token_id) VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),NULLIF($9,''))", pending, req.Serial, mac, req.Model, req.Firmware, req.Agent, pub, org, tokenID)
	} else {
		_, e = tx.Exec("UPDATE pending_devices SET last_seen=now(),model=$2,firmware_version=$3,agent_version=$4,organization_id=NULLIF($5,''),token_id=NULLIF($6,'') WHERE id=$1", pending, req.Model, req.Firmware, req.Agent, org, tokenID)
	}
	if e != nil {
		onboardingError(w, 409, "identity_conflict")
		return
	}
	if tokenID == "" {
		var registration, name string
		var tags []byte
		e = tx.QueryRow("SELECT id,organization_id,name,tags FROM registrations WHERE serial_number=$1 AND lan_mac=$2 AND NOT canceled AND device_id IS NULL", req.Serial, mac).Scan(&registration, &org, &name, &tags)
		if e == nil {
			device, e = activatePending(tx, pending, org, name, tags, "")
			if e == nil {
				_, e = tx.Exec("UPDATE registrations SET device_id=$2 WHERE id=$1", registration, device)
			}
			if e != nil {
				onboardingError(w, 409, "identity_conflict")
				return
			}
			s.finishBootstrap(w, tx, device, org, csr)
			return
		}
		if e != sql.ErrNoRows {
			onboardingError(w, 503, "temporarily_unavailable")
			return
		}
	}
	if tx.Commit() != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	state := "not_registered"
	if tokenID != "" {
		state = "awaiting_claim"
	}
	output(w, 200, map[string]string{"registration_state": state, "code": state})
}
func (s *Core) finishBootstrap(w http.ResponseWriter, tx *sql.Tx, id, org string, csr *x509.CertificateRequest) {
	if e := assignDefaultTelemetry(tx, id); e != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	cert, e := s.CA.Issue(id, csr.PublicKey, time.Now())
	var name string
	if e == nil {
		e = tx.QueryRow("SELECT name FROM organizations WHERE id=$1", org).Scan(&name)
	}
	if e != nil || tx.Commit() != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	output(w, 200, map[string]any{"registration_state": "claimed", "device_id": id, "certificate": cert, "organization_name": name, "mqtt_host": s.Config.MQTTPublicHost, "mqtt_port": 8883})
}
func activatePending(tx *sql.Tx, pending, org, name string, tags []byte, user string) (string, error) {
	id := randomID()
	res, e := tx.Exec("INSERT INTO devices(id,organization_id,serial_number,lan_mac,model,firmware_version,agent_version,public_key,name) SELECT $2,$3,serial_number,lan_mac,model,firmware_version,agent_version,public_key,$4 FROM pending_devices WHERE id=$1 AND NOT canceled AND device_id IS NULL AND (organization_id IS NULL OR organization_id=$3)", pending, id, org, name)
	if e != nil {
		return "", e
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return "", errors.New("conflict")
	}
	_, e = tx.Exec("UPDATE pending_devices SET device_id=$2 WHERE id=$1", pending, id)
	if e == nil {
		e = assignTags(tx, id, org, tags)
	}
	if e == nil {
		_, e = tx.Exec("INSERT INTO device_group_members(group_id,device_id) SELECT tg.group_id,$2 FROM enrollment_token_groups tg JOIN pending_devices p ON p.token_id=tg.token_id WHERE p.id=$1 ON CONFLICT DO NOTHING", pending, id)
	}
	if e == nil {
		e = assignDefaultTelemetry(tx, id)
	}
	if e == nil {
		e = audit(tx, org, user, "device.claim", id)
	}
	return id, e
}
func assignTags(tx *sql.Tx, device, org string, data []byte) error {
	var names []string
	if e := json.Unmarshal(data, &names); e != nil {
		return e
	}
	if _, e := tx.Exec("DELETE FROM device_tags WHERE device_id=$1", device); e != nil {
		return e
	}
	for _, name := range names {
		var id string
		e := tx.QueryRow("INSERT INTO tags VALUES($1,$2,$3) ON CONFLICT(organization_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id", randomID(), org, name).Scan(&id)
		if e != nil {
			return e
		}
		if _, e = tx.Exec("INSERT INTO device_tags VALUES($1,$2) ON CONFLICT DO NOTHING", device, id); e != nil {
			return e
		}
	}
	return nil
}

type registrationInput struct {
	Name   string   `json:"name"`
	Serial string   `json:"serial_number"`
	MAC    string   `json:"lan_mac"`
	Tags   []string `json:"tags"`
}

func normalizeRegistration(v *registrationInput) error {
	v.Name = strings.TrimSpace(v.Name)
	v.Serial = strings.TrimSpace(v.Serial)
	mac, e := normalizeMAC(v.MAC)
	v.MAC = mac
	if e != nil || v.Serial == "" || len(v.Serial) > 63 || len(v.Name) > 128 || len(v.Tags) > 32 {
		return errors.New("invalid_name_serial_or_mac")
	}
	tags := []string{}
	seen := map[string]bool{}
	for _, t := range v.Tags {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if len(t) > 64 {
			return errors.New("invalid_tag")
		}
		if !seen[t] {
			tags = append(tags, t)
			seen[t] = true
		}
	}
	v.Tags = tags
	return nil
}
func (s *Core) pendingDevices(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, a)
	if !ok { fail(w, 400, "invalid organization"); return }
	s.rows(w, `SELECT row_to_json(t) FROM (SELECT p.id,p.organization_id,p.serial_number,p.lan_mac,p.model,p.last_seen FROM pending_devices p JOIN enrollment_tokens e ON e.id=p.token_id WHERE NOT p.canceled AND p.device_id IS NULL AND NOT e.revoked AND (e.expires_at IS NULL OR e.expires_at>now()) AND ($1='' OR p.organization_id=$1) ORDER BY p.last_seen DESC LIMIT 500) t`, org)
}
func (s *Core) claimPending(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Name string   `json:"name"`
		Tags []string `json:"tags"`
	}
	if !body(w, r, &v) {
		return
	}
	check := registrationInput{Name: v.Name, Serial: "validation", MAC: "02:00:00:00:00:01", Tags: v.Tags}
	if normalizeRegistration(&check) != nil {
		onboardingError(w, 400, "invalid_fields")
		return
	}
	tx, e := s.DB.Begin()
	if e != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	defer tx.Rollback()
	if enrollmentLock(tx) != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	a := actor(r)
	var org string
	e = tx.QueryRow("SELECT p.organization_id FROM pending_devices p JOIN enrollment_tokens t ON t.id=p.token_id WHERE p.id=$1 AND NOT p.canceled AND p.device_id IS NULL AND NOT t.revoked AND (t.expires_at IS NULL OR t.expires_at>now()) AND ($2='SUPER_ADMIN' OR p.organization_id=$3) FOR UPDATE OF p,t", r.PathValue("id"), a.Role, a.Org).Scan(&org)
	if e != nil {
		onboardingError(w, 404, "pending_not_found")
		return
	}
	tags, _ := json.Marshal(check.Tags)
	id, e := activatePending(tx, r.PathValue("id"), org, check.Name, tags, a.ID)
	if e != nil || tx.Commit() != nil {
		onboardingError(w, 409, "identity_conflict")
		return
	}
	output(w, 200, map[string]string{"device_id": id})
}
func (s *Core) registrations(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, a)
	if !ok { fail(w, 400, "invalid organization"); return }
	s.rows(w, `SELECT row_to_json(t) FROM (SELECT *,CASE WHEN device_id IS NOT NULL THEN 'claimed' WHEN canceled THEN 'canceled' ELSE 'awaiting_device' END AS status FROM registrations WHERE $1='' OR organization_id=$1 ORDER BY created_at DESC LIMIT 500) t`, org)
}
func registrationConflict(tx *sql.Tx, org string, v registrationInput) error {
	var conflict bool
	e := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM devices WHERE serial_number=$1 OR lan_mac=$2) OR EXISTS(SELECT 1 FROM registrations WHERE NOT canceled AND (serial_number=$1 OR lan_mac=$2)) OR EXISTS(SELECT 1 FROM pending_devices WHERE (serial_number=$1 OR lan_mac=$2) AND (serial_number<>$1 OR lan_mac<>$2 OR canceled OR organization_id IS NOT NULL))`, v.Serial, v.MAC).Scan(&conflict)
	if e != nil {
		return e
	}
	if conflict {
		return errors.New("identity_conflict")
	}
	return nil
}
func (s *Core) registerOne(org, user string, v registrationInput) (string, error) {
	if e := normalizeRegistration(&v); e != nil {
		return "", e
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return "", e
	}
	defer tx.Rollback()
	if e = enrollmentLock(tx); e != nil {
		return "", e
	}
	if e = registrationConflict(tx, org, v); e != nil {
		return "", e
	}
	id := randomID()
	tags, _ := json.Marshal(v.Tags)
	_, e = tx.Exec("INSERT INTO registrations(id,organization_id,serial_number,lan_mac,name,tags) VALUES($1,$2,$3,$4,$5,$6)", id, org, v.Serial, v.MAC, v.Name, string(tags))
	if e != nil {
		return "", e
	}
	var pending string
	e = tx.QueryRow("SELECT id FROM pending_devices WHERE serial_number=$1 AND lan_mac=$2 AND organization_id IS NULL AND NOT canceled AND device_id IS NULL", v.Serial, v.MAC).Scan(&pending)
	if e == nil {
		var device string
		device, e = activatePending(tx, pending, org, v.Name, tags, user)
		if e == nil {
			_, e = tx.Exec("UPDATE registrations SET device_id=$2 WHERE id=$1", id, device)
		}
	} else if e == sql.ErrNoRows {
		e = nil
	}
	if e == nil {
		e = audit(tx, org, user, "registration.create", id)
	}
	if e != nil {
		return "", e
	}
	return id, tx.Commit()
}
func (s *Core) createRegistrations(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Org  string              `json:"organization_id"`
		Rows []registrationInput `json:"rows"`
	}
	if !body(w, r, &req) {
		return
	}
	org, ok := s.onboardingOrg(r, req.Org)
	if !ok {
		onboardingError(w, 403, "organization_required")
		return
	}
	if len(req.Rows) < 1 || len(req.Rows) > 500 {
		onboardingError(w, 400, "invalid_row_count")
		return
	}
	results := []map[string]any{}
	for i, v := range req.Rows {
		id, e := s.registerOne(org, actor(r).ID, v)
		row := map[string]any{"row": i + 1, "id": id, "success": e == nil}
		if e != nil {
			row["error"] = "invalid_or_conflicting_registration"
		}
		results = append(results, row)
	}
	output(w, 200, results)
}
func (s *Core) editRegistration(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string   `json:"name"`
		Tags []string `json:"tags"`
	}
	if r.Method != "DELETE" && !body(w, r, &req) {
		return
	}
	v := registrationInput{Name: req.Name, Tags: req.Tags, Serial: "validation", MAC: "02:00:00:00:00:01"}
	if normalizeRegistration(&v) != nil {
		onboardingError(w, 400, "invalid_fields")
		return
	}
	tx, e := s.DB.Begin()
	if e != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	defer tx.Rollback()
	if enrollmentLock(tx) != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	a := actor(r)
	var org string
	e = tx.QueryRow("SELECT organization_id FROM registrations WHERE id=$1 AND device_id IS NULL AND NOT canceled AND ($2='SUPER_ADMIN' OR organization_id=$3) FOR UPDATE", r.PathValue("id"), a.Role, a.Org).Scan(&org)
	if e != nil {
		onboardingError(w, 404, "registration_not_found")
		return
	}
	action := "registration.edit"
	if r.Method == "DELETE" {
		_, e = tx.Exec("UPDATE registrations SET canceled=true WHERE id=$1", r.PathValue("id"))
		action = "registration.cancel"
	} else {
		b, _ := json.Marshal(v.Tags)
		_, e = tx.Exec("UPDATE registrations SET name=$2,tags=$3 WHERE id=$1", r.PathValue("id"), v.Name, string(b))
	}
	if e == nil {
		e = audit(tx, org, a.ID, action, r.PathValue("id"))
	}
	if e != nil || tx.Commit() != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	w.WriteHeader(204)
}
func parseRegistrationCSV(reader io.Reader) ([]registrationInput, error) {
	c := csv.NewReader(reader)
	header, e := c.Read()
	if e != nil || strings.Join(header, ",") != "name,serial_number,lan_mac,tags" {
		return nil, errors.New("expected CSV header: name,serial_number,lan_mac,tags")
	}
	c.FieldsPerRecord = 4
	rows := []registrationInput{}
	for {
		record, e := c.Read()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, errors.New("malformed CSV")
		}
		if len(rows) >= 500 {
			return nil, errors.New("maximum 500 rows")
		}
		rows = append(rows, registrationInput{Name: record[0], Serial: record[1], MAC: record[2], Tags: strings.Split(record[3], ";")})
	}
	if len(rows) == 0 {
		return nil, errors.New("empty CSV")
	}
	return rows, nil
}
func (s *Core) previewCSV(w http.ResponseWriter, r *http.Request) {
	org, ok := s.onboardingOrg(r, r.URL.Query().Get("organization_id"))
	if !ok {
		onboardingError(w, 403, "organization_required")
		return
	}
	b, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if e != nil {
		onboardingError(w, 413, "csv_too_large")
		return
	}
	rows, e := parseRegistrationCSV(bytes.NewReader(b))
	if e != nil {
		output(w, 400, map[string]string{"error": e.Error(), "code": "invalid_csv"})
		return
	}
	out := []map[string]any{}
	seenSerial, seenMAC := map[string]bool{}, map[string]bool{}
	for i, v := range rows {
		err := normalizeRegistration(&v)
		if err == nil && (seenSerial[v.Serial] || seenMAC[v.MAC]) {
			err = errors.New("duplicate_row")
		}
		seenSerial[v.Serial] = true
		seenMAC[v.MAC] = true
		if err == nil {
			tx, te := s.DB.Begin()
			if te != nil {
				err = te
			} else {
				err = registrationConflict(tx, org, v)
				tx.Rollback()
			}
		}
		row := map[string]any{"row": i + 1, "data": v, "valid": err == nil}
		if err != nil {
			row["error"] = "invalid_or_conflicting_registration"
		}
		out = append(out, row)
	}
	output(w, 200, out)
}
func (s *Core) tags(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, a)
	if !ok { fail(w, 400, "invalid organization"); return }
	s.rows(w, "SELECT row_to_json(t) FROM (SELECT * FROM tags WHERE $1='' OR organization_id=$1 ORDER BY name) t", org)
}
func (s *Core) createTag(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Org  string `json:"organization_id"`
		Name string `json:"name"`
	}
	if !body(w, r, &req) {
		return
	}
	org, ok := s.onboardingOrg(r, req.Org)
	req.Name = strings.TrimSpace(req.Name)
	if !ok || req.Name == "" || len(req.Name) > 64 {
		onboardingError(w, 400, "invalid_tag")
		return
	}
	id := randomID()
	if e := s.mutateAudit(org, actor(r).ID, "tag.create", id, "INSERT INTO tags VALUES($1,$2,$3)", id, org, req.Name); e != nil {
		onboardingError(w, 409, "tag_conflict")
		return
	}
	output(w, 201, map[string]string{"id": id})
}
