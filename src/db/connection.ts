import Database from 'better-sqlite3';
import path from 'path';
import { logger } from '../logger';
import config from '../config/env';

let db: Database.Database | null = null;

export function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = config.DB_PATH;
  const dir = path.dirname(dbPath);

  // Ensure data directory exists
  const fs = require('fs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  logger.info({ dbPath }, 'SQLite database connected');

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('SQLite database closed');
  }
}
