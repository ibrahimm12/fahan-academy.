import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { domains, lessons, questions } from './curriculum.mjs';

const file = process.env.DATABASE_PATH === ':memory:' ? ':memory:' : resolve(process.env.DATABASE_PATH || './data/fahan-academy.sqlite');
if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'learner', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS content (
    id TEXT PRIMARY KEY, domain_id INTEGER NOT NULL, title TEXT NOT NULL, minutes INTEGER NOT NULL,
    body_json TEXT NOT NULL, exercise TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS progress (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL, PRIMARY KEY(user_id, lesson_id)
  );
  CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain_id INTEGER NOT NULL, score INTEGER NOT NULL, total INTEGER NOT NULL,
    detail_json TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    customer_id TEXT, subscription_id TEXT, status TEXT NOT NULL DEFAULT 'inactive',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stripe_events (
    event_id TEXT PRIMARY KEY, received_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tutor_usage (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    utc_day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, utc_day)
  );
`);
const seed = db.prepare(`INSERT OR IGNORE INTO content(id,domain_id,title,minutes,body_json,exercise,updated_at)
  VALUES(?,?,?,?,?,?,?)`);
const now = new Date().toISOString();
for (const item of lessons) {
  const { id, domainId, title, minutes, body, exercise } = item;
  seed.run(id, domainId, title, minutes, JSON.stringify(body), exercise, now);
}
export { domains, questions };
