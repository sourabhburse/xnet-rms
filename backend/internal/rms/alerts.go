package rms

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

func conditionMatches(condition *thresholdCondition, value float64) bool {
	if condition == nil {
		return false
	}
	switch condition.Operator {
	case "gt":
		return value > *condition.Value
	case "gte":
		return value >= *condition.Value
	case "lt":
		return value < *condition.Value
	case "lte":
		return value <= *condition.Value
	case "outside":
		return value < *condition.Minimum || value > *condition.Maximum
	default:
		return false
	}
}

func thresholdSeverity(rule *metricThreshold, value Selected) string {
	if rule == nil {
		return "healthy"
	}
	if value.Kind == "gauge" {
		number, ok := value.Value.(float64)
		if !ok {
			return "healthy"
		}
		if conditionMatches(rule.Critical, number) {
			return "critical"
		}
		if conditionMatches(rule.Warning, number) {
			return "warning"
		}
		return "healthy"
	}
	if value.Kind == "state" {
		key := strings.ToLower(strings.TrimSpace(fmt.Sprint(value.Value)))
		if severity := rule.States[key]; severity != "" {
			return severity
		}
	}
	return "healthy"
}

func alertEventTx(tx *sql.Tx, alertID, event, severity string, value []byte, actorID string, now time.Time) error {
	_, err := tx.Exec("INSERT INTO alert_events(alert_id,event,severity,value,actor_id,occurred_at) VALUES($1,$2,$3,$4,NULLIF($5,''),$6)", alertID, event, severity, value, actorID, now)
	return err
}

func resolveAlertTx(tx *sql.Tx, alertID, severity, reason string, value []byte, now time.Time) error {
	if _, err := tx.Exec("UPDATE alerts SET status='RESOLVED',resolved_at=$2,resolution_reason=$3,last_value=$4,updated_at=$2 WHERE id=$1 AND status<>'RESOLVED'", alertID, now, reason, value); err != nil {
		return err
	}
	return alertEventTx(tx, alertID, "resolved", severity, value, "", now)
}

