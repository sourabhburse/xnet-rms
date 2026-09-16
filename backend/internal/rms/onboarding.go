package rms

import (
	"bytes"
	"crypto/x509"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
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
	Serial      string            `json:"serial_number"`
	MAC         string            `json:"lan_mac"`
	Identifiers map[string]string `json:"identifiers,omitempty"`
	Model       string            `json:"model"`
	Firmware    string            `json:"firmware_version"`
	Agent       string            `json:"agent_version"`
	Token       string            `json:"enrollment_token"`
	CSR         string            `json:"csr"`
	Challenge   string            `json:"challenge_id"`
	Signature   string            `json:"signature"`
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

func canonicalIdentifiers(input map[string]string) (map[string]string, error) {
	out := requestIdentifierMap(input, "")
	for kind, value := range out {
		kind, value = strings.ToLower(strings.TrimSpace(kind)), strings.TrimSpace(value)
		var e error
		switch kind {
		case "mac":
			value, e = normalizeMAC(value)
		case "imei":
			value, e = normalizeIMEI(value)
		}
		if e != nil || value == "" || len(value) > 256 {
			return nil, errors.New("invalid device identifier")
		}
		out[kind] = value
	}
	return out, nil
}
func bootstrapProduct(tx *sql.Tx, model string, input map[string]string) (string, *productRevision, map[string]string, error) {
	identifiers, e := canonicalIdentifiers(input)
	if e != nil {
		return "", nil, nil, e
	}
	productID, revision, e := resolveProduct(tx, model)
	if e != nil {
		return "", nil, nil, e
	}
	if productID != "" {
		identifiers, e = normalizeIdentifiers(revision.IdentitySchema, identifiers)
	} else {
		identifiers, e = normalizeIdentifiers(nil, identifiers)
		revision = &productRevision{}
	}
	if e != nil {
		return "", nil, nil, e
	}
	return productID, revision, identifiers, nil
}

func (s *Core) bootstrapCheckin(w http.ResponseWriter, r *http.Request) {
	var req bootstrapRequest
	if !body(w, r, &req) {
		return
	}
	req.Serial = strings.TrimSpace(req.Serial)
	if req.Serial == "" || len(req.Serial) > 128 || len(req.Model) > 128 || len(req.Firmware) > 128 || len(req.Agent) > 64 || len(req.Token) > 256 {
		onboardingError(w, 400, "invalid_identity")
		return
	}
	csr, e := parseCSR(req.CSR)
	if e != nil {
		onboardingError(w, 400, "invalid_identity")
		return
	}
	pub, _ := x509.MarshalPKIXPublicKey(csr.PublicKey)
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
	if e = enrollmentLock(tx); e != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	productID, revision, identifiers, e := bootstrapProduct(tx, req.Model, requestIdentifierMap(req.Identifiers, req.MAC))
	if e != nil {
		onboardingError(w, 400, "invalid_identity")
		return
	}
	claimIdentifiers := requestIdentifierMap(identifiers, "")
	claimIdentifiers["serial"] = req.Serial
	claims := productClaims(revision, claimIdentifiers)
	owner, e := identityOwnerFor(tx, "serial", req.Serial)
	if e != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	if owner != nil {
		for kind, value := range claims {
			other, err := identityOwnerFor(tx, kind, value)
			if err != nil || (other != nil && (other.Kind != owner.Kind || other.ID != owner.ID)) {
				onboardingError(w, 409, "identity_conflict")
				return
			}
		}
	}

	if owner != nil && owner.Kind == "device" {
		var org string
		var oldPub []byte
		var revoked bool
		var oldProduct sql.NullString
		e = tx.QueryRow("SELECT organization_id,public_key,revoked,product_id FROM devices WHERE id=$1 FOR UPDATE", owner.ID).Scan(&org, &oldPub, &revoked, &oldProduct)
		if e != nil {
			onboardingError(w, 503, "temporarily_unavailable")
			return
		}
		if revoked {
			onboardingError(w, 403, "revoked")
			return
		}
		if !bytes.Equal(pub, oldPub) {
			onboardingError(w, 409, "identity_conflict")
			return
		}
		if oldProduct.Valid && productID != "" && oldProduct.String != productID {
			onboardingError(w, 409, "product_mismatch")
			return
		}
		_, e = tx.Exec("UPDATE devices SET model=$2,firmware_version=$3,agent_version=$4,identifiers=identifiers||$5,product_id=coalesce(product_id,$6),product_revision=coalesce(product_revision,$7),last_seen=now() WHERE id=$1", owner.ID, req.Model, req.Firmware, req.Agent, raw(identifiers), onboardingNullableString(productID), onboardingNullableInt(revision.Version))
		if e == nil {
			e = ensureIdentityClaims(tx, "device", owner.ID, claims)
		}
		if e != nil {
			onboardingError(w, 409, "identity_conflict")
			return
		}
		s.finishBootstrap(w, tx, owner.ID, org, csr)
		return
	}
	if owner != nil && owner.Kind == "registration" {
		var org, registrationProduct, name string
		var registrationRevision int
		var tags, regIdentifiers []byte
		var canceled bool
		e = tx.QueryRow("SELECT organization_id,product_id,product_revision,name,tags,identifiers,canceled FROM registrations WHERE id=$1 AND device_id IS NULL FOR UPDATE", owner.ID).Scan(&org, &registrationProduct, &registrationRevision, &name, &tags, &regIdentifiers, &canceled)
		if e != nil || canceled {
			onboardingError(w, 409, "identity_conflict")
			return
		}
		if productID != "" && productID != registrationProduct {
			onboardingError(w, 409, "product_mismatch")
			return
		}
		deviceID := randomID()
		_, e = tx.Exec(`INSERT INTO devices(id,organization_id,serial_number,product_id,product_revision,identifiers,model,firmware_version,agent_version,public_key,name)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, deviceID, org, req.Serial, registrationProduct, registrationRevision, mergeJSONObjects(regIdentifiers, raw(identifiers)), req.Model, req.Firmware, req.Agent, pub, name)
		if e == nil {
			e = transferIdentityClaims(tx, "registration", owner.ID, deviceID)
		}
		if e == nil {
			e = ensureIdentityClaims(tx, "device", deviceID, claims)
		}
		if e == nil {
			_, e = tx.Exec("UPDATE registrations SET device_id=$2 WHERE id=$1", owner.ID, deviceID)
		}
		if e != nil {
			onboardingError(w, 409, "identity_conflict")
			return
		}
		s.finishBootstrap(w, tx, deviceID, org, csr)
		return
	}
	if owner != nil && owner.Kind == "pending" {
		var pendingOrg, pendingToken, pendingProduct sql.NullString
		var pendingPub []byte
		var canceled bool
		e = tx.QueryRow("SELECT organization_id,token_id,product_id,public_key,canceled FROM pending_devices WHERE id=$1 AND device_id IS NULL FOR UPDATE", owner.ID).Scan(&pendingOrg, &pendingToken, &pendingProduct, &pendingPub, &canceled)
		if e != nil || canceled || !bytes.Equal(pub, pendingPub) || !pendingToken.Valid || req.Token == "" {
			onboardingError(w, 403, "invalid_token")
			return
		}
		var tokenID, org string
		e = tx.QueryRow("SELECT id,organization_id FROM enrollment_tokens WHERE token_hash=$1 AND NOT revoked AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE", digest(req.Token)).Scan(&tokenID, &org)
		if e != nil || tokenID != pendingToken.String || (pendingOrg.Valid && pendingOrg.String != org) {
			onboardingError(w, 403, "invalid_token")
			return
		}
		if productID != "" && pendingProduct.Valid && productID != pendingProduct.String {
			onboardingError(w, 409, "product_mismatch")
			return
		}
		_, e = tx.Exec("UPDATE pending_devices SET last_seen=now(),model=$2,firmware_version=$3,agent_version=$4,identifiers=identifiers||$5,product_id=coalesce(product_id,$6),product_revision=coalesce(product_revision,$7),organization_id=$8 WHERE id=$1", owner.ID, req.Model, req.Firmware, req.Agent, raw(identifiers), onboardingNullableString(productID), onboardingNullableInt(revision.Version), org)
		if e == nil {
			e = ensureIdentityClaims(tx, "pending", owner.ID, claims)
		}
		if e != nil || tx.Commit() != nil {
			onboardingError(w, 409, "identity_conflict")
			return
		}
		output(w, 200, map[string]string{"registration_state": "awaiting_claim", "code": "awaiting_claim"})
		return
	}
	if req.Token == "" {
		if tx.Commit() != nil {
			onboardingError(w, 503, "temporarily_unavailable")
			return
		}
		output(w, 200, map[string]string{"registration_state": "not_registered", "code": "not_registered"})
		return
	}
	var tokenID, org string
	var used int
	var max sql.NullInt64
	e = tx.QueryRow("SELECT id,organization_id,used_count,max_uses FROM enrollment_tokens WHERE token_hash=$1 AND NOT revoked AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE", digest(req.Token)).Scan(&tokenID, &org, &used, &max)
	if e != nil {
		onboardingError(w, 403, "invalid_token")
		return
	}
	if max.Valid && int64(used) >= max.Int64 {
		onboardingError(w, 403, "token_exhausted")
		return
	}
	pending := randomID()
	_, e = tx.Exec(`INSERT INTO pending_devices(id,serial_number,product_id,product_revision,identifiers,model,firmware_version,agent_version,public_key,organization_id,token_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, pending, req.Serial, onboardingNullableString(productID), onboardingNullableInt(revision.Version), raw(identifiers), req.Model, req.Firmware, req.Agent, pub, org, tokenID)
	if e == nil {
		e = insertIdentityClaims(tx, "pending", pending, claims)
	}
	if e == nil {
		_, e = tx.Exec("UPDATE enrollment_tokens SET used_count=used_count+1 WHERE id=$1", tokenID)
	}
	if e != nil || tx.Commit() != nil {
		onboardingError(w, 409, "identity_conflict")
		return
	}
	output(w, 200, map[string]string{"registration_state": "awaiting_claim", "code": "awaiting_claim"})
}

func onboardingNullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func onboardingNullableInt(value int) any {
	if value < 1 {
		return nil
	}
	return value
}
func mergeJSONObjects(a, b []byte) []byte {
	left, right := map[string]string{}, map[string]string{}
	_ = json.Unmarshal(a, &left)
	_ = json.Unmarshal(b, &right)
	for k, v := range right {
		left[k] = v
	}
	out, _ := json.Marshal(left)
	return out
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
	if e == nil {
		e = audit(tx, org, "", "device.enroll", id)
	}
	if e != nil || tx.Commit() != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	output(w, 200, map[string]any{"registration_state": "claimed", "device_id": id, "certificate": cert, "organization_name": name, "mqtt_host": s.Config.MQTTPublicHost, "mqtt_port": 8883})
}

func activatePending(tx *sql.Tx, pending, org, name string, tags []byte, user string, registrationID ...string) (string, error) {
	var serial, model, firmware, agent string
	var productID sql.NullString
	var productRevision sql.NullInt64
	var identifiers []byte
	var canceled bool
	if err := tx.QueryRow(`SELECT serial_number,product_id,product_revision,identifiers,model,firmware_version,agent_version,canceled FROM pending_devices WHERE id=$1 AND device_id IS NULL FOR UPDATE`, pending).Scan(&serial, &productID, &productRevision, &identifiers, &model, &firmware, &agent, &canceled); err != nil || canceled {
		return "", errors.New("pending device unavailable")
	}
	id := randomID()
	_, err := tx.Exec(`INSERT INTO devices(id,organization_id,serial_number,product_id,product_revision,identifiers,model,firmware_version,agent_version,public_key,name)
        SELECT $2,$3,serial_number,product_id,product_revision,identifiers,model,firmware_version,agent_version,public_key,$4 FROM pending_devices WHERE id=$1 AND NOT canceled AND device_id IS NULL`, pending, id, org, name)
	if err != nil {
		return "", err
	}
	if len(registrationID) > 0 && registrationID[0] != "" {
		err = transferIdentityClaims(tx, "registration", registrationID[0], id)
	} else {
		err = transferIdentityClaims(tx, "pending", pending, id)
	}
	if err == nil {
		var count int
		err = tx.QueryRow("SELECT count(*) FROM identity_claims WHERE device_id=$1", id).Scan(&count)
		if err == nil && count == 0 {
			claims := map[string]string{"serial": serial}
			var values map[string]string
			_ = json.Unmarshal(identifiers, &values)
			for k, v := range values {
				claims[k] = v
			}
			err = insertIdentityClaims(tx, "device", id, claims)
		}
	}
	if err == nil {
		_, err = tx.Exec("UPDATE pending_devices SET device_id=$2 WHERE id=$1", pending, id)
	}
	if err == nil {
		err = assignTags(tx, id, org, tags)
	}
	if err == nil {
		_, err = tx.Exec("INSERT INTO device_group_members(group_id,device_id) SELECT tg.group_id,$2 FROM enrollment_token_groups tg JOIN pending_devices p ON p.token_id=tg.token_id WHERE p.id=$1 ON CONFLICT DO NOTHING", pending, id)
	}
	if err == nil {
		err = assignDefaultTelemetry(tx, id)
	}
	if err == nil {
		err = reconcileDeviceTx(tx, id, org)
	}
	if err == nil {
		err = audit(tx, org, user, "device.claim", id)
	}
	return id, err
}

func assignTags(tx *sql.Tx, device, org string, data []byte) error {
	var names []string
	if len(data) > 0 && json.Unmarshal(data, &names) != nil {
		return errors.New("invalid tags")
	}
	if _, e := tx.Exec("DELETE FROM device_tags WHERE device_id=$1", device); e != nil {
		return e
	}
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		var id string
		if e := tx.QueryRow("INSERT INTO tags VALUES($1,$2,$3) ON CONFLICT(organization_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id", randomID(), org, name).Scan(&id); e != nil {
			return e
		}
		if _, e := tx.Exec("INSERT INTO device_tags VALUES($1,$2) ON CONFLICT DO NOTHING", device, id); e != nil {
			return e
		}
	}
	return nil
}

type registrationInput struct {
	Name        string            `json:"name"`
	Serial      string            `json:"serial_number"`
	MAC         string            `json:"lan_mac,omitempty"`
	Identifiers map[string]string `json:"identifiers,omitempty"`
	ProductID   string            `json:"product_id,omitempty"`
	Tags        []string          `json:"tags"`
}

func normalizeNameAndTags(v *registrationInput) error {
	v.Name, v.Serial = strings.TrimSpace(v.Name), strings.TrimSpace(v.Serial)
	if len(v.Name) > 128 || len(v.Tags) > 32 {
		return errors.New("invalid name or tags")
	}
	tags, seen := []string{}, map[string]bool{}
	for _, tag := range v.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if len(tag) > 64 {
			return errors.New("invalid tag")
		}
		if !seen[tag] {
			tags, seen[tag] = append(tags, tag), true
		}
	}
	v.Tags = tags
	return nil
}
func normalizeRegistration(v *registrationInput, schemas ...[]IdentityRule) error {
	if err := normalizeNameAndTags(v); err != nil {
		return err
	}
	if v.Serial == "" || len(v.Serial) > 63 {
		return errors.New("invalid serial")
	}
	schema := []IdentityRule{{Kind: "mac", Label: "LAN MAC", Required: true, Normalize: "mac", Unique: true}}
	if len(schemas) > 0 {
		schema = schemas[0]
	}
	identifiers, err := normalizeIdentifiers(schema, requestIdentifierMap(v.Identifiers, v.MAC))
	if err != nil {
		return errors.New("invalid identity")
	}
	v.Identifiers, v.MAC = identifiers, identifiers["mac"]
	return nil
}

func (s *Core) pendingDevices(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, &a)
	if !ok {
		fail(w, 400, "invalid organization")
		return
	}
	s.rows(w, `SELECT row_to_json(t) FROM (SELECT p.id,p.organization_id,p.serial_number,p.identifiers,p.product_id,p.model,p.last_seen FROM pending_devices p WHERE NOT p.canceled AND p.device_id IS NULL AND ($1 OR p.organization_id=$2) ORDER BY p.last_seen DESC LIMIT 500) t`, a.AllOrgs, org)
}
func (s *Core) claimPending(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Name string   `json:"name"`
		Tags []string `json:"tags"`
	}
	if !body(w, r, &v) {
		return
	}
	check := registrationInput{Name: v.Name, Serial: "validation", Tags: v.Tags}
	if normalizeNameAndTags(&check) != nil {
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
	e = tx.QueryRow("SELECT organization_id FROM pending_devices WHERE id=$1 AND NOT canceled AND device_id IS NULL AND organization_id IS NOT NULL AND ($2='SUPER_ADMIN' OR organization_id=$3) FOR UPDATE", r.PathValue("id"), a.Role, a.Org).Scan(&org)
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
	org, ok := scopedOrganization(r, &a)
	if !ok {
		fail(w, 400, "invalid organization")
		return
	}
	s.rows(w, `SELECT row_to_json(t) FROM (SELECT r.*,CASE WHEN device_id IS NOT NULL THEN 'claimed' WHEN canceled THEN 'canceled' ELSE 'awaiting_device' END AS status FROM registrations r WHERE $1 OR organization_id=$2 ORDER BY created_at DESC LIMIT 500) t`, a.AllOrgs, org)
}
func (s *Core) registrationConflict(tx *sql.Tx, org string, v registrationInput) error {
	revision := &productRevision{IdentitySchema: []IdentityRule{{Kind: "mac", Normalize: "mac", Required: true, Unique: true}}}
	var err error
	if v.ProductID != "" {
		revision, err = loadProductRevision(tx, v.ProductID, nil)
		if err != nil {
			return err
		}
	}
	claims := productClaims(revision, requestIdentifierMap(v.Identifiers, v.MAC))
	claims["serial"] = v.Serial
	return identityClaimsConflict(tx, claims, nil)
}
func (s *Core) registerOne(org, user, productID string, v registrationInput) (string, error) {
	if productID == "" {
		productID = v.ProductID
	}
	if productID == "" && v.MAC != "" {
		productID = Legacy2SProductID
	}
	if !validID(productID) {
		return "", errors.New("product required")
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if err = enrollmentLock(tx); err != nil {
		return "", err
	}
	revision, err := loadProductRevision(tx, productID, nil)
	if err != nil {
		return "", err
	}
	if err = normalizeRegistration(&v, revision.IdentitySchema); err != nil {
		return "", err
	}
	v.ProductID = productID
	identifiers := requestIdentifierMap(v.Identifiers, v.MAC)
	identifiers["serial"] = v.Serial
	claims := productClaims(revision, identifiers)
	owner, err := identityOwnerFor(tx, "serial", v.Serial)
	if err != nil {
		return "", err
	}
	mergePending := owner != nil && owner.Kind == "pending"
	if owner != nil && !mergePending {
		return "", errors.New("identity_conflict")
	}
	if mergePending {
		var pendingOrg, pendingProduct sql.NullString
		if err = tx.QueryRow("SELECT organization_id,product_id FROM pending_devices WHERE id=$1 AND NOT canceled AND device_id IS NULL", owner.ID).Scan(&pendingOrg, &pendingProduct); err != nil || pendingOrg.Valid || (pendingProduct.Valid && pendingProduct.String != productID) {
			return "", errors.New("identity_conflict")
		}
		if err = identityClaimsConflict(tx, claims, owner); err != nil {
			return "", err
		}
	}
	id := randomID()
	tags, _ := json.Marshal(v.Tags)
	_, err = tx.Exec(`INSERT INTO registrations(id,organization_id,serial_number,product_id,product_revision,identifiers,name,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, org, v.Serial, productID, revision.Version, raw(v.Identifiers), v.Name, string(tags))
	if err != nil {
		return "", err
	}
	if mergePending {
		_, err = tx.Exec("UPDATE identity_claims SET registration_id=$1,pending_id=NULL WHERE pending_id=$2", id, owner.ID)
	} else {
		err = insertIdentityClaims(tx, "registration", id, claims)
	}
	if err != nil {
		return "", err
	}
	if mergePending {
		var device string
		device, err = activatePending(tx, owner.ID, org, v.Name, tags, user, id)
		if err == nil {
			_, err = tx.Exec("UPDATE registrations SET device_id=$2 WHERE id=$1", id, device)
		}
	}
	if err == nil {
		err = audit(tx, org, user, "registration.create", id)
	}
	if err != nil {
		return "", err
	}
	return id, tx.Commit()
}
func (s *Core) createRegistrations(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Org       string              `json:"organization_id"`
		ProductID string              `json:"product_id"`
		Rows      []registrationInput `json:"rows"`
	}
	if !body(w, r, &req) {
		return
	}
	org, ok := s.onboardingOrg(r, req.Org)
	if !ok {
		onboardingError(w, 403, "organization_required")
		return
	}
	if len(req.Rows) < 1 || len(req.Rows) > 500 || !validID(req.ProductID) {
		onboardingError(w, 400, "invalid_product_or_row_count")
		return
	}
	results := []map[string]any{}
	for i, row := range req.Rows {
		id, err := s.registerOne(org, actor(r).ID, req.ProductID, row)
		result := map[string]any{"row": i + 1, "id": id, "success": err == nil}
		if err != nil {
			result["error"] = "invalid_or_conflicting_registration"
		}
		results = append(results, result)
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
	check := registrationInput{Name: req.Name, Serial: "validation", Tags: req.Tags}
	if normalizeNameAndTags(&check) != nil {
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
		if e == nil {
			e = deleteIdentityClaims(tx, "registration", r.PathValue("id"))
		}
		action = "registration.cancel"
	} else {
		b, _ := json.Marshal(check.Tags)
		_, e = tx.Exec("UPDATE registrations SET name=$2,tags=$3 WHERE id=$1", r.PathValue("id"), check.Name, string(b))
	}
	if e == nil {
		e = audit(tx, org, a.ID, action, r.PathValue("id"))
	}
	if e != nil || tx.Commit() != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func csvHeader(schema []IdentityRule) []string {
	header := []string{"name", "serial_number"}
	for _, rule := range schema {
		header = append(header, rule.Kind)
	}
	return append(header, "tags")
}
func parseRegistrationCSV(reader io.Reader, schemas ...[]IdentityRule) ([]registrationInput, error) {
	schema := []IdentityRule{{Kind: "mac", Required: true, Normalize: "mac", Unique: true}}
	if len(schemas) > 0 {
		schema = schemas[0]
	}
	c := csv.NewReader(reader)
	header, e := c.Read()
	legacy := e == nil && strings.Join(header, ",") == "name,serial_number,lan_mac,tags"
	expected := csvHeader(schema)
	if e != nil || (!legacy && strings.Join(header, ",") != strings.Join(expected, ",")) || (legacy && !(len(schema) == 1 && schema[0].Kind == "mac")) {
		return nil, fmt.Errorf("expected CSV header: %s", strings.Join(expected, ","))
	}
	c.FieldsPerRecord = len(header)
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
		v := registrationInput{Name: record[0], Serial: record[1], Identifiers: map[string]string{}}
		for i, rule := range schema {
			v.Identifiers[rule.Kind] = record[i+2]
		}
		if legacy {
			v.MAC = record[2]
		}
		v.Tags = strings.Split(record[len(record)-1], ";")
		rows = append(rows, v)
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
	productID := r.URL.Query().Get("product_id")
	if !validID(productID) {
		onboardingError(w, 400, "invalid_product")
		return
	}
	tx, e := s.DB.Begin()
	if e != nil {
		onboardingError(w, 503, "temporarily_unavailable")
		return
	}
	revision, e := loadProductRevision(tx, productID, nil)
	tx.Rollback()
	if e != nil {
		onboardingError(w, 400, "invalid_product")
		return
	}
	b, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if e != nil {
		onboardingError(w, 413, "csv_too_large")
		return
	}
	rows, e := parseRegistrationCSV(bytes.NewReader(b), revision.IdentitySchema)
	if e != nil {
		output(w, 400, map[string]string{"error": e.Error(), "code": "invalid_csv"})
		return
	}
	out := []map[string]any{}
	seen := map[string]bool{}
	for i, row := range rows {
		err := normalizeRegistration(&row, revision.IdentitySchema)
		claims := map[string]string{"serial": row.Serial}
		for key, value := range row.Identifiers {
			if value != "" {
				claims[key] = value
			}
		}
		if err == nil {
			for kind, value := range claims {
				key := kind + "\x00" + value
				if seen[key] {
					err = errors.New("duplicate_row")
				}
				seen[key] = true
			}
		}
		if err == nil {
			tx, te := s.DB.Begin()
			if te != nil {
				err = te
			} else {
				row.ProductID = productID
				err = s.registrationConflict(tx, org, row)
				tx.Rollback()
			}
		}
		item := map[string]any{"row": i + 1, "data": row, "valid": err == nil}
		if err != nil {
			item["error"] = "invalid_or_conflicting_registration"
		}
		out = append(out, item)
	}
	output(w, 200, out)
}

func (s *Core) tags(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, &a)
	if !ok {
		fail(w, 400, "invalid organization")
		return
	}
	s.rows(w, "SELECT row_to_json(t) FROM (SELECT * FROM tags WHERE $1 OR organization_id=$2 ORDER BY name) t", a.AllOrgs, org)
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
