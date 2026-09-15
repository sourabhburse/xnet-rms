ALTER TABLE users ADD CONSTRAINT users_organization_required
  CHECK (role = 'SUPER_ADMIN' OR organization_id IS NOT NULL);