func applyAlertEvaluationTx(tx *sql.Tx, org, deviceID, templateID string, version int, metricID, entity, severity string, value any, now time.Time) error {
	valueJSON := []byte(raw(value))
	_, err := tx.Exec(`INSERT INTO alert_states(organization_id,device_id,template_id,template_version,metric_id,entity_key,last_value,last_evaluated_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, org, deviceID, templateID, version, metricID, entity, valueJSON, now)
	if err != nil {
		return err
	}
	var candidate, currentID string
	var candidateCount, healthyCount int
	err = tx.QueryRow(`SELECT candidate_severity,candidate_count,healthy_count,coalesce(current_alert_id,'')
		FROM alert_states WHERE device_id=$1 AND template_id=$2 AND template_version=$3 AND metric_id=$4 AND entity_key=$5 FOR UPDATE`, deviceID, templateID, version, metricID, entity).Scan(&candidate, &candidateCount, &healthyCount, &currentID)
	if err != nil {
		return err
	}
	if severity == "healthy" {
		healthyCount++
		if currentID != "" && healthyCount >= 2 {
			var currentSeverity string
			if err = tx.QueryRow("SELECT severity FROM alerts WHERE id=$1 AND status<>'RESOLVED'", currentID).Scan(&currentSeverity); err == nil {
				if err = resolveAlertTx(tx, currentID, currentSeverity, "recovered", valueJSON, now); err != nil {
					return err
				}
			} else if err != sql.ErrNoRows {
				return err
			}
			currentID = ""
		}
		_, err = tx.Exec(`UPDATE alert_states SET candidate_severity='healthy',candidate_count=0,healthy_count=$6,
			current_alert_id=NULLIF($7,''),last_value=$8,last_evaluated_at=$9
			WHERE device_id=$1 AND template_id=$2 AND template_version=$3 AND metric_id=$4 AND entity_key=$5`, deviceID, templateID, version, metricID, entity, healthyCount, currentID, valueJSON, now)
		return err
	}
	healthyCount = 0
	if candidate == severity {
		candidateCount++
	} else {
		candidate, candidateCount = severity, 1
	}
	if currentID == "" {
		currentID = randomID()
		_, err = tx.Exec(`INSERT INTO alerts(id,organization_id,device_id,template_id,template_version,metric_id,entity_key,severity,status,last_value,created_at,updated_at)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,$10,$10)`, currentID, org, deviceID, templateID, version, metricID, entity, severity, valueJSON, now)
		if err != nil {
			return err
		}
		if err = alertEventTx(tx, currentID, "pending", severity, valueJSON, "", now); err != nil {
			return err
		}
	}
	var currentSeverity, status string
	if err = tx.QueryRow("SELECT severity,status FROM alerts WHERE id=$1 FOR UPDATE", currentID).Scan(&currentSeverity, &status); err != nil {
		return err
	}
	if status == "PENDING" && candidateCount >= 2 {
		_, err = tx.Exec("UPDATE alerts SET status='OPEN',severity=$2,opened_at=$3,last_value=$4,updated_at=$3 WHERE id=$1", currentID, severity, now, valueJSON)
		if err == nil {
			err = alertEventTx(tx, currentID, "opened", severity, valueJSON, "", now)
		}
	} else if status != "PENDING" && currentSeverity == "warning" && severity == "critical" && candidateCount >= 2 {
		_, err = tx.Exec("UPDATE alerts SET status='OPEN',severity='critical',acknowledged_at=NULL,acknowledged_by=NULL,last_value=$2,updated_at=$3 WHERE id=$1", currentID, valueJSON, now)
		if err == nil {
			err = alertEventTx(tx, currentID, "escalated", "critical", valueJSON, "", now)
		}
	} else {
		_, err = tx.Exec("UPDATE alerts SET last_value=$2,updated_at=$3 WHERE id=$1", currentID, valueJSON, now)
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE alert_states SET candidate_severity=$6,candidate_count=$7,healthy_count=0,
		current_alert_id=$8,last_value=$9,last_evaluated_at=$10
		WHERE device_id=$1 AND template_id=$2 AND template_version=$3 AND metric_id=$4 AND entity_key=$5`, deviceID, templateID, version, metricID, entity, candidate, candidateCount, currentID, valueJSON, now)
	return err
}

type effectiveTemplate struct {
	OrganizationID string
	TemplateID     string
	Version        int
	Definition     monitoringTemplateDefinition
}

