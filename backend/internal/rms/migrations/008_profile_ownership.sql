ALTER TABLE profiles ADD COLUMN organization_id text REFERENCES organizations;
CREATE INDEX profiles_organization ON profiles(organization_id,id,version);
UPDATE profiles
SET definition = jsonb_set(
  definition,
  '{fields}',
  (definition->'fields') || '[{"id":"memory_used_bytes","path":"/memory_used_bytes","label":"Memory used","unit":"B","kind":"gauge","chart":true,"fleet":true}]'::jsonb
)
WHERE id='8f8d7a2c0d1e4b6aa1c2d3e4f5061728' AND version=1
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(definition->'fields') f WHERE f->>'id'='memory_used_bytes');
