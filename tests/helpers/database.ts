import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { openDatabase, type SqliteDatabase } from '../../src/server/database.js';

export function temporaryDatabase(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'classroom-test-'));
  const path = join(directory, 'classroom.db');
  const database = openDatabase(path);
  t.after(() => { if (database.open) database.close(); rmSync(directory, { recursive: true, force: true }); });
  return { database, path, directory };
}

export function seedActivity(database: SqliteDatabase) {
  database.exec(`
    INSERT INTO activities(id, state, group_count, started_at) VALUES ('a', 'RUNNING', 2, 1000);
    INSERT INTO sources VALUES ('a', 'test-copy', 'sheet', '1', '{"merges":["G5:H5"]}');
    INSERT INTO groups VALUES ('g1', 'a', 1), ('g2', 'a', 2);
    INSERT INTO questions VALUES ('q', 'a', '1', 0, 'GROUP'), ('single', 'a', '2', 1, 'SINGLE');
    INSERT INTO question_fields VALUES
      ('f1', 'a', 'q', 0, '（1）', '第一個子題', 'H5', '{}'),
      ('f2', 'a', 'q', 1, '（2）', '第二個子題', 'H6', '{}'),
      ('f3', 'a', 'single', 0, NULL, '單題敘述', 'G9:H9', '{}');
    INSERT INTO sessions(id, token_hash, role, created_at, expires_at, lifecycle) VALUES
      ('s1', 'hash1', 'STUDENT', 0, 43200000, 'CONNECTED'),
      ('s2', 'hash2', 'STUDENT', 0, 43200000, 'CONNECTED');
    INSERT INTO participants VALUES
      ('p1', 'a', 'g1', 's1', '同名', 'JOINED'), ('p2', 'a', 'g2', 's2', '同名', 'JOINED');
  `);
}
