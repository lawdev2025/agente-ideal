import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/connection';
import { createSchema } from '../src/db/init';
import { SqliteQueue } from '../src/queue/sqlite-queue';

let q: SqliteQueue;

beforeEach(() => {
  // Create a new in-memory DB for each test
  process.env.DB_PATH = `:memory:?mode=memory&cache=shared`;
  const counter = Math.random().toString(36).substring(7);
  process.env.DB_PATH = `file:memdb${counter}?mode=memory&cache=shared`;

  initDatabase();
  createSchema();
  q = new SqliteQueue();
});

afterEach(() => {
  // Clear all data from tables before closing
  try {
    const db = getDatabase();
    db.exec('DELETE FROM inbound_queue');
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM contacts');
    db.exec('DELETE FROM dead_letter');
  } catch {
    // Ignore errors
  }
  closeDatabase();
});

describe('SqliteQueue', () => {
  it('should enqueue a message', () => {
    const id = q.enqueue('msg-123', '5511999999999', 'Hello');
    expect(id).toBeGreaterThan(0);
  });

  it('should claim pending messages atomically', () => {
    q.enqueue('msg-1', '5511111111111', 'Hello');
    q.enqueue('msg-2', '5522222222222', 'World');

    const claimed = q.claim(1);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].status).toBe('processing');

    const next = q.claim(1);
    expect(next).toHaveLength(1);
  });

  it('should complete a message', () => {
    const id = q.enqueue('msg-123', '5511999999999', 'Hello');
    q.complete(id);

    const msg = q.getById(id);
    expect(msg?.status).toBe('done');
  });

  it('should handle idempotent enqueue (duplicate message ID)', () => {
    const id1 = q.enqueue('msg-123', '5511999999999', 'Hello');
    const id2 = q.enqueue('msg-123', '5511999999999', 'Hello');

    expect(id1).toBe(id2); // Should return same ID
  });

  it('should fail a message with backoff', () => {
    const id = q.enqueue('msg-123', '5511999999999', 'Hello');
    q.fail(id, 'Test error');

    const msg = q.getById(id);
    expect(msg?.status).toBe('failed');
    expect(msg?.next_attempt_at).toBeGreaterThan(0);
  });
});
