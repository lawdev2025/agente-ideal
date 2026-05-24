import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../../../_lib/cors";
import { checkAdminAuth } from "../../../_lib/auth";
import { getSupabase } from "../../../../src/db/supabase-client";
import { logger } from "../../../../src/logger";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!checkAdminAuth(req, res)) return;

  const wa_id = (req.query.wa_id as string) || "";
  if (!wa_id) {
    res.status(400).json({ error: "wa_id required" });
    return;
  }

  try {
    const sb = getSupabase();
    const { data } = await sb
      .from("messages")
      .select("id, wa_id, role, content, created_at")
      .eq("wa_id", wa_id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    res.status(200).json({ messages: data || [] });
  } catch (error) {
    logger.error({ error, wa_id }, "Erro em GET /api/admin/contacts/:wa_id/messages");
    res.status(500).json({ error: "Internal error" });
  }
}
