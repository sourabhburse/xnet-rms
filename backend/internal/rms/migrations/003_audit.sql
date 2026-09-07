CREATE FUNCTION audit_session_closure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL THEN
    INSERT INTO audit_logs(organization_id,user_id,action,resource_id)
      SELECT organization_id,NULLIF(current_setting('rms.actor',true),''),'session.close',NEW.id
      FROM devices WHERE id=NEW.device_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_closure AFTER UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION audit_session_closure();
CREATE INDEX recovery_device_expiry ON recovery_challenges(device_id,expires_at);
CREATE INDEX history_received ON snapshot_history(received_at);
