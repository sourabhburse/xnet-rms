package rms

import (
	"encoding/json"
	"net/http"
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
