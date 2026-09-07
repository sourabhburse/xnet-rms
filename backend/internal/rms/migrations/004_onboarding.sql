ALTER TABLE devices ADD COLUMN name text NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN lan_mac text;
ALTER TABLE devices ADD COLUMN agent_version text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX devices_lan_mac ON devices(lan_mac) WHERE lan_mac IS NOT NULL;
CREATE TABLE pending_devices (
 id text PRIMARY KEY, serial_number text UNIQUE NOT NULL, lan_mac text UNIQUE NOT NULL,
 model text NOT NULL, firmware_version text NOT NULL, agent_version text NOT NULL,
 public_key bytea NOT NULL, organization_id text REFERENCES organizations,
 token_id text REFERENCES enrollment_tokens, device_id text REFERENCES devices,
 canceled boolean NOT NULL DEFAULT false, last_seen timestamptz NOT NULL DEFAULT now());
CREATE TABLE bootstrap_challenges (
 id text PRIMARY KEY, public_key bytea NOT NULL, message text NOT NULL,
 expires_at timestamptz NOT NULL);
CREATE INDEX bootstrap_challenges_expiry ON bootstrap_challenges(expires_at);
CREATE TABLE registrations (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations,
 serial_number text NOT NULL, lan_mac text NOT NULL, name text NOT NULL DEFAULT '',
 tags jsonb NOT NULL DEFAULT '[]', device_id text REFERENCES devices,
 canceled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX registrations_serial ON registrations(serial_number) WHERE NOT canceled;
CREATE UNIQUE INDEX registrations_mac ON registrations(lan_mac) WHERE NOT canceled;
CREATE TABLE tags (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations,
 name text NOT NULL, UNIQUE(organization_id,name));
CREATE TABLE device_tags (device_id text NOT NULL REFERENCES devices, tag_id text NOT NULL REFERENCES tags,
 PRIMARY KEY(device_id,tag_id));
CREATE FUNCTION validate_device_tag_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM devices d JOIN tags t ON t.organization_id=d.organization_id WHERE d.id=NEW.device_id AND t.id=NEW.tag_id) THEN
 RAISE EXCEPTION 'tag ownership mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER device_tag_owner BEFORE INSERT OR UPDATE ON device_tags FOR EACH ROW EXECUTE FUNCTION validate_device_tag_owner();
