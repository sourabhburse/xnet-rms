package rms

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"unicode"
)

const (
	Legacy2SProductID = "00000000000000000000000000000002"
	UnknownProductID  = "00000000000000000000000000000000"
)

type IdentityRule struct {
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	Required  bool   `json:"required"`
	Normalize string `json:"normalize"`
	Unique    bool   `json:"unique"`
}

type Product struct {
	ID                    string         `json:"id"`
	Code                  string         `json:"code"`
	Name                  string         `json:"name"`
	Description           string         `json:"description"`
	IdentitySchema        []IdentityRule `json:"identity_schema"`
	ModelPatterns         []string       `json:"model_patterns"`
	Capabilities          []string       `json:"capabilities"`
	CurrentRevision       int            `json:"current_revision"`
	DefaultProfileID      *string        `json:"default_profile_id,omitempty"`
	DefaultProfileVersion *int           `json:"default_profile_version,omitempty"`
	Archived              bool           `json:"archived"`
}

type productRevision struct {
	ProductID             string
	Version               int
	IdentitySchema        []IdentityRule
	ModelPatterns         []string
	Capabilities          []string
	DefaultProfileID      *string
	DefaultProfileVersion *int
}

func decodeJSON[T any](b []byte, out *T) error {
	if len(b) == 0 {
		return json.Unmarshal([]byte("null"), out)
	}
	return json.Unmarshal(b, out)
}

func validateIdentitySchema(schema []IdentityRule) error {
	seen := map[string]bool{}
	for i := range schema {
		r := &schema[i]
		r.Kind = strings.ToLower(strings.TrimSpace(r.Kind))
		r.Label = strings.TrimSpace(r.Label)
		r.Normalize = strings.ToLower(strings.TrimSpace(r.Normalize))
		if r.Normalize == "" {
			r.Normalize = "raw"
		}
		if !validIdentifierKind(r.Kind) || seen[r.Kind] || len(r.Label) > 128 {
			return errors.New("invalid or duplicate identity kind")
		}
		if r.Normalize != "mac" && r.Normalize != "imei" && r.Normalize != "upper" && r.Normalize != "raw" {
			return errors.New("unsupported identity normalizer")
		}
		seen[r.Kind] = true
	}
	return nil
}

func validIdentifierKind(kind string) bool {
	if kind == "" || len(kind) > 64 || kind[0] < 'a' || kind[0] > 'z' {
		return false
	}
	for _, r := range kind[1:] {
		if !(unicode.IsLower(r) || unicode.IsDigit(r) || r == '_' || r == '-' || r == '.') {
			return false
		}
	}
	return true
}

func normalizeIMEI(value string) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) != 15 {
		return "", errors.New("IMEI must contain 15 digits")
	}
	sum := 0
	for i := len(value) - 1; i >= 0; i-- {
		if value[i] < '0' || value[i] > '9' {
			return "", errors.New("IMEI must contain digits only")
		}
		n := int(value[i] - '0')
		if (len(value)-1-i)%2 == 1 {
			n *= 2
			if n > 9 {
				n -= 9
			}
		}
		sum += n
	}
	if sum%10 != 0 {
		return "", errors.New("invalid IMEI checksum")
	}
	return value, nil
}

func normalizeIdentifierValue(rule IdentityRule, value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 256 {
		return "", errors.New("empty or oversized identifier")
	}
	switch rule.Normalize {
	case "mac":
		return normalizeMAC(value)
	case "imei":
		return normalizeIMEI(value)
	case "upper":
		return strings.ToUpper(value), nil
	default:
		return value, nil
	}
}

// normalizeIdentifiers validates the product-defined identifiers.  An empty
// schema is the deliberate unrecognized-product fallback: serial is still
// required by the caller, while any optional vendor identifiers are retained
// using a conservative raw normalization.
func normalizeIdentifiers(schema []IdentityRule, input map[string]string) (map[string]string, error) {
	out := map[string]string{}
	rules := map[string]IdentityRule{}
	for _, rule := range schema {
		rules[rule.Kind] = rule
	}
	for kind, value := range input {
		kind = strings.ToLower(strings.TrimSpace(kind))
		if !validIdentifierKind(kind) {
			return nil, errors.New("invalid identifier kind")
		}
		rule, ok := rules[kind]
		if !ok {
			rule = IdentityRule{Kind: kind, Normalize: "raw"}
		}
		value, err := normalizeIdentifierValue(rule, value)
		if err != nil {
			return nil, fmt.Errorf("invalid %s identifier", kind)
		}
		out[kind] = value
	}
	for _, rule := range schema {
		if rule.Required && out[rule.Kind] == "" {
			return nil, fmt.Errorf("required %s identifier missing", rule.Kind)
		}
	}
	return out, nil
}

