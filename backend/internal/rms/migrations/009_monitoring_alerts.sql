CREATE TABLE monitoring_templates (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  current_version integer NOT NULL CHECK(current_version > 0),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

CREATE TABLE monitoring_template_versions (
  template_id text NOT NULL REFERENCES monitoring_templates(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version > 0),
  definition jsonb NOT NULL,
  created_by text REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(template_id, version)
);

CREATE TABLE monitoring_bindings (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations,
  template_id text NOT NULL,
  template_version integer NOT NULL,
  target_type text NOT NULL CHECK(target_type IN ('device','group','tag')),
  target_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  interval_seconds integer CHECK(interval_seconds BETWEEN 60 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(template_id, template_version)
    REFERENCES monitoring_template_versions(template_id, version),
  UNIQUE(template_id, target_type, target_id)
);
CREATE INDEX monitoring_bindings_scope
  ON monitoring_bindings(organization_id, target_type, target_id) WHERE enabled;

-- Materialized internal assignments generated from customer-facing bindings.
-- This lets the existing agent profile and ingestion contracts remain stable.
CREATE TABLE monitoring_effective_assignments (
  device_id text NOT NULL REFERENCES devices ON DELETE CASCADE,
  source_id text NOT NULL,
  profile_id text NOT NULL,
  profile_version integer NOT NULL,
  PRIMARY KEY(device_id, source_id),
  FOREIGN KEY(profile_id, profile_version) REFERENCES profiles(id, version)
);

CREATE TABLE alert_states (
  organization_id text NOT NULL REFERENCES organizations,
  device_id text NOT NULL REFERENCES devices ON DELETE CASCADE,
  template_id text NOT NULL REFERENCES monitoring_templates(id) ON DELETE CASCADE,
  template_version integer NOT NULL,
  metric_id text NOT NULL,
  entity_key text NOT NULL DEFAULT '',
  candidate_severity text NOT NULL DEFAULT 'healthy'
    CHECK(candidate_severity IN ('healthy','warning','critical')),
  candidate_count integer NOT NULL DEFAULT 0,
  healthy_count integer NOT NULL DEFAULT 0,
  current_alert_id text,
  last_value jsonb,
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(device_id, template_id, template_version, metric_id, entity_key)
);

CREATE TABLE alerts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations,
  device_id text NOT NULL REFERENCES devices ON DELETE CASCADE,
  template_id text NOT NULL REFERENCES monitoring_templates(id) ON DELETE CASCADE,
  template_version integer NOT NULL,
  metric_id text NOT NULL,
  entity_key text NOT NULL DEFAULT '',
  severity text NOT NULL CHECK(severity IN ('warning','critical')),
  status text NOT NULL CHECK(status IN ('PENDING','OPEN','ACKNOWLEDGED','RESOLVED')),
  last_value jsonb,
  opened_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by text REFERENCES users,
  resolved_at timestamptz,
  resolution_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_metric_alert
  ON alerts(device_id, template_id, template_version, metric_id, entity_key)
  WHERE status <> 'RESOLVED';
CREATE INDEX alerts_tenant_status
  ON alerts(organization_id, status, severity, updated_at DESC);

CREATE TABLE alert_events (
  id bigserial PRIMARY KEY,
  alert_id text NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  event text NOT NULL,
  severity text NOT NULL,
  value jsonb,
  actor_id text REFERENCES users,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_events_time ON alert_events(occurred_at);

-- A compact sixty-bit bitmap records which minutes received a heartbeat.
-- It keeps availability history bounded without one row per heartbeat.
CREATE TABLE presence_hours (
  device_id text NOT NULL REFERENCES devices ON DELETE CASCADE,
  hour timestamptz NOT NULL,
  seen_minutes bigint NOT NULL DEFAULT 0,
  offline_events integer NOT NULL DEFAULT 0,
  reboots integer NOT NULL DEFAULT 0,
  PRIMARY KEY(device_id, hour)
);
CREATE INDEX presence_hours_time ON presence_hours(hour);
