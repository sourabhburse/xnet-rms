package rms

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"math/bits"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type telemetryReportPoint struct {
	DeviceID   string               `json:"device_id"`
	DeviceName string               `json:"device_name"`
	SourceID   string               `json:"source_id"`
	Bucket     time.Time            `json:"bucket"`
	Fields     map[string]Aggregate `json:"fields"`
}

func mergeAggregate(a, b Aggregate) Aggregate {
	if a.Count == 0 {
		return b
	}
	a.Count += b.Count
	a.Last = b.Last
	a.Delta += b.Delta
	a.Resets += b.Resets
	a.DeltaSamples += b.DeltaSamples
	if len(b.StateSeconds) > 0 {
		if a.StateSeconds == nil {
			a.StateSeconds = map[string]float64{}
		}
		for state, seconds := range b.StateSeconds {
			a.StateSeconds[state] += seconds
		}
	}
	for _, value := range b.Distinct {
		found := false
		for _, existing := range a.Distinct {
			if existing == value {
				found = true
				break
			}
		}
		if !found && len(a.Distinct) < 64 {
			a.Distinct = append(a.Distinct, value)
		}
	}
	if b.Min != nil && (a.Min == nil || *b.Min < *a.Min) {
		x := *b.Min
		a.Min = &x
	}
	if b.Max != nil && (a.Max == nil || *b.Max > *a.Max) {
		x := *b.Max
		a.Max = &x
	}
	if b.Average != nil {
		a.Sum += b.Sum
		avg := a.Sum / float64(a.Count)
		a.Average = &avg
	}
	return a
}

type telemetryReportRequest struct {
	OrganizationID string   `json:"organization_id,omitempty"`
	ScopeType      string   `json:"scope_type"`
	ScopeID        string   `json:"scope_id,omitempty"`
	TemplateID     string   `json:"template_id,omitempty"`
	MetricIDs      []string `json:"metric_ids,omitempty"`
	From           string   `json:"from"`
	To             string   `json:"to"`
	Resolution     string   `json:"resolution"`
	PageSize       int      `json:"page_size,omitempty"`
	Cursor         string   `json:"cursor,omitempty"`
}

type telemetryReportResult struct {
	From       time.Time              `json:"from"`
	To         time.Time              `json:"to"`
	Resolution string                 `json:"resolution"`
	Items      []telemetryReportPoint `json:"items"`
	Alerts     map[string]any         `json:"alerts"`
	NextCursor string                 `json:"next_cursor,omitempty"`
}

