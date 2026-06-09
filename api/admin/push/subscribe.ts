import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../../_lib/cors";
import { checkAdminAuth } from "../../_lib/auth";
import { getSupabase } from "../../../src/db/supabase-client";
import { logger } from "../../../src/logger";

// CRM IDEAL — registra/remove a inscricao de Web Push do dispositivo.
// POST   { endpoint, keys: { p256dh, auth } }  -> upsert
// DELETE { endpoint }                          -> remove (ex.: usuario desligou)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (!checkAdminAuth(req, res)) return;

  const body = (req.body || {}) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  const endpoint = (body.endpoint || "").trim();

  if (!endpoint) {
    res.status(400).json({ error: "endpoint required" });
    return;
  }

  try {
    const sb = getSupabase();

    if (req.method === "DELETE") {
      await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
      res.status(200).json({ ok: true, removed: true });
      return;
    }

    if (req.method === "POST") {
      const p256dh = body.keys?.p256dh || "";
      const auth = body.keys?.auth || "";
      if (!p256dh || !auth) {
        res.status(400).json({ error: "keys.p256dh and keys.auth required" });
        return;
      }
      const { error } = await sb.from("push_subscriptions").upsert(
        {
          endpoint,
          p256dh,
          auth,
          user_agent: (req.headers["user-agent"] as string) || null,
        },
        { onConflict: "endpoint" }
      );
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    logger.error({ error }, "Erro em /api/admin/push/subscribe");
    res.status(500).json({ error: "Internal error" });
  }
}
