import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { checkAdminAuth } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { logger } from "../../src/logger";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!checkAdminAuth(req, res)) return;

  try {
    const sb = getSupabase();

    // Backfill: cria contact rows para wa_ids que existem em messages mas
    // nao em contacts (usuarios antigos antes do auto-create no webhook).
    const { data: distinctMsgs } = await sb
      .from("messages")
      .select("wa_id, created_at")
      .order("created_at", { ascending: false });

    const { data: existingContacts } = await sb.from("contacts").select("wa_id");
    const existingSet = new Set(
      (existingContacts || []).map((c: any) => c.wa_id)
    );

    const seen = new Set<string>();
    const orphans: { wa_id: string; last_seen_at: number }[] = [];
    for (const m of distinctMsgs || []) {
      const wa = (m as any).wa_id;
      if (seen.has(wa)) continue;
      seen.add(wa);
      if (!existingSet.has(wa)) {
        orphans.push({ wa_id: wa, last_seen_at: (m as any).created_at });
      }
    }
    if (orphans.length > 0) {
      await sb.from("contacts").insert(
        orphans.map((o) => ({
          wa_id: o.wa_id,
          name: null,
          phone: null,
          bot_paused: false,
          last_seen_at: o.last_seen_at,
        }))
      );
    }

    const { data: contacts } = await sb
      .from("contacts")
      .select("wa_id, name, phone, bot_paused, paused_reason, paused_at, last_seen_at")
      .order("last_seen_at", { ascending: false, nullsFirst: false });

    res.status(200).json({ contacts: contacts || [] });
  } catch (error) {
    logger.error({ error }, "Erro em GET /api/admin/contacts");
    res.status(500).json({ error: "Internal error" });
  }
}
