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
    // Tras tambem role/content pra montar o preview da ultima mensagem por
    // contato (a primeira ocorrencia de cada wa_id, ja que vem ordenado desc).
    const { data: distinctMsgs } = await sb
      .from("messages")
      .select("wa_id, role, content, created_at")
      .order("created_at", { ascending: false });

    const { data: existingContacts } = await sb.from("contacts").select("wa_id");
    const existingSet = new Set(
      (existingContacts || []).map((c: any) => c.wa_id)
    );

    const seen = new Set<string>();
    const orphans: { wa_id: string; last_seen_at: number }[] = [];
    // Preview da ultima mensagem visivel (ignora tool/system) por contato.
    const lastMsgMap = new Map<
      string,
      { role: string; content: string; at: any }
    >();
    for (const m of distinctMsgs || []) {
      const wa = (m as any).wa_id;
      const role = (m as any).role;
      if (!lastMsgMap.has(wa) && role !== "tool" && role !== "system") {
        lastMsgMap.set(wa, {
          role,
          content: (m as any).content || "",
          at: (m as any).created_at,
        });
      }
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

    // Anexa o preview da ultima mensagem e a flag "precisa responder" (ultima
    // mensagem foi do cliente). Sinal stateless pro inbox, sem tabela de leitura.
    const enriched = (contacts || []).map((c: any) => {
      const last = lastMsgMap.get(c.wa_id);
      return {
        ...c,
        last_message: last ? last.content : null,
        last_message_role: last ? last.role : null,
        last_message_at: last ? last.at : c.last_seen_at,
        needs_reply: last ? last.role === "user" : false,
      };
    });

    res.status(200).json({ contacts: enriched });
  } catch (error) {
    logger.error({ error }, "Erro em GET /api/admin/contacts");
    res.status(500).json({ error: "Internal error" });
  }
}
