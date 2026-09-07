ALTER TABLE collector_bundles DROP CONSTRAINT collector_bundles_pkey;
ALTER TABLE collector_bundles ADD PRIMARY KEY(id,version);
CREATE TABLE IF NOT EXISTS rms_settings (name text PRIMARY KEY, value jsonb NOT NULL);