func (s *Core) validateReportRequest(r *http.Request, req *telemetryReportRequest) (string, time.Time, time.Time, int, error) {
	a := actor(r)
	org := a.Org
	if a.Role == "SUPER_ADMIN" {
		org = req.OrganizationID
		if org != "" && !validID(org) {
			return "", time.Time{}, time.Time{}, 0, fmt.Errorf("invalid organization")
		}
	}
	from, err := reportTime(req.From, time.Now().UTC().AddDate(0, 0, -30))
	if err != nil {
		return "", time.Time{}, time.Time{}, 0, fmt.Errorf("from must be RFC3339")
	}
	to, err := reportTime(req.To, time.Now().UTC())
	if err != nil || from.After(to) || to.Sub(from) > 366*24*time.Hour {
		return "", time.Time{}, time.Time{}, 0, fmt.Errorf("report dates must be ordered RFC3339 values no more than 366 days apart")
	}
	if req.Resolution == "" {
		req.Resolution = "hour"
	}
	if req.Resolution != "hour" && req.Resolution != "day" {
		return "", time.Time{}, time.Time{}, 0, fmt.Errorf("resolution must be hour or day")
	}
	if req.ScopeType == "" {
		req.ScopeType = "organization"
	}
	if req.ScopeType != "organization" && req.ScopeType != "device" && req.ScopeType != "group" && req.ScopeType != "tag" {
		return "", time.Time{}, time.Time{}, 0, fmt.Errorf("scope_type must be organization, device, group or tag")
	}
	if req.ScopeType != "organization" {
		if !validID(req.ScopeID) {
			return "", time.Time{}, time.Time{}, 0, fmt.Errorf("valid scope_id required")
		}
		var exists bool
		query := "SELECT EXISTS(SELECT 1 FROM devices WHERE id=$1 AND organization_id=$2 AND NOT revoked)"
		if req.ScopeType == "group" {
			query = "SELECT EXISTS(SELECT 1 FROM device_groups WHERE id=$1 AND organization_id=$2)"
		} else if req.ScopeType == "tag" {
			query = "SELECT EXISTS(SELECT 1 FROM tags WHERE id=$1 AND organization_id=$2)"
		}
		if err = s.DB.QueryRow(query, req.ScopeID, org).Scan(&exists); err != nil || !exists {
			return "", time.Time{}, time.Time{}, 0, fmt.Errorf("report scope not found")
		}
	}
	if len(req.MetricIDs) > 64 {
		return "", time.Time{}, time.Time{}, 0, fmt.Errorf("at most 64 metrics may be selected")
	}
	for _, id := range req.MetricIDs {
		if _, ok := metricByID[id]; !ok {
			return "", time.Time{}, time.Time{}, 0, fmt.Errorf("unknown metric %q", id)
		}
	}
	if req.TemplateID != "" {
		var definition []byte
		if err = s.DB.QueryRow(`SELECT v.definition FROM monitoring_templates t JOIN monitoring_template_versions v
			ON v.template_id=t.id AND v.version=t.current_version
			WHERE t.id=$1 AND t.organization_id=$2 AND NOT t.archived`, req.TemplateID, org).Scan(&definition); err != nil {
			return "", time.Time{}, time.Time{}, 0, fmt.Errorf("template not found")
		}
		if len(req.MetricIDs) == 0 {
			var def monitoringTemplateDefinition
			if json.Unmarshal(definition, &def) != nil {
				return "", time.Time{}, time.Time{}, 0, fmt.Errorf("template definition is invalid")
			}
			for _, item := range def.Metrics {
				req.MetricIDs = append(req.MetricIDs, item.MetricID)
			}
		}
	}
	offset := 0
	if req.Cursor != "" {
		offset, err = strconv.Atoi(req.Cursor)
		if err != nil || offset < 0 || offset > 10000000 {
			return "", time.Time{}, time.Time{}, 0, fmt.Errorf("invalid cursor")
		}
	}
	if req.PageSize == 0 {
		req.PageSize = 500
	}
	if req.PageSize < 1 || req.PageSize > 2000 {
		return "", time.Time{}, time.Time{}, 0, fmt.Errorf("page_size must be 1-2000")
	}
	return org, from.UTC(), to.UTC(), offset, nil
}

func reportScopeSQL(alias string) string {
	return `($3='organization' OR ($3='device' AND ` + alias + `.id=$4)
		OR ($3='group' AND EXISTS(SELECT 1 FROM device_group_members gm WHERE gm.device_id=` + alias + `.id AND gm.group_id=$4))
		OR ($3='tag' AND EXISTS(SELECT 1 FROM device_tags dt WHERE dt.device_id=` + alias + `.id AND dt.tag_id=$4)))`
}

func selectedReportFields(metricIDs []string) map[string]map[string]bool {
	out := map[string]map[string]bool{}
	for _, id := range metricIDs {
		metric := metricByID[id]
		if out[metric.SourceID] == nil {
			out[metric.SourceID] = map[string]bool{}
		}
		out[metric.SourceID][metric.Field.ID] = true
	}
	return out
}

