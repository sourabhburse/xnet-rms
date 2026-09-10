package rms

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	_ "github.com/jackc/pgx/v5/stdlib"
	"time"
)

//go:embed migrations/*.sql
var migrations embed.FS

func OpenDB(dsn string) (*sql.DB, error) {
	d, e := sql.Open("pgx", dsn)
	if e != nil {
		return nil, e
	}
	d.SetMaxOpenConns(16)
	d.SetMaxIdleConns(4)
	d.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if e = d.PingContext(ctx); e != nil {
		d.Close()
		return nil, e
	}
	return d, nil
}
func Migrate(d *sql.DB) error {
	tx, e := d.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.Exec("SELECT pg_advisory_xact_lock(781331)"); e != nil {
		return e
	}
	if _, e = tx.Exec("CREATE TABLE IF NOT EXISTS rms_migrations(version integer PRIMARY KEY)"); e != nil {
		return e
	}
	for version, name := range []string{"001_initial.sql", "002_bundles.sql", "003_audit.sql", "004_onboarding.sql", "005_ssh_luci.sql", "006_groups.sql", "007_device_overview.sql", "008_profile_ownership.sql"} {
		var n int
		if e = tx.QueryRow("SELECT count(*) FROM rms_migrations WHERE version=$1", version+1).Scan(&n); e != nil {
			return e
		}
		if n == 0 {
			b, e := migrations.ReadFile("migrations/" + name)
			if e != nil {
				return e
			}
			if _, e = tx.Exec(string(b)); e != nil {
				return e
			}
			if _, e = tx.Exec("INSERT INTO rms_migrations VALUES($1)", version+1); e != nil {
				return e
			}
		}
	}
	return tx.Commit()
}
func CheckSchema(d *sql.DB) error {
	var n int
	e := d.QueryRow("SELECT count(*) FROM rms_migrations WHERE version=8").Scan(&n)
	if e != nil || n != 1 {
		return fmt.Errorf("run explicit migrate command before serving: %v", e)
	}
	return nil
}
func audit(tx *sql.Tx, org, user, action, id string) error {
	_, e := tx.Exec("INSERT INTO audit_logs(organization_id,user_id,action,resource_id) VALUES(NULLIF($1,''),NULLIF($2,''),$3,$4)", org, user, action, id)
	return e
}
func jsonRows(d *sql.DB, q string, args ...any) ([]json.RawMessage, error) {
	rows, e := d.Query(q, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var b []byte
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		out = append(out, json.RawMessage(b))
	}
	return out, rows.Err()
}
func Partitions(d *sql.DB, now time.Time) error {
	for i := -1; i <= 2; i++ {
		day := now.UTC().Truncate(24*time.Hour).AddDate(0, 0, i)
		q := fmt.Sprintf("CREATE TABLE IF NOT EXISTS snapshot_history_%s PARTITION OF snapshot_history FOR VALUES FROM ('%s') TO ('%s')", day.Format("20060102"), day.Format(time.RFC3339), day.AddDate(0, 0, 1).Format(time.RFC3339))
		if _, e := d.Exec(q); e != nil {
			return e
		}
	}
	return nil
}