func uniqueIdentifierKinds(schema []IdentityRule) map[string]bool {
	out := map[string]bool{"serial": true}
	for _, rule := range schema {
		if rule.Unique {
			out[rule.Kind] = true
		}
	}
	return out
}

func modelPatternMatches(model, pattern string) bool {
	model, pattern = strings.ToLower(strings.TrimSpace(model)), strings.ToLower(strings.TrimSpace(pattern))
	if model == pattern {
		return true
	}
	var b strings.Builder
	b.WriteString("^")
	for _, r := range pattern {
		switch r {
		case '%':
			b.WriteString(".*")
		case '_':
			b.WriteByte('.')
		default:
			b.WriteString(regexp.QuoteMeta(string(r)))
		}
	}
	b.WriteString("$")
	matched, _ := regexp.MatchString(b.String(), model)
	return matched
}

func decodeProductRevision(productID string, version int, schema, patterns, capabilities []byte, defaultID sql.NullString, defaultVersion sql.NullInt64) (*productRevision, error) {
	var identity []IdentityRule
	var models, caps []string
	if err := decodeJSON(schema, &identity); err != nil {
		return nil, err
	}
	if err := decodeJSON(patterns, &models); err != nil {
		return nil, err
	}
	if err := decodeJSON(capabilities, &caps); err != nil {
		return nil, err
	}
	if err := validateIdentitySchema(identity); err != nil {
		return nil, err
	}
	r := &productRevision{ProductID: productID, Version: version, IdentitySchema: identity, ModelPatterns: models, Capabilities: caps}
	if defaultID.Valid {
		r.DefaultProfileID = &defaultID.String
	}
	if defaultVersion.Valid {
		v := int(defaultVersion.Int64)
		r.DefaultProfileVersion = &v
	}
	return r, nil
}

func loadProductRevision(tx *sql.Tx, productID string, version *int) (*productRevision, error) {
	query := `SELECT pr.product_id,pr.version,pr.identity_schema,pr.model_patterns,pr.capabilities,
                     pr.default_profile_id,pr.default_profile_version
	              FROM product_revisions pr JOIN products p ON p.id=pr.product_id
              WHERE pr.product_id=$1 AND NOT p.archived`
	args := []any{productID}
	if version == nil || *version < 1 {
		query += " ORDER BY version DESC LIMIT 1"
	} else {
		query += " AND version=$2"
		args = append(args, *version)
	}
	var id string
	var v int
	var schema, patterns, caps []byte
	var profile sql.NullString
	var profileVersion sql.NullInt64
	err := tx.QueryRow(query, args...).Scan(&id, &v, &schema, &patterns, &caps, &profile, &profileVersion)
	if err != nil {
		return nil, err
	}
	return decodeProductRevision(id, v, schema, patterns, caps, profile, profileVersion)
}

