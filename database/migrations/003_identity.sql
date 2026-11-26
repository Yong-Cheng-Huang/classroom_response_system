CREATE TABLE identity_settings (
  id INTEGER PRIMARY KEY CHECK (id=1),
  password_salt TEXT NOT NULL,
  password_version TEXT
) STRICT;

CREATE TABLE tab_bindings (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
  document_instance_id TEXT
) STRICT;
CREATE INDEX tab_secret_idx ON tab_bindings(secret_hash);

CREATE TABLE runtime_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  running INTEGER NOT NULL CHECK(running IN (0,1))
) STRICT;
INSERT INTO runtime_state VALUES(1,0);

CREATE TRIGGER joined_nickname_immutable BEFORE UPDATE OF nickname ON participants
WHEN OLD.membership_state='JOINED' AND NEW.nickname!=OLD.nickname
BEGIN SELECT RAISE(ABORT,'joined_nickname_immutable'); END;
