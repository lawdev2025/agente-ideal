import { getDatabase } from '../db/connection';

export interface Message {
  id: number;
  wa_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  created_at: number;
}

export interface Contact {
  wa_id: string;
  bot_paused: boolean;
  paused_reason: string | null;
  paused_at: number | null;
  last_seen_at: number | null;
}

export class StateRepository {
  /**
   * Appends a message to the conversation history for a given WhatsApp contact.
   * Returns the message ID.
   */
  appendMessage(
    waId: string,
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: string
  ): number {
    const db = getDatabase();
    const createdAt = Date.now();

    const stmt = db.prepare(
      `INSERT INTO messages (wa_id, role, content, created_at)
       VALUES (?, ?, ?, ?)`
    );

    const result = stmt.run(waId, role, content, createdAt);
    return result.lastInsertRowid as number;
  }

  /**
   * Retrieves the last N messages for a given WhatsApp contact.
   * Default limit is 10. Ordered from oldest to newest.
   */
  getHistory(waId: string, limit: number = 10): Message[] {
    const db = getDatabase();

    const stmt = db.prepare(
      `SELECT id, wa_id, role, content, created_at
       FROM messages
       WHERE wa_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    );

    const rows = stmt.all(waId, limit) as Message[];
    // Reverse to get oldest-first order
    return rows.reverse();
  }

  /**
   * Gets or creates a contact record. Returns the contact.
   * If the contact doesn't exist, it creates one with default values.
   */
  getOrCreateContact(waId: string): Contact {
    const db = getDatabase();

    // Try to get existing contact
    const getStmt = db.prepare(
      `SELECT wa_id, bot_paused, paused_reason, paused_at, last_seen_at
       FROM contacts
       WHERE wa_id = ?`
    );

    const existing = getStmt.get(waId) as {
      wa_id: string;
      bot_paused: number;
      paused_reason: string | null;
      paused_at: number | null;
      last_seen_at: number | null;
    } | undefined;

    if (existing) {
      return {
        wa_id: existing.wa_id,
        bot_paused: existing.bot_paused === 1,
        paused_reason: existing.paused_reason,
        paused_at: existing.paused_at,
        last_seen_at: existing.last_seen_at,
      };
    }

    // Create new contact
    const insertStmt = db.prepare(
      `INSERT INTO contacts (wa_id, bot_paused, paused_reason, paused_at, last_seen_at)
       VALUES (?, 0, NULL, NULL, NULL)`
    );

    insertStmt.run(waId);

    return {
      wa_id: waId,
      bot_paused: false,
      paused_reason: null,
      paused_at: null,
      last_seen_at: null,
    };
  }

  /**
   * Pauses the bot for a given contact with a reason.
   */
  pauseBot(waId: string, reason: string): void {
    const db = getDatabase();
    const pausedAt = Date.now();

    // Ensure contact exists
    this.getOrCreateContact(waId);

    const stmt = db.prepare(
      `UPDATE contacts
       SET bot_paused = 1, paused_reason = ?, paused_at = ?
       WHERE wa_id = ?`
    );

    stmt.run(reason, pausedAt, waId);
  }

  /**
   * Resumes the bot for a given contact.
   */
  resumeBot(waId: string): void {
    const db = getDatabase();

    // Ensure contact exists
    this.getOrCreateContact(waId);

    const stmt = db.prepare(
      `UPDATE contacts
       SET bot_paused = 0, paused_reason = NULL, paused_at = NULL
       WHERE wa_id = ?`
    );

    stmt.run(waId);
  }

  /**
   * Checks if the bot is paused for a given contact.
   */
  isBotPaused(waId: string): boolean {
    const db = getDatabase();

    const stmt = db.prepare(
      `SELECT bot_paused FROM contacts WHERE wa_id = ?`
    );

    const result = stmt.get(waId) as { bot_paused: number } | undefined;

    if (!result) {
      return false;
    }

    return result.bot_paused === 1;
  }

  /**
   * Updates the last_seen_at timestamp for a given contact to now.
   */
  updateLastSeen(waId: string): void {
    const db = getDatabase();
    const now = Date.now();

    // Ensure contact exists
    this.getOrCreateContact(waId);

    const stmt = db.prepare(
      `UPDATE contacts SET last_seen_at = ? WHERE wa_id = ?`
    );

    stmt.run(now, waId);
  }
}