func resolveProduct(tx *sql.Tx, model string) (string, *productRevision, error) {
	rows, err := tx.Query(`SELECT id,current_revision FROM products WHERE NOT archived ORDER BY code`)
	if err != nil {
		return "", nil, err
	}
	var products []struct {
		id      string
		version int
	}
	for rows.Next() {
		var item struct {
			id      string
			version int
		}
		if err := rows.Scan(&item.id, &item.version); err != nil {
			return "", nil, err
		}
		products = append(products, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return "", nil, err
	}
	rows.Close()
	for _, item := range products {
		revision, err := loadProductRevision(tx, item.id, &item.version)
		if err != nil {
			return "", nil, err
		}
		for _, pattern := range revision.ModelPatterns {
			if modelPatternMatches(model, pattern) {
				return item.id, revision, nil
			}
		}
	}
	return "", nil, rows.Err()
}

func productClaims(revision *productRevision, identifiers map[string]string) map[string]string {
	unique := uniqueIdentifierKinds(revision.IdentitySchema)
	claims := map[string]string{"serial": identifiers["serial"]}
	for kind, value := range identifiers {
		if unique[kind] && value != "" {
			claims[kind] = value
		}
	}
	return claims
}

func validateProductMutation(code, name, description string, schema []IdentityRule, patterns, capabilities []string) error {
	if !safeName(strings.ToLower(code)) || len(code) > 64 || strings.TrimSpace(name) == "" || len(name) > 128 || len(description) > 512 || len(patterns) > 64 || len(capabilities) > 64 {
		return errors.New("invalid product code, name, description, patterns or capabilities")
	}
	if err := validateIdentitySchema(schema); err != nil {
		return err
	}
	for _, pattern := range patterns {
		if strings.TrimSpace(pattern) == "" || len(pattern) > 128 {
			return errors.New("invalid model pattern")
		}
	}
	for _, capability := range capabilities {
		if !safeName(capability) || len(capability) > 64 {
			return errors.New("invalid product capability")
		}
	}
	return nil
}

func (s *Core) products(w http.ResponseWriter, r *http.Request) {
	s.rows(w, `SELECT row_to_json(p) FROM (
        SELECT id,code,name,description,identity_schema,model_patterns,capabilities,
               current_revision,default_profile_id,default_profile_version,archived,created_at
        FROM products WHERE NOT archived ORDER BY name
    ) p`)
}

type productMutation struct {
	Code                  *string         `json:"code"`
	Name                  *string         `json:"name"`
	Description           *string         `json:"description"`
	IdentitySchema        *[]IdentityRule `json:"identity_schema"`
	ModelPatterns         *[]string       `json:"model_patterns"`
	Capabilities          *[]string       `json:"capabilities"`
	DefaultProfileID      *string         `json:"default_profile_id"`
	DefaultProfileVersion *int            `json:"default_profile_version"`
	Archived              *bool           `json:"archived"`
}

func (s *Core) createProduct(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code                  string         `json:"code"`
		Name                  string         `json:"name"`
		Description           string         `json:"description"`
		IdentitySchema        []IdentityRule `json:"identity_schema"`
		ModelPatterns         []string       `json:"model_patterns"`
		Capabilities          []string       `json:"capabilities"`
		DefaultProfileID      *string        `json:"default_profile_id"`
		DefaultProfileVersion *int           `json:"default_profile_version"`
	}
	if !body(w, r, &req) {
		return
	}
	req.Code, req.Name, req.Description = strings.ToLower(strings.TrimSpace(req.Code)), strings.TrimSpace(req.Name), strings.TrimSpace(req.Description)
	if validateProductMutation(req.Code, req.Name, req.Description, req.IdentitySchema, req.ModelPatterns, req.Capabilities) != nil || (req.DefaultProfileID != nil && (req.DefaultProfileVersion == nil || !validID(*req.DefaultProfileID))) {
		fail(w, 400, "invalid product definition")
		return
	}
	id := randomID()
	tx, err := s.DB.Begin()
	if err != nil {
		fail(w, 503, "product storage unavailable")
		return
	}
	defer tx.Rollback()
	if req.DefaultProfileID != nil {
		var ok bool
		err = tx.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE id=$1 AND version=$2 AND organization_id IS NULL)", *req.DefaultProfileID, *req.DefaultProfileVersion).Scan(&ok)
		if err == nil && !ok {
			err = errors.New("default profile not found")
		}
	}
	if err == nil {
		_, err = tx.Exec(`INSERT INTO products(id,code,name,description,identity_schema,model_patterns,capabilities,default_profile_id,default_profile_version)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, req.Code, req.Name, req.Description, raw(req.IdentitySchema), raw(req.ModelPatterns), raw(req.Capabilities), req.DefaultProfileID, req.DefaultProfileVersion)
	}
	if err == nil {
		_, err = tx.Exec(`INSERT INTO product_revisions(product_id,version,identity_schema,model_patterns,capabilities,default_profile_id,default_profile_version)
            VALUES($1,1,$2,$3,$4,$5,$6)`, id, raw(req.IdentitySchema), raw(req.ModelPatterns), raw(req.Capabilities), req.DefaultProfileID, req.DefaultProfileVersion)
	}
	if err == nil {
		err = audit(tx, "", actor(r).ID, "product.create", id)
	}
	if err != nil || tx.Commit() != nil {
		fail(w, 409, "product creation failed")
		return
	}
	output(w, 201, map[string]string{"id": id})
}

func (s *Core) updateProduct(w http.ResponseWriter, r *http.Request) {
	var req productMutation
	if !body(w, r, &req) {
		return
	}
	tx, err := s.DB.Begin()
	if err != nil {
		fail(w, 503, "product storage unavailable")
		return
	}
	defer tx.Rollback()
	var p Product
	var schema, patterns, caps []byte
	var profile sql.NullString
	var profileVersion sql.NullInt64
	err = tx.QueryRow(`SELECT id,code,name,description,identity_schema,model_patterns,capabilities,current_revision,
        default_profile_id,default_profile_version,archived FROM products WHERE id=$1 FOR UPDATE`, r.PathValue("id")).Scan(&p.ID, &p.Code, &p.Name, &p.Description, &schema, &patterns, &caps, &p.CurrentRevision, &profile, &profileVersion, &p.Archived)
	if err != nil {
		fail(w, 404, "product not found")
		return
	}
	if decodeJSON(schema, &p.IdentitySchema) != nil || decodeJSON(patterns, &p.ModelPatterns) != nil || decodeJSON(caps, &p.Capabilities) != nil {
		fail(w, 503, "product data unavailable")
		return
	}
	if req.Code != nil {
		p.Code = strings.ToLower(strings.TrimSpace(*req.Code))
	}
	if req.Name != nil {
		p.Name = strings.TrimSpace(*req.Name)
	}
	if req.Description != nil {
		p.Description = strings.TrimSpace(*req.Description)
	}
	if req.IdentitySchema != nil {
		p.IdentitySchema = *req.IdentitySchema
	}
	if req.ModelPatterns != nil {
		p.ModelPatterns = *req.ModelPatterns
	}
	if req.Capabilities != nil {
		p.Capabilities = *req.Capabilities
	}
	if req.DefaultProfileID != nil {
		p.DefaultProfileID = req.DefaultProfileID
	}
	if req.DefaultProfileVersion != nil {
		p.DefaultProfileVersion = req.DefaultProfileVersion
	}
	if req.Archived != nil {
		p.Archived = *req.Archived
	}
	if p.DefaultProfileID == nil || p.DefaultProfileVersion == nil {
		p.DefaultProfileID, p.DefaultProfileVersion = nil, nil
	}
	if err = validateProductMutation(p.Code, p.Name, p.Description, p.IdentitySchema, p.ModelPatterns, p.Capabilities); err != nil {
		fail(w, 400, err.Error())
		return
	}
	if p.DefaultProfileID != nil {
		var ok bool
		err = tx.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE id=$1 AND version=$2 AND organization_id IS NULL)", *p.DefaultProfileID, *p.DefaultProfileVersion).Scan(&ok)
		if err == nil && !ok {
			err = errors.New("default profile not found")
		}
	}
	next := p.CurrentRevision + 1
	if err == nil {
		_, err = tx.Exec(`UPDATE products SET code=$2,name=$3,description=$4,identity_schema=$5,model_patterns=$6,capabilities=$7,
            current_revision=$8,default_profile_id=$9,default_profile_version=$10,archived=$11 WHERE id=$1`, p.ID, p.Code, p.Name, p.Description, raw(p.IdentitySchema), raw(p.ModelPatterns), raw(p.Capabilities), next, p.DefaultProfileID, p.DefaultProfileVersion, p.Archived)
	}
	if err == nil {
		_, err = tx.Exec(`INSERT INTO product_revisions(product_id,version,identity_schema,model_patterns,capabilities,default_profile_id,default_profile_version)
            VALUES($1,$2,$3,$4,$5,$6,$7)`, p.ID, next, raw(p.IdentitySchema), raw(p.ModelPatterns), raw(p.Capabilities), p.DefaultProfileID, p.DefaultProfileVersion)
	}
	if err == nil {
		err = audit(tx, "", actor(r).ID, "product.update", p.ID)
	}
	if err != nil || tx.Commit() != nil {
		fail(w, 409, "product update failed")
		return
	}
	output(w, 200, map[string]any{"id": p.ID, "revision": next, "archived": p.Archived})
}

func (s *Core) archiveProduct(w http.ResponseWriter, r *http.Request) {
	tx, err := s.DB.Begin()
	if err != nil {
		fail(w, 503, "product storage unavailable")
		return
	}
	defer tx.Rollback()
	var code string
	err = tx.QueryRow("UPDATE products SET archived=true WHERE id=$1 AND NOT archived RETURNING code", r.PathValue("id")).Scan(&code)
	if err != nil {
		fail(w, 404, "product not found")
		return
	}
	if err = audit(tx, "", actor(r).ID, "product.archive", r.PathValue("id")); err != nil || tx.Commit() != nil {
		fail(w, 503, "product archive failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func productDisplayName(tx *sql.Tx, id string) string {
	var name string
	_ = tx.QueryRow("SELECT name FROM products WHERE id=$1", id).Scan(&name)
	return name
}
