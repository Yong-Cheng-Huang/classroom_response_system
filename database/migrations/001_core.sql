CREATE TABLE system_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  receive_high_water INTEGER NOT NULL CHECK (receive_high_water >= 0)
) STRICT;
INSERT INTO system_state VALUES (1, 0);

-- 僅保留序號配置證據，不保存舊答案或活動內容。
CREATE TABLE receive_orders (id INTEGER PRIMARY KEY CHECK (id > 0)) STRICT;

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  current_slot INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (current_slot = 1),
  state TEXT NOT NULL CHECK (state IN ('READY', 'RUNNING', 'ENDED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  group_count INTEGER NOT NULL CHECK (group_count BETWEEN 2 AND 20),
  started_at INTEGER,
  ended_at INTEGER,
  CHECK ((state = 'READY' AND started_at IS NULL AND ended_at IS NULL)
    OR (state = 'RUNNING' AND started_at IS NOT NULL AND ended_at IS NULL)
    OR (state = 'ENDED' AND started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at >= started_at))
) STRICT;

CREATE TABLE sources (
  activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  spreadsheet_id TEXT NOT NULL,
  sheet_id TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
) STRICT;

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 20),
  UNIQUE (activity_id, id),
  UNIQUE (activity_id, number)
) STRICT;

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('SINGLE', 'GROUP')),
  UNIQUE (activity_id, id),
  UNIQUE (activity_id, number),
  UNIQUE (activity_id, position)
) STRICT;

CREATE TABLE question_fields (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  label TEXT,
  prompt TEXT NOT NULL,
  answer_range TEXT NOT NULL,
  original_json TEXT NOT NULL CHECK (json_valid(original_json)),
  UNIQUE (activity_id, question_id, id),
  UNIQUE (question_id, position),
  FOREIGN KEY (activity_id, question_id) REFERENCES questions(activity_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('TEACHER', 'STUDENT')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at = created_at + 43200000),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('CONNECTED', 'GRACE', 'REVOKED', 'EXPIRED')),
  state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version > 0),
  revoked_reason TEXT,
  password_version TEXT,
  grace_started_at INTEGER,
  grace_deadline INTEGER,
  shutdown_evidence_json TEXT CHECK (shutdown_evidence_json IS NULL OR json_valid(shutdown_evidence_json)),
  CHECK (lifecycle != 'GRACE' OR
    (grace_started_at IS NOT NULL AND grace_deadline IS NOT NULL AND grace_deadline >= grace_started_at)),
  CHECK ((role = 'TEACHER' AND password_version IS NOT NULL) OR (role = 'STUDENT' AND password_version IS NULL))
) STRICT;

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),
  nickname TEXT NOT NULL CHECK (length(nickname) > 0),
  membership_state TEXT NOT NULL CHECK (membership_state IN ('JOINED', 'LEFT', 'INVALID')),
  UNIQUE (activity_id, group_id, id),
  FOREIGN KEY (activity_id, group_id) REFERENCES groups(activity_id, id)
) STRICT;

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  sender_nickname TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  receive_order INTEGER NOT NULL UNIQUE REFERENCES receive_orders(id),
  rank INTEGER NOT NULL CHECK (rank > 0),
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  sealed INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0, 1)),
  UNIQUE (activity_id, question_id, group_id),
  UNIQUE (question_id, rank),
  UNIQUE (activity_id, group_id, request_id),
  UNIQUE (activity_id, question_id, id),
  FOREIGN KEY (activity_id, question_id) REFERENCES questions(activity_id, id),
  FOREIGN KEY (activity_id, group_id, participant_id) REFERENCES participants(activity_id, group_id, id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE submission_answers (
  submission_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  answer_text TEXT NOT NULL CHECK (length(answer_text) > 0),
  PRIMARY KEY (submission_id, field_id),
  FOREIGN KEY (activity_id, question_id, submission_id) REFERENCES submissions(activity_id, question_id, id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id, question_id, field_id) REFERENCES question_fields(activity_id, question_id, id)
) STRICT;

CREATE TABLE export_operations (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  spreadsheet_id TEXT NOT NULL,
  sheet_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('ANSWERS', 'COLUMNS', 'INLINE')),
  state TEXT NOT NULL CHECK (state IN ('PREPARING', 'WRITING', 'COMPLETED', 'FAILED', 'UNCONFIRMED')),
  recovery_plan_json TEXT NOT NULL CHECK (json_valid(recovery_plan_json)),
  request_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

-- 無活動外鍵：只保存跨場次必要歸屬／格式資訊，不保存歷史答案或完整作業。
CREATE TABLE document_output_management (
  spreadsheet_id TEXT NOT NULL,
  sheet_id TEXT NOT NULL,
  range_key TEXT NOT NULL,
  verification TEXT NOT NULL CHECK (verification IN ('VERIFIED', 'UNVERIFIED')),
  content_hash TEXT NOT NULL,
  annotation_start INTEGER CHECK (annotation_start IS NULL OR annotation_start >= 0),
  original_format_json TEXT NOT NULL CHECK (json_valid(original_format_json)),
  expected_format_hash TEXT NOT NULL,
  PRIMARY KEY (spreadsheet_id, sheet_id, range_key)
) STRICT;

CREATE TABLE google_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  account_label TEXT NOT NULL,
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
  credential_reference TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('CONNECTED', 'REAUTHORIZE'))
) STRICT;

CREATE INDEX participant_group_idx ON participants(activity_id, group_id, membership_state);
CREATE INDEX submission_question_idx ON submissions(question_id, rank);
