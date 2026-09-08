CREATE TABLE device_groups (
 id text PRIMARY KEY,
 organization_id text NOT NULL REFERENCES organizations,
 name text NOT NULL,
 description text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,name)
);
CREATE INDEX device_groups_org ON device_groups(organization_id,id);
CREATE TABLE device_group_members (
 group_id text NOT NULL REFERENCES device_groups ON DELETE CASCADE,
 device_id text NOT NULL REFERENCES devices ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(group_id,device_id)
);
CREATE INDEX device_group_members_device ON device_group_members(device_id,group_id);
CREATE FUNCTION validate_device_group_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM devices d JOIN device_groups g ON g.organization_id=d.organization_id WHERE d.id=NEW.device_id AND g.id=NEW.group_id) THEN
  RAISE EXCEPTION 'device group ownership mismatch';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER device_group_owner BEFORE INSERT OR UPDATE ON device_group_members FOR EACH ROW EXECUTE FUNCTION validate_device_group_owner();
