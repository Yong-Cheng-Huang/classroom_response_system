import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { projectRoot } from './config.js';

export type SqliteDatabase = Database.Database;
export type Migration = { version: number; name: string; sql: string; checksum: string };

export function loadMigrations(): Migration[] {
  const directory = join(projectRoot, 'database/migrations');
  return readdirSync(directory).filter(name => /^\d{3}_[a-z_]+\.sql$/.test(name)).sort().map(name => {
    const sql = readFileSync(join(directory, name), 'utf8');
    return { version: Number(name.slice(0, 3)), name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

export function migrate(database: SqliteDatabase, migrations = loadMigrations()) {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL
  ) STRICT`);
  database.transaction(() => {
    const applied = database.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all() as Pick<Migration, 'version' | 'name' | 'checksum'>[];
    for (let i = 0; i < applied.length; i++) {
      const actual = applied[i]!;
      const expected = migrations[i];
      if (!expected || actual.version !== expected.version || actual.name !== expected.name || actual.checksum !== expected.checksum) throw new Error('migration_integrity');
    }
    for (const migration of migrations.slice(applied.length)) {
      database.exec(migration.sql);
      database.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)').run(migration.version, migration.name, migration.checksum, Date.now());
    }
  }).immediate();
}

export function schemaVersion(database: SqliteDatabase) {
  return (database.prepare('SELECT coalesce(max(version), 0) AS version FROM schema_migrations').get() as { version: number }).version;
}

export function validateHighWater(database: SqliteDatabase) {
  const row = database.prepare(`SELECT receive_high_water AS high,
    (SELECT coalesce(max(id), 0) FROM receive_orders) AS allocated,
    (SELECT coalesce(max(receive_order), 0) FROM submissions) AS submitted
    FROM system_state WHERE id = 1`).get() as { high: number; allocated: number; submitted: number } | undefined;
  if (!row || !Number.isSafeInteger(row.high) || row.high < row.allocated || row.high < row.submitted) throw new Error('receive_order_integrity');
}

export function openDatabase(path: string, migrations = loadMigrations()): SqliteDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const database = new Database(path);
  try {
    database.pragma('foreign_keys = ON');
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = FULL');
    database.pragma('busy_timeout = 5000');
    migrate(database, migrations);
    validateHighWater(database);
    if (path !== ':memory:') chmodSync(path, 0o600);
    return database;
  } catch (error) { database.close(); throw error; }
}

export async function backupDatabase(database: SqliteDatabase, target: string) {
  if (existsSync(target)) throw new Error('backup_target_exists');
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  await database.backup(target);
  chmodSync(target, 0o600);
}

// 回復至新檔，避免覆寫仍使用中的本機活動；來源以 SQLite backup 處理 WAL。
export async function restoreDatabase(source: string, target: string) {
  if (existsSync(target)) throw new Error('restore_target_exists');
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    if (database.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('backup_integrity');
    const applied = database.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all() as { version: number; checksum: string }[];
    const known = loadMigrations();
    if (!applied.length || applied.some((migration, i) => migration.version !== known[i]?.version || migration.checksum !== known[i]?.checksum)) throw new Error('backup_version');
    await backupDatabase(database, target);
  } finally { database.close(); }
}
