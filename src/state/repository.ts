import { getSupabase } from "../db/supabase-client";
import { logger } from "../logger";

export interface Message {
  id: number;
  wa_id: string;
  role: "user" | "assistant" | "system" | "tool";
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
  async appendMessage(
    waId: string,
    role: "user" | "assistant" | "system" | "tool",
    content: string
  ): Promise<number> {
    const supabase = getSupabase();
    const createdAt = Date.now();
    const { data, error } = await supabase
      .from("messages")
      .insert({ wa_id: waId, role, content, created_at: createdAt })
      .select("id")
      .single();
    if (error) {
      logger.error({ error, waId }, "Erro ao inserir mensagem no Supabase");
      throw error;
    }
    return data.id as number;
  }

  async getHistory(waId: string, limit: number = 10): Promise<Message[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("messages")
      .select("id, wa_id, role, content, created_at")
      .eq("wa_id", waId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) {
      logger.error({ error, waId }, "Erro ao buscar historico no Supabase");
      throw error;
    }
    return ((data || []) as Message[]).reverse();
  }

  async getOrCreateContact(
    waId: string,
    name?: string,
    phone?: string
  ): Promise<Contact> {
    const supabase = getSupabase();
    const { data: existing } = await supabase
      .from("contacts")
      .select("*")
      .eq("wa_id", waId)
      .maybeSingle();

    if (existing) {
      if ((name && !existing.name) || (phone && !existing.phone)) {
        const patch: Record<string, unknown> = {};
        if (name && !existing.name) patch.name = name;
        if (phone && !existing.phone) patch.phone = phone;
        const { data: updated } = await supabase
          .from("contacts")
          .update(patch)
          .eq("wa_id", waId)
          .select()
          .single();
        return this.normalize(updated || existing);
      }
      return this.normalize(existing);
    }

    const { data: inserted, error } = await supabase
      .from("contacts")
      .insert({
        wa_id: waId,
        name: name ?? null,
        phone: phone ?? null,
        bot_paused: false,
      })
      .select()
      .single();
    if (error) {
      logger.error({ error, waId }, "Erro ao criar contato no Supabase");
      throw error;
    }
    return this.normalize(inserted);
  }

  async pauseBot(waId: string, reason: string): Promise<void> {
    const supabase = getSupabase();
    await this.getOrCreateContact(waId);
    const { error } = await supabase
      .from("contacts")
      .update({
        bot_paused: true,
        paused_reason: reason,
        paused_at: Date.now(),
      })
      .eq("wa_id", waId);
    if (error) {
      logger.error({ error, waId }, "Erro ao pausar bot no Supabase");
      throw error;
    }
  }

  async resumeBot(waId: string): Promise<void> {
    const supabase = getSupabase();
    await this.getOrCreateContact(waId);
    const { error } = await supabase
      .from("contacts")
      .update({ bot_paused: false, paused_reason: null, paused_at: null })
      .eq("wa_id", waId);
    if (error) {
      logger.error({ error, waId }, "Erro ao retomar bot no Supabase");
      throw error;
    }
  }

  async isBotPaused(waId: string): Promise<boolean> {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("contacts")
      .select("bot_paused")
      .eq("wa_id", waId)
      .maybeSingle();
    return !!data?.bot_paused;
  }

  async updateLastSeen(waId: string): Promise<void> {
    const supabase = getSupabase();
    await this.getOrCreateContact(waId);
    const { error } = await supabase
      .from("contacts")
      .update({ last_seen_at: Date.now() })
      .eq("wa_id", waId);
    if (error) {
      logger.error({ error, waId }, "Erro ao atualizar last_seen no Supabase");
    }
  }

  private normalize(row: any): Contact {
    return {
      wa_id: row.wa_id,
      name: row.name ?? null,
      phone: row.phone ?? null,
      bot_paused: !!row.bot_paused,
      paused_reason: row.paused_reason ?? null,
      paused_at: row.paused_at ?? null,
      last_seen_at: row.last_seen_at ?? null,
    };
  }
}
