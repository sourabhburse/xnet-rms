-- Products are platform data.  Device identity is still rooted in the
-- serial number, while product-specific identifiers are stored as a map so
-- products can use MAC, IMEI, or vendor identifiers without schema changes.
CREATE TABLE products (
  id text PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  identity_schema jsonb NOT NULL DEFAULT '[]',
  model_patterns jsonb NOT NULL DEFAULT '[]',
  capabilities jsonb NOT NULL DEFAULT '[]',
  current_revision integer NOT NULL DEFAULT 1,
  default_profile_id text,
  default_profile_version integer,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(default_profile_id, default_profile_version) REFERENCES profiles(id, version)
);

CREATE TABLE product_revisions (
  product_id text NOT NULL REFERENCES products(id),
  version integer NOT NULL CHECK(version > 0),
  identity_schema jsonb NOT NULL DEFAULT '[]',
  model_patterns jsonb NOT NULL DEFAULT '[]',
  capabilities jsonb NOT NULL DEFAULT '[]',
  default_profile_id text,
  default_profile_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(product_id, version),
  FOREIGN KEY(default_profile_id, default_profile_version) REFERENCES profiles(id, version)
);

INSERT INTO products(id, code, name, description, identity_schema, model_patterns, archived)
VALUES
  ('00000000000000000000000000000002', '2S', 'XNET 2S', 'Legacy XNET 2S router product',
   '[{"kind":"mac","label":"LAN MAC","required":true,"normalize":"mac","unique":true}]',
   '["XE33 2S","%2S%"]', false),
  ('00000000000000000000000000000000', 'UNRECOGNIZED', 'Unrecognized hardware', 'System fallback for legacy registrations', '[]', '[]', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO product_revisions(product_id, version, identity_schema, model_patterns, capabilities)
SELECT id, 1, identity_schema, model_patterns, capabilities FROM products
WHERE code IN ('2S', 'UNRECOGNIZED')
ON CONFLICT (product_id, version) DO NOTHING;

ALTER TABLE devices ADD COLUMN product_id text REFERENCES products(id);
ALTER TABLE devices ADD COLUMN product_revision integer;
ALTER TABLE devices ADD COLUMN identifiers jsonb NOT NULL DEFAULT '{}';
ALTER TABLE pending_devices ADD COLUMN product_id text REFERENCES products(id);
ALTER TABLE pending_devices ADD COLUMN product_revision integer;
ALTER TABLE pending_devices ADD COLUMN identifiers jsonb NOT NULL DEFAULT '{}';
ALTER TABLE registrations ADD COLUMN product_id text REFERENCES products(id);
ALTER TABLE registrations ADD COLUMN product_revision integer;
ALTER TABLE registrations ADD COLUMN identifiers jsonb NOT NULL DEFAULT '{}';

UPDATE devices
SET identifiers = CASE WHEN lan_mac IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('mac', lan_mac) END,
    product_id = CASE WHEN lan_mac IS NULL THEN NULL ELSE '00000000000000000000000000000002' END,
    product_revision = CASE WHEN lan_mac IS NULL THEN NULL ELSE 1 END;
UPDATE pending_devices
SET identifiers = jsonb_build_object('mac', lan_mac),
    product_id = '00000000000000000000000000000002', product_revision = 1;
UPDATE registrations
SET identifiers = jsonb_build_object('mac', lan_mac),
    product_id = '00000000000000000000000000000002', product_revision = 1;
UPDATE registrations
SET product_id = '00000000000000000000000000000000', product_revision = 1
WHERE lan_mac IS NULL;

ALTER TABLE registrations ALTER COLUMN product_id SET NOT NULL;
ALTER TABLE registrations ALTER COLUMN product_revision SET NOT NULL;

CREATE INDEX products_active_code ON products(code) WHERE NOT archived;
CREATE INDEX devices_identifiers ON devices USING gin(identifiers jsonb_path_ops);
CREATE INDEX pending_identifiers ON pending_devices USING gin(identifiers jsonb_path_ops);
CREATE INDEX registrations_identifiers ON registrations USING gin(identifiers jsonb_path_ops);

-- A typed ownership model retains foreign-key integrity while allowing a
-- claim to move atomically from a registration/pending device to a device.
CREATE TABLE identity_claims (
  kind text NOT NULL,
  value text NOT NULL,
  device_id text REFERENCES devices(id),
  pending_id text REFERENCES pending_devices(id),
  registration_id text REFERENCES registrations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(kind, value),
  CHECK (num_nonnulls(device_id, pending_id, registration_id) = 1)
);
CREATE INDEX identity_claims_device ON identity_claims(device_id) WHERE device_id IS NOT NULL;
CREATE INDEX identity_claims_pending ON identity_claims(pending_id) WHERE pending_id IS NOT NULL;
CREATE INDEX identity_claims_registration ON identity_claims(registration_id) WHERE registration_id IS NOT NULL;

-- Devices were historically globally unique by serial.  Preserve that
-- invariant in the new namespace and backfill records in ownership order.
INSERT INTO identity_claims(kind, value, device_id)
SELECT 'serial', serial_number, id FROM devices
ON CONFLICT DO NOTHING;
INSERT INTO identity_claims(kind, value, device_id)
SELECT e.key, e.value, d.id
FROM devices d CROSS JOIN LATERAL jsonb_each_text(d.identifiers) e
ON CONFLICT DO NOTHING;
INSERT INTO identity_claims(kind, value, pending_id)
SELECT 'serial', p.serial_number, p.id FROM pending_devices p
WHERE NOT EXISTS (SELECT 1 FROM identity_claims c WHERE c.kind='serial' AND c.value=p.serial_number)
ON CONFLICT DO NOTHING;
INSERT INTO identity_claims(kind, value, pending_id)
SELECT e.key, e.value, p.id
FROM pending_devices p CROSS JOIN LATERAL jsonb_each_text(p.identifiers) e
WHERE NOT EXISTS (SELECT 1 FROM identity_claims c WHERE c.kind=e.key AND c.value=e.value)
ON CONFLICT DO NOTHING;
INSERT INTO identity_claims(kind, value, registration_id)
SELECT 'serial', r.serial_number, r.id FROM registrations r
WHERE NOT r.canceled AND NOT EXISTS (SELECT 1 FROM identity_claims c WHERE c.kind='serial' AND c.value=r.serial_number)
ON CONFLICT DO NOTHING;
INSERT INTO identity_claims(kind, value, registration_id)
SELECT e.key, e.value, r.id
FROM registrations r CROSS JOIN LATERAL jsonb_each_text(r.identifiers) e
WHERE NOT r.canceled AND NOT EXISTS (SELECT 1 FROM identity_claims c WHERE c.kind=e.key AND c.value=e.value)
ON CONFLICT DO NOTHING;

DROP INDEX IF EXISTS devices_lan_mac;
DROP INDEX IF EXISTS registrations_serial;
DROP INDEX IF EXISTS registrations_mac;
ALTER TABLE devices DROP COLUMN lan_mac;
ALTER TABLE pending_devices DROP COLUMN lan_mac;
ALTER TABLE registrations DROP COLUMN lan_mac;

ALTER TABLE products
  ADD CONSTRAINT products_id_revision_unique UNIQUE(id, current_revision),
  ADD CONSTRAINT products_current_revision_fk
  FOREIGN KEY(id, current_revision) REFERENCES product_revisions(product_id, version)
  DEFERRABLE INITIALLY DEFERRED;
