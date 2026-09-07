package rms

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const MaxSnapshot = 64 * 1024

type Field struct {
	ID     string            `json:"id"`
	Path   string            `json:"path"`
	Label  string            `json:"label"`
	Unit   string            `json:"unit"`
	Kind   string            `json:"kind"`
	Status map[string]string `json:"status,omitempty"`
	Chart  *bool             `json:"chart,omitempty"`
	Fleet  *bool             `json:"fleet,omitempty"`
}

type Profile struct {
	ID            string          `json:"id"`
	Version       int             `json:"version"`
	Name          string          `json:"name"`
	SourceID      string          `json:"source_id"`
	Type          string          `json:"type"`
	Object        string          `json:"object,omitempty"`
	Method        string          `json:"method,omitempty"`
	Args          json.RawMessage `json:"args,omitempty"`
	BundleID      string          `json:"bundle_id,omitempty"`
	BundleVersion int             `json:"bundle_version,omitempty"`
	Interval      int             `json:"interval_seconds"`
	Timeout       int             `json:"timeout_seconds"`
	MaxOutput     int             `json:"max_output_bytes"`
	Entities      string          `json:"entities,omitempty"`
	EntityKey     string          `json:"entity_key,omitempty"`
	Fields        []Field         `json:"fields"`
}

func (p Profile) Validate() error {
	if !validID(p.ID) || p.Version < 1 || !safeName(p.SourceID) || len(p.Name) == 0 || len(p.Name) > 128 || p.Interval < 60 || p.Interval > 300 || p.Timeout < 1 || p.Timeout > 15 || p.MaxOutput < 256 || p.MaxOutput > 32768 || len(p.Fields) > 64 {
		return errors.New("invalid profile identity, interval, limits or fields")
	}
	if p.Type == "ubus" {
		if len(p.Object) < 1 || len(p.Object) > 128 || !safeName(p.Method) {
			return errors.New("ubus object and method required")
		}
		if len(p.Args) > 4096 {
			return errors.New("ubus args too large")
		}
		if len(p.Args) > 0 {
			var obj map[string]any
			if json.Unmarshal(p.Args, &obj) != nil || obj == nil {
				return errors.New("ubus args must be an object")
			}
		}
	} else if p.Type == "script" {
		if !validID(p.BundleID) || p.BundleVersion < 1 {
			return errors.New("approved bundle required")
		}
	} else {
		return errors.New("only script and ubus collection supported")
	}
	seen := map[string]bool{}
	for _, f := range p.Fields {
		if !safeName(f.ID) || seen[f.ID] || len(f.Path) > 256 || len(f.Label) > 128 || len(f.Unit) > 32 {
			return errors.New("invalid or duplicate field")
		}
		seen[f.ID] = true
		if f.Kind != "gauge" && f.Kind != "counter" && f.Kind != "state" && f.Kind != "text" {
			return errors.New("unsupported field kind")
		}
	}
	if p.Entities != "" && p.EntityKey == "" {
		return errors.New("repeated entities require a stable key")
	}
	return nil
}

func pointer(v any, path string) (any, bool) {
	if path == "" {
		return v, true
	}
	if !strings.HasPrefix(path, "/") {
		return nil, false
	}
	for _, part := range strings.Split(path[1:], "/") {
		part = strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
		switch o := v.(type) {
		case map[string]any:
			var ok bool
			v, ok = o[part]
			if !ok {
				return nil, false
			}
		case []any:
			n, e := strconv.Atoi(part)
			if e != nil || n < 0 || n >= len(o) {
				return nil, false
			}
			v = o[n]
		default:
			return nil, false
		}
	}
	return v, true
}

type Selected struct {
	Value any    `json:"value"`
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Unit  string `json:"unit,omitempty"`
	State string `json:"state,omitempty"`
}

