package rms

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
)

type profileAssignmentRequest struct {
	ID      string `json:"profile_id"`
	Version int    `json:"version"`
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func assignProfileTx(tx *sql.Tx, deviceID, profileID string, version int, sourceID string) error {
	if _, err := tx.Exec("UPDATE assignments SET active=false WHERE device_id=$1 AND profile_id IN(SELECT id FROM profiles WHERE definition->>'source_id'=$2)", deviceID, sourceID); err != nil {
		return err
	}
	if _, err := tx.Exec("INSERT INTO assignments(device_id,profile_id,version,active) VALUES($1,$2,$3,true) ON CONFLICT(device_id,profile_id,version) DO UPDATE SET active=true", deviceID, profileID, version); err != nil {
		return err
	}
	var count int
	if err := tx.QueryRow("SELECT count(*) FROM assignments WHERE device_id=$1 AND active", deviceID).Scan(&count); err != nil {
		return err
	}
	if count > 16 {
		return errors.New("at most 16 active sources per device")
	}
	return nil
}

func loadProfileForOrganization(tx *sql.Tx, profileID string, version int, org string, role string) (Profile, error) {
	var definition []byte
	if err := tx.QueryRow(`SELECT definition FROM profiles WHERE id=$1 AND version=$2 AND (organization_id IS NULL OR organization_id=$3 OR $4='SUPER_ADMIN')`, profileID, version, org, role).Scan(&definition); err != nil {
		return Profile{}, err
	}
	var profile Profile
	if err := json.Unmarshal(definition, &profile); err != nil {
		return Profile{}, err
	}
	if err := profile.Validate(); err != nil {
		return Profile{}, err
	}
	return profile, nil
}

func (s *Core) assignProfileToScope(w http.ResponseWriter, r *http.Request, scope string) {
	var req profileAssignmentRequest
	if !body(w, r, &req) || req.Version < 1 {
		fail(w, 400, "profile and version required")
		return
	}
	a := actor(r)
	tx, err := s.DB.Begin()
	if err != nil {
		fail(w, 503, "assignment unavailable")
		return
	}
	defer tx.Rollback()

	target := r.PathValue("id")
	var org string
	var devicesQuery string
	switch scope {
	case "group":
		devicesQuery = `SELECT d.id FROM devices d JOIN device_group_members m ON m.device_id=d.id JOIN device_groups g ON g.id=m.group_id WHERE g.id=$1 AND NOT d.revoked AND ($2='SUPER_ADMIN' OR g.organization_id=$3) ORDER BY d.id`
		err = tx.QueryRow("SELECT organization_id FROM device_groups WHERE id=$1 AND ($2='SUPER_ADMIN' OR organization_id=$3)", target, a.Role, a.Org).Scan(&org)
	case "tag":
		devicesQuery = `SELECT d.id FROM devices d JOIN device_tags m ON m.device_id=d.id JOIN tags t ON t.id=m.tag_id WHERE t.id=$1 AND NOT d.revoked AND ($2='SUPER_ADMIN' OR t.organization_id=$3) ORDER BY d.id`
		err = tx.QueryRow("SELECT organization_id FROM tags WHERE id=$1 AND ($2='SUPER_ADMIN' OR organization_id=$3)", target, a.Role, a.Org).Scan(&org)
	default:
		err = errors.New("unsupported assignment scope")
	}
	if err != nil {
		fail(w, 404, "assignment target not found")
		return
	}
	profile, err := loadProfileForOrganization(tx, req.ID, req.Version, org, a.Role)
	if err != nil {
		fail(w, 404, "profile not found")
		return
	}
	rows, err := tx.Query(devicesQuery, target, a.Role, a.Org)
	if err != nil {
		fail(w, 503, "assignment unavailable")
		return
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var deviceID string
		if err = rows.Scan(&deviceID); err == nil {
			err = assignProfileTx(tx, deviceID, req.ID, req.Version, profile.SourceID)
		}
		if err != nil {
			fail(w, 409, err.Error())
			return
		}
		count++
	}
	if err = rows.Err(); err != nil {
		fail(w, 503, "assignment unavailable")
		return
	}
	if err = audit(tx, org, a.ID, "profile.assign."+scope, target); err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, 409, "assignment failed")
		return
	}
	output(w, 200, map[string]any{"assigned": true, "device_count": count})
}

func (s *Core) assignGroupProfile(w http.ResponseWriter, r *http.Request) {
	s.assignProfileToScope(w, r, "group")
}

func (s *Core) assignTagProfile(w http.ResponseWriter, r *http.Request) {
	s.assignProfileToScope(w, r, "tag")
}