func (s *Core) runTelemetryReport(r *http.Request, req *telemetryReportRequest) (telemetryReportResult, error) {
	org, from, to, offset, err := s.validateReportRequest(r, req)
	if err != nil {
		return telemetryReportResult{}, err
	}
	selected := selectedReportFields(req.MetricIDs)
	query := `SELECT h.device_id,coalesce(nullif(d.name,''),d.serial_number),h.source_id,h.hour,h.fields
		FROM hourly_summaries h JOIN devices d ON d.id=h.device_id
		WHERE ($1='' OR d.organization_id=$1) AND $2::text IS NOT NULL AND NOT d.revoked AND h.hour >= $5 AND h.hour < $6 AND ` + reportScopeSQL("d") + `
		ORDER BY h.hour,h.device_id,h.source_id LIMIT $7 OFFSET $8`
	rows, err := s.DB.Query(query, org, req.TemplateID, req.ScopeType, req.ScopeID, from, to, req.PageSize+1, offset)
	if err != nil {
		return telemetryReportResult{}, err
	}
	defer rows.Close()
	points := []telemetryReportPoint{}
	index := map[string]int{}
	consumed := 0
	more := false
	for rows.Next() {
		if consumed == req.PageSize {
			more = true
			break
		}
		consumed++
		var deviceID, deviceName, sourceID string
		var hour time.Time
		var rawFields []byte
		if err = rows.Scan(&deviceID, &deviceName, &sourceID, &hour, &rawFields); err != nil {
			return telemetryReportResult{}, err
		}
		if len(selected) > 0 && selected[sourceID] == nil {
			continue
		}
		fields := map[string]Aggregate{}
		if json.Unmarshal(rawFields, &fields) != nil {
			continue
		}
		if allowed := selected[sourceID]; len(allowed) > 0 {
			for field := range fields {
				base := field
				if at := strings.LastIndex(field, ":"); at >= 0 {
					base = field[at+1:]
				}
				if !allowed[base] {
					delete(fields, field)
				}
			}
		}
		if len(fields) == 0 {
			continue
		}
		pointTime := hour.UTC().Truncate(time.Hour)
		if req.Resolution == "day" {
			pointTime = time.Date(pointTime.Year(), pointTime.Month(), pointTime.Day(), 0, 0, 0, 0, time.UTC)
		}
		key := deviceID + "\x00" + sourceID + "\x00" + pointTime.Format(time.RFC3339)
		at, exists := index[key]
		if !exists {
			at = len(points)
			index[key] = at
			points = append(points, telemetryReportPoint{DeviceID: deviceID, DeviceName: deviceName, SourceID: sourceID, Bucket: pointTime, Fields: map[string]Aggregate{}})
		}
		for field, aggregate := range fields {
			points[at].Fields[field] = mergeAggregate(points[at].Fields[field], aggregate)
		}
	}
	if err = rows.Err(); err != nil {
		return telemetryReportResult{}, err
	}

	// Presence is independent of telemetry and therefore preserves offline gaps.
	// It is emitted once; subsequent raw-summary pages contain only telemetry.
	if offset == 0 && (len(selected) == 0 || selected["availability"] != nil) {
		presenceQuery := `SELECT p.device_id,coalesce(nullif(d.name,''),d.serial_number),p.hour,p.seen_minutes,p.offline_events,p.reboots
		FROM presence_hours p JOIN devices d ON d.id=p.device_id
		WHERE ($1='' OR d.organization_id=$1) AND $2::text IS NOT NULL AND NOT d.revoked AND p.hour >= $5 AND p.hour < $6 AND ` + reportScopeSQL("d") + ` ORDER BY p.hour,p.device_id`
		prows, err := s.DB.Query(presenceQuery, org, req.TemplateID, req.ScopeType, req.ScopeID, from, to)
		if err != nil {
			return telemetryReportResult{}, err
		}
		for prows.Next() {
			var deviceID, deviceName string
			var hour time.Time
			var mask int64
			var offline, reboots int
			if err = prows.Scan(&deviceID, &deviceName, &hour, &mask, &offline, &reboots); err != nil {
				prows.Close()
				return telemetryReportResult{}, err
			}
			pointTime := hour.UTC().Truncate(time.Hour)
			if req.Resolution == "day" {
				pointTime = time.Date(pointTime.Year(), pointTime.Month(), pointTime.Day(), 0, 0, 0, 0, time.UTC)
			}
			key := deviceID + "\x00availability\x00" + pointTime.Format(time.RFC3339)
			at, exists := index[key]
			if !exists {
				at = len(points)
				index[key] = at
				points = append(points, telemetryReportPoint{DeviceID: deviceID, DeviceName: deviceName, SourceID: "availability", Bucket: pointTime, Fields: map[string]Aggregate{}})
			}
			allowed := selected["availability"]
			include := func(field string) bool { return len(selected) == 0 || allowed[field] }
			seen := bits.OnesCount64(uint64(mask))
			coverage := float64(seen) * 100 / 60
			if include("heartbeat_coverage_percent") {
				points[at].Fields["heartbeat_coverage_percent"] = mergeAggregate(points[at].Fields["heartbeat_coverage_percent"], Aggregate{Kind: "gauge", Label: "Heartbeat coverage", Unit: "%", Count: 1, Sum: coverage, Min: &coverage, Max: &coverage, Average: &coverage, Last: coverage})
			}
			if offline > 0 && include("offline_periods") {
				points[at].Fields["offline_periods"] = mergeAggregate(points[at].Fields["offline_periods"], Aggregate{Kind: "counter", Label: "Offline periods", Count: 1, Delta: float64(offline), DeltaSamples: 1, Last: offline})
			}
			if reboots > 0 && include("reboots") {
				points[at].Fields["reboots"] = mergeAggregate(points[at].Fields["reboots"], Aggregate{Kind: "counter", Label: "Reboots", Count: 1, Delta: float64(reboots), DeltaSamples: 1, Last: reboots})
			}
		}
		if err = prows.Close(); err != nil {
			return telemetryReportResult{}, err
		}
	}

	alerts := map[string]any{"count": 0, "warning_count": 0, "critical_count": 0, "warning_seconds": 0.0, "critical_seconds": 0.0, "first_breach": nil, "last_breach": nil, "current_state": "healthy"}
	var count, warningCount, criticalCount int
	var warningSeconds, criticalSeconds float64
	var first, last *time.Time
	var current string
	alertQuery := `SELECT count(*),count(*) FILTER(WHERE a.severity='warning'),count(*) FILTER(WHERE a.severity='critical'),
		min(coalesce(a.opened_at,a.created_at)),max(coalesce(a.opened_at,a.created_at)),
		CASE WHEN count(*) FILTER(WHERE a.status<>'RESOLVED' AND a.severity='critical')>0 THEN 'critical'
		     WHEN count(*) FILTER(WHERE a.status<>'RESOLVED')>0 THEN 'warning' ELSE 'healthy' END
		FROM alerts a JOIN devices d ON d.id=a.device_id WHERE ($1='' OR a.organization_id=$1) AND ($2='' OR a.template_id=$2)
		AND ` + reportScopeSQL("d") + ` AND coalesce(a.opened_at,a.created_at)<$6 AND coalesce(a.resolved_at,$6)>$5`
	if err = s.DB.QueryRow(alertQuery, org, req.TemplateID, req.ScopeType, req.ScopeID, from, to).Scan(&count, &warningCount, &criticalCount, &first, &last, &current); err != nil {
		return telemetryReportResult{}, err
	}
	durationQuery := `WITH timeline AS (
		SELECT e.event,e.severity,e.occurred_at,lead(e.occurred_at) OVER(PARTITION BY e.alert_id ORDER BY e.occurred_at,e.id) AS next_at
		FROM alert_events e JOIN alerts a ON a.id=e.alert_id JOIN devices d ON d.id=a.device_id
		WHERE ($1='' OR a.organization_id=$1) AND ($2='' OR a.template_id=$2) AND ` + reportScopeSQL("d") + `
	) SELECT
		coalesce(sum(EXTRACT(epoch FROM (least(coalesce(next_at,$6),$6)-greatest(occurred_at,$5)))) FILTER(WHERE severity='warning' AND event IN ('opened','acknowledged','escalated') AND occurred_at<$6 AND coalesce(next_at,$6)>$5),0),
		coalesce(sum(EXTRACT(epoch FROM (least(coalesce(next_at,$6),$6)-greatest(occurred_at,$5)))) FILTER(WHERE severity='critical' AND event IN ('opened','acknowledged','escalated') AND occurred_at<$6 AND coalesce(next_at,$6)>$5),0)
		FROM timeline`
	if err = s.DB.QueryRow(durationQuery, org, req.TemplateID, req.ScopeType, req.ScopeID, from, to).Scan(&warningSeconds, &criticalSeconds); err != nil {
		return telemetryReportResult{}, err
	}
	alerts = map[string]any{"count": count, "warning_count": warningCount, "critical_count": criticalCount, "warning_seconds": warningSeconds, "critical_seconds": criticalSeconds, "first_breach": first, "last_breach": last, "current_state": current}
	result := telemetryReportResult{From: from, To: to, Resolution: req.Resolution, Items: points, Alerts: alerts}
	if more {
		result.NextCursor = strconv.Itoa(offset + consumed)
	}
	return result, nil
}

