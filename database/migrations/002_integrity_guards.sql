CREATE TRIGGER session_terminal_state
BEFORE UPDATE ON sessions
WHEN OLD.lifecycle IN ('REVOKED', 'EXPIRED') AND NEW.lifecycle NOT IN ('REVOKED', 'EXPIRED')
BEGIN SELECT RAISE(ABORT, 'session_terminal_state'); END;

CREATE TRIGGER immutable_session_expiry
BEFORE UPDATE OF created_at, expires_at ON sessions
WHEN NEW.created_at != OLD.created_at OR NEW.expires_at != OLD.expires_at
BEGIN SELECT RAISE(ABORT, 'immutable_session_expiry'); END;

CREATE TRIGGER seal_complete_submission
BEFORE UPDATE OF sealed ON submissions WHEN OLD.sealed = 0 AND NEW.sealed = 1
BEGIN
  SELECT CASE WHEN
    (SELECT count(*) FROM question_fields WHERE question_id = NEW.question_id) = 0
    OR (SELECT count(*) FROM submission_answers WHERE submission_id = NEW.id)
      != (SELECT count(*) FROM question_fields WHERE question_id = NEW.question_id)
    THEN RAISE(ABORT, 'incomplete_submission') END;
END;

CREATE TRIGGER immutable_submission
BEFORE UPDATE ON submissions WHEN OLD.sealed = 1
BEGIN SELECT RAISE(ABORT, 'immutable_submission'); END;

CREATE TRIGGER immutable_answer_update
BEFORE UPDATE ON submission_answers
WHEN (SELECT sealed FROM submissions WHERE id = OLD.submission_id) = 1
BEGIN SELECT RAISE(ABORT, 'immutable_answer'); END;

CREATE TRIGGER immutable_answer_insert
BEFORE INSERT ON submission_answers
WHEN (SELECT sealed FROM submissions WHERE id = NEW.submission_id) = 1
BEGIN SELECT RAISE(ABORT, 'immutable_answer'); END;

CREATE TRIGGER immutable_answer_delete
BEFORE DELETE ON submission_answers
WHEN EXISTS(SELECT 1 FROM activities WHERE id = OLD.activity_id)
  AND (SELECT sealed FROM submissions WHERE id = OLD.submission_id) = 1
BEGIN SELECT RAISE(ABORT, 'immutable_answer'); END;

CREATE TRIGGER immutable_submission_delete
BEFORE DELETE ON submissions
WHEN OLD.sealed = 1 AND EXISTS(SELECT 1 FROM activities WHERE id = OLD.activity_id)
BEGIN SELECT RAISE(ABORT, 'immutable_submission'); END;
