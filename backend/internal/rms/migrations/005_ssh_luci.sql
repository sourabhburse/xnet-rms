ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_protocol_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_protocol_check CHECK(protocol IN ('HTTP_LUCI','SSH_LUCI','TERMINAL_SSH'));