func (s *Core) telemetryReportQuery(w http.ResponseWriter, r *http.Request) {
	var req telemetryReportRequest
	if !body(w, r, &req) {
		return
	}
	result, err := s.runTelemetryReport(r, &req)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	output(w, 200, result)
}

func csvValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	data, _ := json.Marshal(value)
	return string(data)
}

func (s *Core) telemetryReportCSV(w http.ResponseWriter, r *http.Request) {
	var req telemetryReportRequest
	if !body(w, r, &req) {
		return
	}
	// CSV is streamed in bounded pages so exports do not inherit a silent row cap.
	req.PageSize = 2000
	req.Cursor = ""
	result, err := s.runTelemetryReport(r, &req)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="telemetry-report.csv"`)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"device_id", "device_name", "source_id", "bucket", "metric", "kind", "count", "minimum", "average", "maximum", "last", "delta", "reset_count", "state_seconds", "distinct_values"})
	for {
		for _, point := range result.Items {
			for metric, aggregate := range point.Fields {
				minimum, average, maximum := "", "", ""
				if aggregate.Min != nil {
					minimum = strconv.FormatFloat(*aggregate.Min, 'f', -1, 64)
				}
				if aggregate.Average != nil {
					average = strconv.FormatFloat(*aggregate.Average, 'f', -1, 64)
				}
				if aggregate.Max != nil {
					maximum = strconv.FormatFloat(*aggregate.Max, 'f', -1, 64)
				}
				_ = writer.Write([]string{point.DeviceID, point.DeviceName, point.SourceID, point.Bucket.Format(time.RFC3339), metric, aggregate.Kind, strconv.Itoa(aggregate.Count), minimum, average, maximum, csvValue(aggregate.Last), strconv.FormatFloat(aggregate.Delta, 'f', -1, 64), strconv.Itoa(aggregate.Resets), csvValue(aggregate.StateSeconds), csvValue(aggregate.Distinct)})
			}
		}
		writer.Flush()
		if writer.Error() != nil || result.NextCursor == "" {
			return
		}
		req.Cursor = result.NextCursor
		result, err = s.runTelemetryReport(r, &req)
		if err != nil {
			return
		}
	}
}

func reportTime(value string, fallback time.Time) (time.Time, error) {
	if strings.TrimSpace(value) == "" {
		return fallback, nil
	}
	return time.Parse(time.RFC3339, value)
}

func (s *Core) telemetryReport(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	from, err := reportTime(r.URL.Query().Get("from"), time.Now().UTC().AddDate(0, 0, -30))
	if err != nil {
		fail(w, 400, "from must be RFC3339")
		return
	}
	to, err := reportTime(r.URL.Query().Get("to"), time.Now().UTC())
	if err != nil || from.After(to) {
		fail(w, 400, "to must be RFC3339 and after from")
		return
	}
	if to.Sub(from) > 366*24*time.Hour {
		fail(w, 400, "report range cannot exceed 366 days")
		return
	}
	bucket := r.URL.Query().Get("bucket")
	if bucket == "" {
		bucket = "hour"
	}
	if bucket != "hour" && bucket != "day" {
		fail(w, 400, "bucket must be hour or day")
		return
	}
	source := r.URL.Query().Get("source")
	if source != "" && !safeName(source) {
		fail(w, 400, "invalid source")
		return
	}
	deviceID, groupID, tagID := r.URL.Query().Get("device_id"), r.URL.Query().Get("group_id"), r.URL.Query().Get("tag_id")
	if deviceID != "" && (groupID != "" || tagID != "") {
		fail(w, 400, "choose one report scope")
		return
	}
	if deviceID != "" && !s.scopedDevice(r, deviceID) {
		fail(w, 404, "device not found")
		return
	}
	org := a.Org
	if a.Role == "SUPER_ADMIN" {
		org = r.URL.Query().Get("organization_id")
	}
	query := `SELECT h.device_id,coalesce(d.name,d.serial_number),h.source_id,h.hour,h.fields
	FROM hourly_summaries h JOIN devices d ON d.id=h.device_id
	WHERE ($1='' OR d.organization_id=$1) AND NOT d.revoked
	AND ($2='' OR h.device_id=$2)
	AND ($3='' OR EXISTS(SELECT 1 FROM device_group_members gm JOIN device_groups g ON g.id=gm.group_id WHERE gm.device_id=h.device_id AND g.id=$3))
	AND ($4='' OR EXISTS(SELECT 1 FROM device_tags dt WHERE dt.device_id=h.device_id AND dt.tag_id=$4))
	AND ($5='' OR h.source_id=$5) AND h.hour >= $6 AND h.hour <= $7
	ORDER BY h.hour,h.device_id,h.source_id LIMIT 10000`
	rows, err := s.DB.Query(query, org, deviceID, groupID, tagID, source, from, to)
	if err != nil {
		fail(w, 503, "report unavailable")
		return
	}
	defer rows.Close()
	points := []telemetryReportPoint{}
	index := map[string]int{}
	for rows.Next() {
		var deviceID, deviceName, sourceID string
		var hour time.Time
		var rawFields []byte
		if err = rows.Scan(&deviceID, &deviceName, &sourceID, &hour, &rawFields); err != nil {
			fail(w, 503, "report unavailable")
			return
		}
		fields := map[string]Aggregate{}
		if json.Unmarshal(rawFields, &fields) != nil {
			continue
		}
		pointTime := hour.UTC().Truncate(time.Hour)
		if bucket == "day" {
			pointTime = time.Date(pointTime.Year(), pointTime.Month(), pointTime.Day(), 0, 0, 0, 0, time.UTC)
		}
		key := deviceID + "\x00" + sourceID + "\x00" + pointTime.Format(time.RFC3339)
		at, exists := index[key]
		if !exists {
			at = len(points)
			index[key] = at
			points = append(points, telemetryReportPoint{DeviceID: deviceID, DeviceName: deviceName, SourceID: sourceID, Bucket: pointTime, Fields: map[string]Aggregate{}})
		}
		for field, aggregate := range fields {
			points[at].Fields[field] = mergeAggregate(points[at].Fields[field], aggregate)
		}
	}
	if err = rows.Err(); err != nil {
		fail(w, 503, "report unavailable")
		return
	}
	output(w, 200, map[string]any{"from": from, "to": to, "bucket": bucket, "items": points})
}
