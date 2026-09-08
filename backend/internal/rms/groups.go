package rms

import (
	"net/http"
	"strings"
)

type groupInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Org         string `json:"organization_id"`
}

func normalizeGroup(v *groupInput) bool {
	v.Name = strings.TrimSpace(v.Name)
	v.Description = strings.TrimSpace(v.Description)
	return v.Name != "" && len(v.Name) <= 128 && len(v.Description) <= 512
}

func (s *Core) groups(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, a)
	if !ok {
		fail(w, 400, "invalid organization")
		return
	}
	s.rows(w, `SELECT row_to_json(t) FROM (SELECT g.id,g.organization_id,g.name,g.description,g.created_at,count(m.device_id)::integer AS device_count FROM device_groups g LEFT JOIN device_group_members m ON m.group_id=g.id WHERE $1='' OR g.organization_id=$1 GROUP BY g.id ORDER BY g.name) t`, org)
}

func (s *Core) createGroup(w http.ResponseWriter, r *http.Request) {
	var v groupInput
	if !body(w, r, &v) || !normalizeGroup(&v) {
		fail(w, 400, "valid group name and description required")
		return
	}
	a := actor(r)
	if a.Role != "SUPER_ADMIN" {
		v.Org = a.Org
	}
	if !validID(v.Org) {
		fail(w, 400, "organization required")
		return
	}
	id := randomID()
	tx, e := s.DB.Begin()
	if e != nil {
		fail(w, 503, "database unavailable")
		return
	}
	defer tx.Rollback()
	_, e = tx.Exec("INSERT INTO device_groups(id,organization_id,name,description) VALUES($1,$2,$3,$4)", id, v.Org, v.Name, v.Description)
	if e == nil {
		e = audit(tx, v.Org, a.ID, "group.create", id)
	}
	if e != nil || tx.Commit() != nil {
		fail(w, 409, "group already exists or could not be created")
		return
	}
	output(w, 201, map[string]string{"id": id})
}

func (s *Core) updateGroup(w http.ResponseWriter, r *http.Request) {
	var v groupInput
	if !body(w, r, &v) || !normalizeGroup(&v) {
		fail(w, 400, "valid group name and description required")
		return
	}
	a := actor(r)
	tx, e := s.DB.Begin()
	if e != nil {
		fail(w, 503, "database unavailable")
		return
	}
	defer tx.Rollback()
	var org string
	e = tx.QueryRow("UPDATE device_groups SET name=$2,description=$3 WHERE id=$1 AND ($4='SUPER_ADMIN' OR organization_id=$5) RETURNING organization_id", r.PathValue("id"), v.Name, v.Description, a.Role, a.Org).Scan(&org)
	if e == nil {
		e = audit(tx, org, a.ID, "group.update", r.PathValue("id"))
	}
	if e != nil || tx.Commit() != nil {
		fail(w, 409, "group not found or update failed")
		return
	}
	w.WriteHeader(204)
}

func (s *Core) deleteGroup(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	tx, e := s.DB.Begin()
	if e != nil {
		fail(w, 503, "database unavailable")
		return
	}
	defer tx.Rollback()
	var org string
	e = tx.QueryRow("DELETE FROM device_groups WHERE id=$1 AND ($2='SUPER_ADMIN' OR organization_id=$3) RETURNING organization_id", r.PathValue("id"), a.Role, a.Org).Scan(&org)
	if e == nil {
		e = audit(tx, org, a.ID, "group.delete", r.PathValue("id"))
	}
	if e != nil || tx.Commit() != nil {
		fail(w, 404, "group not found")
		return
	}
	w.WriteHeader(204)
}

func (s *Core) groupDevice(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	groupID, deviceID := r.PathValue("id"), r.PathValue("device")
	tx, e := s.DB.Begin()
	if e != nil {
		fail(w, 503, "database unavailable")
		return
	}
	defer tx.Rollback()
	var org string
	e = tx.QueryRow("SELECT organization_id FROM device_groups WHERE id=$1 AND ($2='SUPER_ADMIN' OR organization_id=$3) FOR UPDATE", groupID, a.Role, a.Org).Scan(&org)
	if e != nil {
		fail(w, 404, "group not found")
		return
	}
	var deviceOrg string
	e = tx.QueryRow("SELECT organization_id FROM devices WHERE id=$1 AND NOT revoked FOR SHARE", deviceID).Scan(&deviceOrg)
	if e != nil || deviceOrg != org {
		fail(w, 404, "device not found")
		return
	}
	if r.Method == http.MethodPut {
		_, e = tx.Exec("INSERT INTO device_group_members(group_id,device_id) VALUES($1,$2) ON CONFLICT DO NOTHING", groupID, deviceID)
	} else {
		_, e = tx.Exec("DELETE FROM device_group_members WHERE group_id=$1 AND device_id=$2", groupID, deviceID)
	}
	if e == nil {
		e = audit(tx, org, a.ID, map[bool]string{true: "group.device.add", false: "group.device.remove"}[r.Method == http.MethodPut], deviceID)
	}
	if e != nil || tx.Commit() != nil {
		fail(w, 409, "group membership update failed")
		return
	}
	w.WriteHeader(204)
}

func (s *Core) groupDevices(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, a)
	if !ok {
		fail(w, 400, "invalid organization")
		return
	}
	s.rows(w, `SELECT row_to_json(t) FROM (SELECT d.id,d.organization_id,d.name,d.serial_number,d.model,d.status FROM (SELECT d.*,CASE WHEN d.revoked THEN 'REVOKED' WHEN d.last_seen>now()-interval '180 seconds' THEN 'ONLINE' ELSE 'OFFLINE' END AS status FROM devices d) d JOIN device_group_members m ON m.device_id=d.id JOIN device_groups g ON g.id=m.group_id WHERE m.group_id=$1 AND ($2='' OR g.organization_id=$2) ORDER BY d.serial_number) t`, r.PathValue("id"), org)
}