func Extract(p Profile, data json.RawMessage) (map[string]Selected, error) {
	var root any
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	if e := d.Decode(&root); e != nil {
		return nil, e
	}
	out := map[string]Selected{}
	entities := map[string]any{"": root}
	if p.Entities != "" {
		entities = map[string]any{}
		v, ok := pointer(root, p.Entities)
		if !ok {
			return out, nil
		}
		arr, ok := v.([]any)
		if !ok || len(arr) > 128 {
			return nil, errors.New("entities must be an array of <=128 items")
		}
		for _, entity := range arr {
			k, ok := pointer(entity, p.EntityKey)
			if !ok {
				return nil, errors.New("missing entity identity")
			}
			id, ok := k.(string)
			if !ok || len(id) == 0 || len(id) > 128 {
				return nil, errors.New("entity identity must be a bounded string")
			}
			if _, exists := entities[id]; exists {
				return nil, errors.New("duplicate entity identity")
			}
			entities[id] = entity
		}
	}
	for entity, obj := range entities {
		for _, f := range p.Fields {
			v, ok := pointer(obj, f.Path)
			if !ok || v == nil {
				continue
			}
			if f.Kind == "gauge" || f.Kind == "counter" {
				n, ok := v.(json.Number)
				if !ok {
					return nil, fmt.Errorf("field %s must be numeric", f.ID)
				}
				x, e := n.Float64()
				if e != nil || math.IsNaN(x) || math.IsInf(x, 0) || (f.Kind == "counter" && x < 0) {
					return nil, errors.New("invalid numeric value")
				}
				v = x
			} else {
				switch x := v.(type) {
				case string:
					if len(x) > 1024 {
						return nil, errors.New("text field too long")
					}
				case bool:
				default:
					return nil, errors.New("state/text fields must be strings or booleans")
				}
			}
			key := f.ID
			label := f.Label
			if entity != "" {
				key = base64.RawURLEncoding.EncodeToString([]byte(entity)) + ":" + f.ID
				label = entity + " / " + label
			}
			out[key] = Selected{
				Value: v,
				Kind:  f.Kind,
				Label: label,
				Unit:  f.Unit,
				State: f.Status[fmt.Sprint(v)],
			}
		}
	}
	return out, nil
}

type Snapshot struct {
	Schema         int             `json:"schema_version"`
	DeviceID       string          `json:"device_id"`
	SourceID       string          `json:"source_id"`
	ProfileID      string          `json:"profile_id"`
	ProfileVersion int             `json:"profile_version"`
	BootID         string          `json:"boot_id"`
	Sequence       int64           `json:"sequence"`
	ObservedAt     time.Time       `json:"observed_at"`
	Status         string          `json:"status"`
	Error          string          `json:"error"`
	Dropped        int64           `json:"dropped"`
	Data           json.RawMessage `json:"data"`
}

func DecodeSnapshot(b []byte, identity string, now time.Time) (Snapshot, error) {
	var x Snapshot
	if len(b) > MaxSnapshot {
		return x, errors.New("snapshot too large")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e := d.Decode(&x); e != nil {
		return x, e
	}
	var trailing any
	if d.Decode(&trailing) != io.EOF {
		return x, errors.New("one snapshot required")
	}
	if x.Schema != 1 || x.DeviceID != identity || !validID(x.DeviceID) || !validID(x.BootID) || !validID(x.ProfileID) || !safeName(x.SourceID) || x.Sequence <= 0 || x.Dropped < 0 || x.ProfileVersion < 1 || len(x.Error) > 512 || !json.Valid(x.Data) {
		return x, errors.New("invalid snapshot envelope")
	}
	if x.ObservedAt.Before(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)) || x.ObservedAt.After(now.Add(5*time.Minute)) {
		return x, errors.New("invalid observation clock")
	}
	if x.Status != "ok" && x.Status != "error" && x.Status != "unsupported" {
		return x, errors.New("invalid collector status")
	}
	return x, nil
}

