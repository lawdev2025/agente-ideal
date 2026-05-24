import { getDatabase } from './connection';
import { logger } from '../logger';

export function createSchema(): void {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS inbound_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_message_id TEXT NOT NULL UNIQUE,
      wa_id TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inbound_pending
      ON inbound_queue(status, next_attempt_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_wa
      ON messages(wa_id, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      wa_id TEXT PRIMARY KEY,
      name TEXT,
      phone TEXT,
      bot_paused INTEGER NOT NULL DEFAULT 0,
      paused_reason TEXT,
      paused_at INTEGER,
      last_seen_at INTEGER
    );
  `);

  // Migrate existing databases: add name/phone columns if missing
  try { db.exec(`ALTER TABLE contacts ADD COLUMN name TEXT`); } catch {}
  try { db.exec(`ALTER TABLE contacts ADD COLUMN phone TEXT`); } catch {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS dead_letter (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      payload TEXT NOT NULL,
      error TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  logger.info('Database schema initialized');
}