func effectiveTemplatesTx(tx *sql.Tx, deviceID string) ([]effectiveTemplate, error) {
	rows, err := tx.Query(`SELECT b.organization_id,b.template_id,b.template_version,v.definition,
		min(coalesce(b.interval_seconds,(v.definition->>'interval_seconds')::integer))
		FROM monitoring_bindings b JOIN monitoring_template_versions v
		ON v.template_id=b.template_id AND v.version=b.template_version
		WHERE b.enabled AND ((b.target_type='device' AND b.target_id=$1)
		 OR (b.target_type='group' AND EXISTS(SELECT 1 FROM device_group_members gm WHERE gm.device_id=$1 AND gm.group_id=b.target_id))
		 OR (b.target_type='tag' AND EXISTS(SELECT 1 FROM device_tags dt WHERE dt.device_id=$1 AND dt.tag_id=b.target_id)))
		GROUP BY b.organization_id,b.template_id,b.template_version,v.definition`, deviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []effectiveTemplate{}
	for rows.Next() {
		var item effectiveTemplate
		var definition []byte
		var interval int
		if err = rows.Scan(&item.OrganizationID, &item.TemplateID, &item.Version, &definition, &interval); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(definition, &item.Definition); err != nil {
			return nil, err
		}
		item.Definition.IntervalSeconds = interval
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Core) evaluateThresholdsTx(tx *sql.Tx, snapshot Snapshot, fields map[string]Selected) error {
	templates, err := effectiveTemplatesTx(tx, snapshot.DeviceID)
	if err != nil {
		return err
	}
	for _, template := range templates {
		for _, selected := range template.Definition.Metrics {
			catalog, ok := metricByID[selected.MetricID]
			if !ok || catalog.SourceID != snapshot.SourceID || selected.Threshold == nil {
				continue
			}
			for key, value := range fields {
				entity := ""
				if key != catalog.Field.ID {
					suffix := ":" + catalog.Field.ID
					if !strings.HasSuffix(key, suffix) {
						continue
					}
					entity = strings.TrimSuffix(key, suffix)
				}
				severity := thresholdSeverity(selected.Threshold, value)
				if err = applyAlertEvaluationTx(tx, template.OrganizationID, snapshot.DeviceID, template.TemplateID, template.Version, selected.MetricID, entity, severity, value.Value, snapshot.ObservedAt); err != nil {
					return err
				}
			}
		}
		if template.Definition.Stale.Enabled && snapshot.Status == "ok" {
			if err = applyAlertEvaluationTx(tx, template.OrganizationID, snapshot.DeviceID, template.TemplateID, template.Version, "stale:"+snapshot.SourceID, "", "healthy", snapshot.ObservedAt, snapshot.ObservedAt); err != nil {
				return err
			}
		}
	}
	return nil
}

func resolveTemplateAlertsTx(tx *sql.Tx, templateID, reason string, now time.Time) error {
	rows, err := tx.Query("SELECT id,severity,coalesce(last_value,'null'::jsonb) FROM alerts WHERE template_id=$1 AND status<>'RESOLVED' FOR UPDATE", templateID)
	if err != nil {
		return err
	}
	type active struct {
		id, severity string
		value        []byte
	}
	items := []active{}
	for rows.Next() {
		var item active
		if err = rows.Scan(&item.id, &item.severity, &item.value); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	rows.Close()
	for _, item := range items {
		if err = resolveAlertTx(tx, item.id, item.severity, reason, item.value, now); err != nil {
			return err
		}
	}
	_, err = tx.Exec("UPDATE alert_states SET current_alert_id=NULL,candidate_severity='healthy',candidate_count=0,healthy_count=0 WHERE template_id=$1", templateID)
	return err
}

func resolveOrphanedDeviceAlertsTx(tx *sql.Tx, deviceID, reason string, now time.Time) error {
	rows, err := tx.Query(`SELECT a.id,a.severity,coalesce(a.last_value,'null'::jsonb)
		FROM alerts a WHERE a.device_id=$1 AND a.status<>'RESOLVED' AND NOT EXISTS (
			SELECT 1 FROM monitoring_bindings b WHERE b.enabled AND b.template_id=a.template_id AND b.template_version=a.template_version AND (
				(b.target_type='device' AND b.target_id=$1) OR
				(b.target_type='group' AND EXISTS(SELECT 1 FROM device_group_members gm WHERE gm.device_id=$1 AND gm.group_id=b.target_id)) OR
				(b.target_type='tag' AND EXISTS(SELECT 1 FROM device_tags dt WHERE dt.device_id=$1 AND dt.tag_id=b.target_id))
			)) FOR UPDATE`, deviceID)
	if err != nil {
		return err
	}
	type active struct {
		id, severity string
		value        []byte
	}
	items := []active{}
	for rows.Next() {
		var item active
		if err = rows.Scan(&item.id, &item.severity, &item.value); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	rows.Close()
	for _, item := range items {
		if err = resolveAlertTx(tx, item.id, item.severity, reason, item.value, now); err != nil {
			return err
		}
	}
	_, err = tx.Exec(`UPDATE alert_states s SET current_alert_id=NULL,candidate_severity='healthy',candidate_count=0,healthy_count=0
		WHERE s.device_id=$1 AND NOT EXISTS (
			SELECT 1 FROM monitoring_bindings b WHERE b.enabled AND b.template_id=s.template_id AND b.template_version=s.template_version AND (
				(b.target_type='device' AND b.target_id=$1) OR
				(b.target_type='group' AND EXISTS(SELECT 1 FROM device_group_members gm WHERE gm.device_id=$1 AND gm.group_id=b.target_id)) OR
				(b.target_type='tag' AND EXISTS(SELECT 1 FROM device_tags dt WHERE dt.device_id=$1 AND dt.tag_id=b.target_id))))`, deviceID)
	return err
}

func resolveDeviceAlertsTx(tx *sql.Tx, deviceID, reason string, now time.Time) error {
	rows, err := tx.Query("SELECT id,severity,coalesce(last_value,'null'::jsonb) FROM alerts WHERE device_id=$1 AND status<>'RESOLVED' FOR UPDATE", deviceID)
	if err != nil {
		return err
	}
	type active struct {
		id, severity string
		value        []byte
	}
	items := []active{}
	for rows.Next() {
		var item active
		if err = rows.Scan(&item.id, &item.severity, &item.value); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	rows.Close()
	for _, item := range items {
		if err = resolveAlertTx(tx, item.id, item.severity, reason, item.value, now); err != nil {
			return err
		}
	}
	_, err = tx.Exec("UPDATE alert_states SET current_alert_id=NULL,candidate_severity='healthy',candidate_count=0,healthy_count=0 WHERE device_id=$1", deviceID)
	return err
}

func (s *Core) evaluateStaleAlerts(now time.Time) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.Query(`SELECT d.id,b.organization_id,b.template_id,b.template_version,v.definition,
		min(coalesce(b.interval_seconds,(v.definition->>'interval_seconds')::integer))
		FROM devices d JOIN monitoring_bindings b ON b.organization_id=d.organization_id
		JOIN monitoring_template_versions v ON v.template_id=b.template_id AND v.version=b.template_version
		WHERE NOT d.revoked AND b.enabled AND ((b.target_type='device' AND b.target_id=d.id)
		 OR (b.target_type='group' AND EXISTS(SELECT 1 FROM device_group_members gm WHERE gm.device_id=d.id AND gm.group_id=b.target_id))
		 OR (b.target_type='tag' AND EXISTS(SELECT 1 FROM device_tags dt WHERE dt.device_id=d.id AND dt.tag_id=b.target_id)))
		GROUP BY d.id,b.organization_id,b.template_id,b.template_version,v.definition`)
	if err != nil {
		return err
	}
	type row struct {
		device, org, template string
		version               int
		interval              int
		definition            []byte
	}
	items := []row{}
	for rows.Next() {
		var item row
		if err = rows.Scan(&item.device, &item.org, &item.template, &item.version, &item.definition, &item.interval); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	rows.Close()
	for _, item := range items {
		var def monitoringTemplateDefinition
		if json.Unmarshal(item.definition, &def) != nil || !def.Stale.Enabled {
			continue
		}
		def.IntervalSeconds = item.interval
		sources := map[string]bool{}
		for _, selected := range def.Metrics {
			if catalog, ok := metricByID[selected.MetricID]; ok {
				sources[catalog.SourceID] = true
			}
		}
		for source := range sources {
			var assigned bool
			if err = tx.QueryRow("SELECT EXISTS(SELECT 1 FROM monitoring_effective_assignments WHERE device_id=$1 AND source_id=$2)", item.device, source).Scan(&assigned); err != nil {
				return err
			}
			if !assigned {
				continue
			}
			var observed time.Time
			err = tx.QueryRow("SELECT observed_at FROM current_snapshots WHERE device_id=$1 AND source_id=$2", item.device, source).Scan(&observed)
			stale := err == sql.ErrNoRows || now.Sub(observed) > time.Duration(def.IntervalSeconds*def.Stale.MissedIntervals)*time.Second
			if err != nil && err != sql.ErrNoRows {
				return err
			}
			severity := "healthy"
			if stale {
				severity = def.Stale.Severity
			}
			if err = applyAlertEvaluationTx(tx, item.org, item.device, item.template, item.version, "stale:"+source, "", severity, map[string]any{"source_id": source, "last_observed_at": observed}, now); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func (s *Core) alerts(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, a)
	if !ok {
		fail(w, 400, "invalid organization")
		return
	}
	status, severity := r.URL.Query().Get("status"), r.URL.Query().Get("severity")
	deviceID := r.URL.Query().Get("device_id")
	if status != "" && status != "PENDING" && status != "OPEN" && status != "ACKNOWLEDGED" && status != "RESOLVED" {
		fail(w, 400, "invalid alert status")
		return
	}
	if severity != "" && severity != "warning" && severity != "critical" {
		fail(w, 400, "invalid alert severity")
		return
	}
	items, err := jsonRows(s.DB, `SELECT row_to_json(x) FROM (
		SELECT a.*,coalesce(d.name,d.serial_number) AS device_name,t.name AS template_name
		FROM alerts a JOIN devices d ON d.id=a.device_id JOIN monitoring_templates t ON t.id=a.template_id
		WHERE ($1='' OR a.organization_id=$1) AND ($2='' OR a.status=$2) AND ($3='' OR a.severity=$3) AND ($4='' OR a.device_id=$4)
		ORDER BY CASE a.status WHEN 'OPEN' THEN 0 WHEN 'PENDING' THEN 1 WHEN 'ACKNOWLEDGED' THEN 2 ELSE 3 END,a.updated_at DESC LIMIT 1000
	) x`, org, status, severity, deviceID)
	if err != nil {
		fail(w, 503, "alerts unavailable")
		return
	}
	var unread int
	if err = s.DB.QueryRow("SELECT count(*) FROM alerts WHERE ($1='' OR organization_id=$1) AND status IN ('PENDING','OPEN')", org).Scan(&unread); err != nil {
		fail(w, 503, "alerts unavailable")
		return
	}
	output(w, 200, map[string]any{"items": items, "unacknowledged": unread})
}

func (s *Core) acknowledgeAlert(w http.ResponseWriter, r *http.Request) {
	a, id := actor(r), r.PathValue("id")
	tx, err := s.DB.Begin()
	if err != nil {
		fail(w, 503, "alert update unavailable")
		return
	}
	defer tx.Rollback()
	var org, severity string
	var value []byte
	err = tx.QueryRow(`UPDATE alerts SET status='ACKNOWLEDGED',acknowledged_at=now(),acknowledged_by=$2,updated_at=now()
		WHERE id=$1 AND status='OPEN' AND ($3='SUPER_ADMIN' OR organization_id=$4)
		RETURNING organization_id,severity,coalesce(last_value,'null'::jsonb)`, id, a.ID, a.Role, a.Org).Scan(&org, &severity, &value)
	if err == sql.ErrNoRows {
		fail(w, 409, "only open alerts can be acknowledged")
		return
	}
	if err == nil {
		err = alertEventTx(tx, id, "acknowledged", severity, value, a.ID, time.Now().UTC())
	}
	if err == nil {
		err = audit(tx, org, a.ID, "alert.acknowledge", id)
	}
	if err != nil || tx.Commit() != nil {
		fail(w, 503, "alert update unavailable")
		return
	}
	output(w, 200, map[string]bool{"acknowledged": true})
}

func (s *Core) alertDetail(w http.ResponseWriter, r *http.Request) {
	a, id := actor(r), r.PathValue("id")
	var alert json.RawMessage
	err := s.DB.QueryRow(`SELECT row_to_json(x) FROM (
		SELECT a.*,coalesce(nullif(d.name,''),d.serial_number) AS device_name,t.name AS template_name
		FROM alerts a JOIN devices d ON d.id=a.device_id JOIN monitoring_templates t ON t.id=a.template_id
		WHERE a.id=$1 AND ($2='SUPER_ADMIN' OR a.organization_id=$3)) x`, id, a.Role, a.Org).Scan(&alert)
	if err == sql.ErrNoRows {
		fail(w, 404, "alert not found")
		return
	}
	if err != nil {
		fail(w, 503, "alert unavailable")
		return
	}
	events, err := jsonRows(s.DB, `SELECT row_to_json(x) FROM (
		SELECT e.id,e.event,e.severity,e.value,e.actor_id,e.occurred_at FROM alert_events e
		JOIN alerts a ON a.id=e.alert_id WHERE e.alert_id=$1 AND ($2='SUPER_ADMIN' OR a.organization_id=$3)
		ORDER BY e.occurred_at,e.id) x`, id, a.Role, a.Org)
	if err != nil {
		fail(w, 503, "alert history unavailable")
		return
	}
	output(w, 200, map[string]any{"alert": alert, "events": events})
}
