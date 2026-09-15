package rms

import (
	"database/sql"
	"errors"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// These are application data tables. rms_migrations is intentionally excluded:
// migration records are schema metadata, not customer data.
var freshInstallDataTables = []string{
	"organizations",
	"users",
	"enrollment_tokens",
	"devices",
	"recovery_challenges",
	"profiles",
	"assignments",
	"snapshot_cursors",
	"current_snapshots",
	"snapshot_history",
	"hourly_summaries",
	"rollup_progress",
	"dirty_hours",
	"sessions",
	"audit_logs",
	"collector_bundles",
	"rms_settings",
	"pending_devices",
	"bootstrap_challenges",
	"registrations",
	"tags",
	"device_tags",
	"device_groups",
	"device_group_members",
	"enrollment_token_groups",
	"monitoring_templates",
	"monitoring_template_versions",
	"monitoring_bindings",
	"monitoring_effective_assignments",
	"alert_states",
	"alerts",
	"alert_events",
	"presence_hours",
}

// BootstrapOrgAdmin initializes a fresh RMS database for one customer
// organization. It deliberately refuses to run against a database containing
// any application data so a default installation cannot silently accumulate
// demo records or duplicate administrator accounts.
func BootstrapOrgAdmin(d *sql.DB, email, password, organization string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	organization = strings.TrimSpace(organization)
	if len(password) < 12 || len(password) > 72 || !strings.Contains(email, "@") || len(organization) < 1 || len(organization) > 128 {
		return errors.New("organization name, admin email and password of 12–72 bytes required")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("SELECT pg_advisory_xact_lock(781332)"); err != nil {
		return err
	}
	for _, table := range freshInstallDataTables {
		var present bool
		if err = tx.QueryRow("SELECT EXISTS (SELECT 1 FROM " + table + ")").Scan(&present); err != nil {
			return err
		}
		if present {
			return errors.New("initial organization administrator requires an empty RMS database")
		}
	}

	orgID := randomID()
	if _, err = tx.Exec("INSERT INTO organizations(id,name) VALUES($1,$2)", orgID, organization); err != nil {
		return err
	}
	if _, err = tx.Exec("INSERT INTO users(id,organization_id,email,password_hash,role) VALUES($1,$2,$3,$4,'ORG_ADMIN')", randomID(), orgID, email, string(hash)); err != nil {
		return err
	}
	return tx.Commit()
}
