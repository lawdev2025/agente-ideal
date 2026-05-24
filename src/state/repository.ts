import { getDatabase } from '../db/connection';
import { isSupabaseEnabled, getSupabase } from '../db/supabase';
import { logger } from '../logger';

export interface Message {
  id: number;
  wa_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  created_at: number;
}

export interface Contact {
  wa_id: string;
  name: string | null;
  phone: string | null;
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
    const messageId = result.lastInsertRowid as number;

    // Sincronização em segundo plano com o Supabase
    if (isSupabaseEnabled()) {
      try {
        const supabase = getSupabase();
        supabase
          .from('messages')
          .insert({
            wa_id: waId,
            role,
            content,
            created_at: createdAt,
          })
          .then(({ error }) => {
            if (error) {
              logger.error({ error, waId }, 'Erro ao sincronizar mensagem com o Supabase');
            }
          });
      } catch (err) {
        logger.error({ error: err }, 'Erro ao iniciar sincronização com o Supabase');
      }
    }

    return messageId;
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
  getOrCreateContact(waId: string, name?: string, phone?: string): Contact {
    const db = getDatabase();

    const getStmt = db.prepare(
      `SELECT wa_id, name, phone, bot_paused, paused_reason, paused_at, last_seen_at
       FROM contacts
       WHERE wa_id = ?`
    );

    const existing = getStmt.get(waId) as {
      wa_id: string;
      name: string | null;
      phone: string | null;
      bot_paused: number;
      paused_reason: string | null;
      paused_at: number | null;
      last_seen_at: number | null;
    } | undefined;

    if (existing) {
      // Update name/phone if provided and currently unknown
      if ((name && !existing.name) || (phone && !existing.phone)) {
        db.prepare(`UPDATE contacts SET name = COALESCE(?, name), phone = COALESCE(?, phone) WHERE wa_id = ?`)
          .run(name ?? null, phone ?? null, waId);
        if (isSupabaseEnabled()) {
          try {
            getSupabase().from('contacts').update({ name: name ?? existing.name, phone: phone ?? existing.phone }).eq('wa_id', waId)
              .then(({ error }) => { if (error) logger.error({ error, waId }, 'Erro ao atualizar name/phone no Supabase'); });
          } catch {}
        }
      }
      return {
        wa_id: existing.wa_id,
        name: name ?? existing.name,
        phone: phone ?? existing.phone,
        bot_paused: existing.bot_paused === 1,
        paused_reason: existing.paused_reason,
        paused_at: existing.paused_at,
        last_seen_at: existing.last_seen_at,
      };
    }

    // Create new contact
    db.prepare(
      `INSERT INTO contacts (wa_id, name, phone, bot_paused, paused_reason, paused_at, last_seen_at)
       VALUES (?, ?, ?, 0, NULL, NULL, NULL)`
    ).run(waId, name ?? null, phone ?? null);

    // Sincronização em segundo plano com o Supabase
    if (isSupabaseEnabled()) {
      try {
        const supabase = getSupabase();
        supabase
          .from('contacts')
          .upsert({
            wa_id: waId,
            name: name ?? null,
            phone: phone ?? null,
            bot_paused: false,
            paused_reason: null,
            paused_at: null,
            last_seen_at: null,
          })
          .then(({ error }) => {
            if (error) {
              logger.error({ error, waId }, 'Erro ao sincronizar novo contato com o Supabase');
            }
          });
      } catch (err) {
        logger.error({ error: err }, 'Erro ao iniciar sincronização de contato com o Supabase');
      }
    }

    return {
      wa_id: waId,
      name: name ?? null,
      phone: phone ?? null,
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

    // Sincronização em segundo plano com o Supabase
    if (isSupabaseEnabled()) {
      try {
        const supabase = getSupabase();
        supabase
          .from('contacts')
          .update({
            bot_paused: true,
            paused_reason: reason,
            paused_at: pausedAt,
          })
          .eq('wa_id', waId)
          .then(({ error }) => {
            if (error) {
              logger.error({ error, waId }, 'Erro ao sincronizar pausa do bot com o Supabase');
            }
          });
      } catch (err) {
        logger.error({ error: err }, 'Erro ao iniciar sincronização de pausa do bot com o Supabase');
      }
    }
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

    // Sincronização em segundo plano com o Supabase
    if (isSupabaseEnabled()) {
      try {
        const supabase = getSupabase();
        supabase
          .from('contacts')
          .update({
            bot_paused: false,
            paused_reason: null,
            paused_at: null,
          })
          .eq('wa_id', waId)
          .then(({ error }) => {
            if (error) {
              logger.error({ error, waId }, 'Erro ao sincronizar retomada do bot com o Supabase');
            }
          });
      } catch (err) {
        logger.error({ error: err }, 'Erro ao iniciar sincronização de retomada do bot com o Supabase');
      }
    }
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

    // Sincronização em segundo plano com o Supabase
    if (isSupabaseEnabled()) {
      try {
        const supabase = getSupabase();
        supabase
          .from('contacts')
          .update({
            last_seen_at: now,
          })
          .eq('wa_id', waId)
          .then(({ error }) => {
            if (error) {
              logger.error({ error, waId }, 'Erro ao sincronizar visualização com o Supabase');
            }
          });
      } catch (err) {
        logger.error({ error: err }, 'Erro ao iniciar sincronização de visualização com o Supabase');
      }
    }
  }
}
