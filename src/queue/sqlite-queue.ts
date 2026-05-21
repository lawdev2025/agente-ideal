import { getDatabase } from '../db/connection';
import { logger } from '../logger';

export interface QueueMessage {
  id: number;
  wa_message_id: string;
  wa_id: string;
  body: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  attempts: number;
  next_attempt_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

const BACKOFF_MS = [10_000, 60_000, 300_000]; // 10s, 60s, 5m

export class SqliteQueue {
  private getDb() {
    return getDatabase();
  }

  enqueue(waMessageId: string, waId: string, body: string): number {
    const now = Date.now();
    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO inbound_queue (wa_message_id, wa_id, body, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    try {
      const result = stmt.run(waMessageId, waId, body, now, now);
      logger.debug({ id: result.lastInsertRowid, waId }, 'Message enqueued');
      return result.lastInsertRowid as number;
    } catch (error: any) {
      // Check for UNIQUE constraint violation
      if (
        error.code === 'SQLITE_CONSTRAINT' ||
        (error.message && error.message.includes('UNIQUE constraint failed'))
      ) {
        logger.debug({ waMessageId }, 'Message already in queue (idempotent)');
        // Return existing ID for idempotency
        const existing = db
          .prepare('SELECT id FROM inbound_queue WHERE wa_message_id = ?')
          .get(waMessageId) as any;
        return existing?.id || -1;
      }
      throw error;
    }
  }

  claim(limit: number = 1): QueueMessage[] {
    const now = Date.now();
    const db = this.getDb();
    const stmt = db.prepare(`
      UPDATE inbound_queue
      SET status = 'processing', updated_at = ?, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM inbound_queue
        WHERE (status = 'pending' OR (status = 'failed' AND next_attempt_at <= ?))
        ORDER BY created_at ASC
        LIMIT ?
      )
      RETURNING *
    `);

    const results = stmt.all(now, now, limit) as QueueMessage[];
    logger.debug({ count: results.length }, 'Claimed messages from queue');
    return results;
  }

  complete(id: number): void {
    const now = Date.now();
    this.getDb()
      .prepare('UPDATE inbound_queue SET status = ?, updated_at = ? WHERE id = ?')
      .run('done', now, id);
    logger.debug({ id }, 'Message marked as done');
  }

  fail(id: number, error: string, shouldRetry: boolean = true): void {
    const now = Date.now();
    const db = this.getDb();
    const msg = db
      .prepare('SELECT attempts FROM inbound_queue WHERE id = ?')
      .get(id) as any;

    if (!msg) return;

    const nextAttempt = msg.attempts < BACKOFF_MS.length ? msg.attempts : BACKOFF_MS.length - 1;
    const nextRetryAt = shouldRetry ? now + BACKOFF_MS[nextAttempt] : null;

    const status = shouldRetry && nextRetryAt ? 'failed' : 'failed';

    db
      .prepare(
        `UPDATE inbound_queue
         SET status = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(status, nextRetryAt, error.slice(0, 255), now, id);

    logger.warn({ id, error: error.slice(0, 100), nextRetryAt }, 'Message marked as failed');
  }

  getPending(): QueueMessage[] {
    return this.getDb()
      .prepare('SELECT * FROM inbound_queue WHERE status = ? ORDER BY created_at ASC')
      .all('pending') as QueueMessage[];
  }

  getById(id: number): QueueMessage | null {
    return (
      (this.getDb().prepare('SELECT * FROM inbound_queue WHERE id = ?').get(id) as QueueMessage) ||
      null
    );
  }

  getStats(): { pending: number; processing: number; done: number; failed: number } {
    const counts = this.getDb()
      .prepare(
        `
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM inbound_queue
    `
      )
      .get() as any;

    return {
      pending: counts.pending || 0,
      processing: counts.processing || 0,
      done: counts.done || 0,
      failed: counts.failed || 0,
    };
  }

  // Alias methods for compatibility
  async addMessage(msg: { messageId: string; senderId: string; text: string; platform: string }): Promise<number> {
    return this.enqueue(msg.messageId, msg.senderId, msg.text);
  }

  async claimMessages(limit: number, lockTimeMs: number): Promise<Array<{ id: number; messageId: string; senderId: string; text: string; created_at: number }>> {
    const messages = this.claim(limit);
    return messages.map(msg => ({
      id: msg.id,
      messageId: msg.wa_message_id,
      senderId: msg.wa_id,
      text: msg.body,
      created_at: msg.created_at,
    }));
  }

  async completeMessage(id: number): Promise<void> {
    this.complete(id);
  }

  async releaseClaim(id: number): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare(`
      UPDATE inbound_queue
      SET status = 'pending'
      WHERE id = ?
    `);
    stmt.run(id);
    logger.debug({ id }, 'Claim released, message back to pending');
  }
}

export const queue = new SqliteQueue();