func (s *Core) Ingest(identity string, b []byte, now time.Time) error {
	x, e := DecodeSnapshot(b, identity, now)
	if e != nil {
		return e
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var definition []byte
	e = tx.QueryRow(`SELECT p.definition FROM profiles p JOIN assignments a ON a.profile_id=p.id AND a.version=p.version JOIN devices d ON d.id=a.device_id WHERE d.id=$1 AND NOT d.revoked AND p.id=$2 AND p.version=$3 FOR SHARE OF d`, identity, x.ProfileID, x.ProfileVersion).Scan(&definition)
	if e != nil {
		return e
	}
	var p Profile
	if e = json.Unmarshal(definition, &p); e != nil {
		return e
	}
	if p.SourceID != x.SourceID || len(x.Data) > p.MaxOutput {
		return errors.New("source mismatch or data too large")
	}
	fields := map[string]Selected{}
	if x.Status == "ok" {
		fields, e = Extract(p, x.Data)
		if e != nil {
			return e
		}
	}
	fb, _ := json.Marshal(fields)

	res, e := tx.Exec(`INSERT INTO snapshot_cursors VALUES($1,$2,$3,$4,$5) ON CONFLICT(device_id,source_id,boot_id) DO UPDATE SET sequence=EXCLUDED.sequence,received_at=EXCLUDED.received_at WHERE snapshot_cursors.sequence<EXCLUDED.sequence`, identity, x.SourceID, x.BootID, x.Sequence, now)
	if e != nil {
		return e
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		_, e = tx.Exec(`INSERT INTO snapshot_history VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, identity, x.SourceID, x.ProfileID, x.ProfileVersion, x.ObservedAt, now, x.Status, string(x.Data), string(fb))
		if e != nil {
			return e
		}
		_, e = tx.Exec(`INSERT INTO current_snapshots VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(device_id,source_id) DO UPDATE SET profile_id=EXCLUDED.profile_id,profile_version=EXCLUDED.profile_version,boot_id=EXCLUDED.boot_id,sequence=EXCLUDED.sequence,observed_at=EXCLUDED.observed_at,received_at=EXCLUDED.received_at,status=EXCLUDED.status,error=EXCLUDED.error,dropped=EXCLUDED.dropped,data=EXCLUDED.data,fields=EXCLUDED.fields WHERE current_snapshots.observed_at<=EXCLUDED.observed_at`, identity, x.SourceID, x.ProfileID, x.ProfileVersion, x.BootID, x.Sequence, x.ObservedAt, now, x.Status, x.Error, x.Dropped, string(x.Data), string(fb))
		if e != nil {
			return e
		}
		if e = markDirty(tx, x); e != nil {
			return e
		}
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	return s.Publish("rms/v1/devices/"+identity+"/acks", map[string]any{"boot_id": x.BootID, "source_id": x.SourceID, "sequence": x.Sequence})
}

func (s *Core) profiles(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	s.rows(w, `SELECT DISTINCT p.definition FROM profiles p WHERE $1='SUPER_ADMIN' OR EXISTS(SELECT 1 FROM assignments a JOIN devices d ON d.id=a.device_id WHERE a.profile_id=p.id AND a.version=p.version AND d.organization_id=$2)`, a.Role, a.Org)
}

func (s *Core) createProfile(w http.ResponseWriter, r *http.Request) {
	var p Profile
	if !body(w, r, &p) {
		return
	}
	if p.ID == "" {
		p.ID = randomID()
	}
	if e := p.Validate(); e != nil {
		fail(w, 400, e.Error())
		return
	}
	if p.Type == "script" {
		var n int
		s.DB.QueryRow("SELECT count(*) FROM collector_bundles WHERE id=$1 AND version=$2", p.BundleID, p.BundleVersion).Scan(&n)
		if n != 1 {
			fail(w, 400, "approved bundle not found")
			return
		}
	}
	e := s.mutateAudit("", actor(r).ID, "profile.create", p.ID, "INSERT INTO profiles VALUES($1,$2,$3,$4)", p.ID, p.Version, p.Name, string(raw(p)))
	if e != nil {
		fail(w, 409, "profile version already exists or save failed")
		return
	}
	output(w, 201, p)
}

func (s *Core) assignProfile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID      string `json:"profile_id"`
		Version int    `json:"version"`
	}
	if !body(w, r, &req) {
		return
	}
	id := r.PathValue("id")
	if !s.scopedDevice(r, id) {
		fail(w, 404, "device not found")
		return
	}
	tx, e := s.DB.Begin()
	if e != nil {
		fail(w, 503, "assignment unavailable")
		return
	}
	defer tx.Rollback()
	var b []byte
	e = tx.QueryRow("SELECT definition FROM profiles WHERE id=$1 AND version=$2", req.ID, req.Version).Scan(&b)
	if e != nil {
		fail(w, 404, "profile not found")
		return
	}
	var p Profile
	json.Unmarshal(b, &p)
	_, e = tx.Exec("SELECT id FROM devices WHERE id=$1 FOR UPDATE", id)
	if e == nil {
		_, e = tx.Exec("UPDATE assignments SET active=false WHERE device_id=$1 AND profile_id IN(SELECT id FROM profiles WHERE definition->>'source_id'=$2)", id, p.SourceID)
	}
	if e == nil {
		_, e = tx.Exec("INSERT INTO assignments VALUES($1,$2,$3,true) ON CONFLICT(device_id,profile_id,version) DO UPDATE SET active=true", id, req.ID, req.Version)
	}
	if e == nil {
		var count int
		e = tx.QueryRow("SELECT count(*) FROM assignments WHERE device_id=$1 AND active", id).Scan(&count)
		if count > 16 {
			fail(w, 400, "at most 16 active sources per device")
			return
		}
	}
	if e == nil {
		e = audit(tx, "", actor(r).ID, "profile.assign", id)
	}
	if e != nil || tx.Commit() != nil {
		fail(w, 409, "assignment failed")
		return
	}
	output(w, 200, map[string]bool{"assigned": true})
}

type Bundle struct {
	ID        string `json:"id"`
	Version   int    `json:"version"`
	Script    string `json:"script"`
	SHA256    string `json:"sha256"`
	Signature string `json:"signature"`
}

func bundleMessage(b Bundle) string {
	return fmt.Sprintf("xnet-rms/collector/v1\n%s\n%d\n%s", b.ID, b.Version, b.SHA256)
}

func (s *Core) createBundle(w http.ResponseWriter, r *http.Request) {
	var b Bundle
	if !body(w, r, &b) {
		return
	}
	if b.ID == "" {
		b.ID = randomID()
	}
	if !validID(b.ID) || b.Version < 1 || len(b.Script) < 1 || len(b.Script) > 65536 || !strings.HasPrefix(b.Script, "#!") {
		fail(w, 400, "valid executable script <=64 KiB required")
		return
	}
	kb, e := os.ReadFile(filepath.Join(s.Config.PKIDir, "collector.key"))
	if e != nil {
		fail(w, 503, "signer unavailable")
		return
	}
	block, _ := pem.Decode(kb)
	if block == nil {
		fail(w, 503, "signer invalid")
		return
	}
	key, e := x509.ParseECPrivateKey(block.Bytes)
	if e != nil {
		fail(w, 503, "signer invalid")
		return
	}
	h := sha256.Sum256([]byte(b.Script))
	b.SHA256 = hex.EncodeToString(h[:])
	msg := sha256.Sum256([]byte(bundleMessage(b)))
	sig, e := ecdsa.SignASN1(rand.Reader, key, msg[:])
	if e != nil {
		fail(w, 503, "signing failed")
		return
	}
	b.Signature = base64.StdEncoding.EncodeToString(sig)
	e = s.mutateAudit("", actor(r).ID, "bundle.create", b.ID, "INSERT INTO collector_bundles(id,version,manifest,script,signature) VALUES($1,$2,$3,$4,$5)", b.ID, b.Version, string(raw(b)), b.Script, b.Signature)
	if e != nil {
		fail(w, 409, "bundle already exists or save failed")
		return
	}
	output(w, 201, b)
}

func (s *Core) bundles(w http.ResponseWriter, r *http.Request) {
	s.rows(w, "SELECT jsonb_build_object('id',id,'version',version,'created_at',created_at) FROM collector_bundles ORDER BY created_at DESC")
}

func (s *Core) agentBundle(w http.ResponseWriter, r *http.Request) {
	id, e := s.deviceIdentity(r)
	if e != nil {
		fail(w, 403, "device authentication required")
		return
	}
	var b []byte
	e = s.DB.QueryRow(`SELECT b.manifest FROM collector_bundles b WHERE b.id=$1 AND b.version=$3 AND EXISTS(SELECT 1 FROM assignments a JOIN profiles p ON p.id=a.profile_id AND p.version=a.version WHERE a.device_id=$2 AND a.active AND p.definition->>'bundle_id'=b.id AND (p.definition->>'bundle_version')::integer=b.version)`, r.PathValue("id"), id, r.URL.Query().Get("version")).Scan(&b)
	if e != nil {
		fail(w, 404, "assigned bundle not found")
		return
	}
	output(w, 200, json.RawMessage(b))
}
