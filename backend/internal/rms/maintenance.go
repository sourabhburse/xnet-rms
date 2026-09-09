package rms

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"
)

type Aggregate struct {
	Kind         string   `json:"kind"`
	Label        string   `json:"label"`
	Unit         string   `json:"unit,omitempty"`
	Count        int      `json:"count"`
	Sum          float64  `json:"sum,omitempty"`
	Min          *float64 `json:"min,omitempty"`
	Max          *float64 `json:"max,omitempty"`
	Average      *float64 `json:"average,omitempty"`
	Delta        float64  `json:"delta,omitempty"`
	Resets       int      `json:"resets,omitempty"`
	DeltaSamples int      `json:"delta_samples,omitempty"`
	Last         any      `json:"last"`
}

func Accumulate(a Aggregate, v Selected, previous *Selected) Aggregate {
	a.Kind = v.Kind
	a.Label = v.Label
	a.Unit = v.Unit
	a.Count++
	a.Last = v.Value
	if n, ok := v.Value.(float64); ok {
		if v.Kind == "gauge" {
			a.Sum += n
			if a.Min == nil || n < *a.Min {
				x := n
				a.Min = &x
			}
			if a.Max == nil || n > *a.Max {
				x := n
				a.Max = &x
			}
			avg := a.Sum / float64(a.Count)
			a.Average = &avg
		} else if v.Kind == "counter" && previous != nil && previous.Kind == "counter" {
			if p, ok := previous.Value.(float64); ok {
				a.DeltaSamples++
				if n >= p {
					a.Delta += n - p
				} else {
					a.Resets++
					a.Delta += n
				}
			}
		}
	}
	return a
}
func markDirty(tx *sql.Tx, x Snapshot) error {
	_, e := tx.Exec(`INSERT INTO dirty_hours VALUES($1,$2,date_trunc('hour',$3::timestamptz)) ON CONFLICT DO NOTHING`, x.DeviceID, x.SourceID, x.ObservedAt)
	if e != nil {
		return e
	}
	_, e = tx.Exec(`INSERT INTO dirty_hours SELECT $1,$2,date_trunc('hour',min(observed_at)) FROM snapshot_history WHERE device_id=$1 AND source_id=$2 AND observed_at>$3 HAVING min(observed_at) IS NOT NULL ON CONFLICT DO NOTHING`, x.DeviceID, x.SourceID, x.ObservedAt)
	return e
}
func rollupOne(d *sql.DB) (bool, error) {
	tx, e := d.Begin()
	if e != nil {
		return false, e
	}
	defer tx.Rollback()
	var device, source string
	var hour time.Time
	e = tx.QueryRow("SELECT device_id,source_id,hour FROM dirty_hours ORDER BY hour FOR UPDATE SKIP LOCKED LIMIT 1").Scan(&device, &source, &hour)
	if e == sql.ErrNoRows {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	previous := map[string]Selected{}
	var b []byte
	e = tx.QueryRow("SELECT fields FROM snapshot_history WHERE device_id=$1 AND source_id=$2 AND observed_at<$3 AND status='ok' ORDER BY observed_at DESC LIMIT 1", device, source, hour).Scan(&b)
	if e == nil {
		json.Unmarshal(b, &previous)
	} else if e != sql.ErrNoRows {
		return false, e
	}
	rows, e := tx.Query("SELECT fields FROM snapshot_history WHERE device_id=$1 AND source_id=$2 AND observed_at>=$3 AND observed_at<$4 AND status='ok' ORDER BY observed_at,received_at", device, source, hour, hour.Add(time.Hour))
	if e != nil {
		return false, e
	}
	out := map[string]Aggregate{}
	for rows.Next() {
		if e = rows.Scan(&b); e != nil {
			rows.Close()
			return false, e
		}
		values := map[string]Selected{}
		if e = json.Unmarshal(b, &values); e != nil {
			rows.Close()
			return false, e
		}
		for key, v := range values {
			var prev *Selected
			if p, ok := previous[key]; ok {
				prev = &p
			}
			out[key] = Accumulate(out[key], v, prev)
		}
		previous = values
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return false, e
	}
	_, e = tx.Exec("INSERT INTO hourly_summaries VALUES($1,$2,$3,$4) ON CONFLICT(device_id,source_id,hour) DO UPDATE SET fields=EXCLUDED.fields", device, source, hour, string(raw(out)))
	if e == nil {
		_, e = tx.Exec("DELETE FROM dirty_hours WHERE device_id=$1 AND source_id=$2 AND hour=$3", device, source, hour)
	}
	if e != nil {
		return false, e
	}
	return true, tx.Commit()
}
func (s *Core) Maintain(ctx context.Context) {
	tick := time.NewTicker(10 * time.Second)
	defer tick.Stop()
	last := time.Time{}
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-tick.C:
			for i := 0; i < 128; i++ {
				ok, e := rollupOne(s.DB)
				if e != nil {
					log.Printf("rollup: %v", e)
					break
				}
				if !ok {
					break
				}
			}
			s.DB.Exec("DELETE FROM recovery_challenges WHERE expires_at<now()")
			if e := s.expireSessions(); e != nil {
				log.Printf("session expiry: %v", e)
			}
			if now.Sub(last) >= time.Hour {
				if e := Partitions(s.DB, now); e != nil {
					log.Printf("partitions: %v", e)
				}
				if e := s.expire(now); e != nil {
					log.Printf("retention: %v", e)
				}
				last = now
			}
		}
	}
}
func (s *Core) expire(now time.Time) error {
	var dirty int
	if e := s.DB.QueryRow("SELECT count(*) FROM dirty_hours").Scan(&dirty); e != nil {
		return e
	}
	if dirty != 0 {
		return nil
	}
	rows, e := s.DB.Query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE 'snapshot_history_%'")
	if e != nil {
		return e
	}
	names := []string{}
	for rows.Next() {
		var name string
		rows.Scan(&name)
		names = append(names, name)
	}
	rows.Close()
	cutoff := now.UTC().Truncate(24*time.Hour).AddDate(0, 0, -s.Config.RawDays)
	for _, name := range names {
		day, e := time.Parse("20060102", name[len("snapshot_history_"):])
		if e != nil {
			continue
		}
		if day.Before(cutoff) {
			if _, e = s.DB.Exec(fmt.Sprintf("DROP TABLE %s", name)); e != nil {
				return e
			}
		}
	}
	_, e = s.DB.Exec("DELETE FROM hourly_summaries WHERE hour<$1", now.AddDate(0, 0, -s.Config.SummaryDays))
	return e
}
