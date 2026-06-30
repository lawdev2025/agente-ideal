import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { getAuthUser } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { logger } from "../../src/logger";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  const auth = getAuthUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }

  // ADMIN_TOKEN legado não tem linha no banco: devolve o admin sintético.
  if (auth.uid === "legacy-admin") {
    res.status(200).json({ user: { id: "legacy-admin", name: "Admin", role: "admin", unit: null, must_change_password: false } });
    return;
  }

  try {
    const sb = getSupabase();
    const { data: user } = await sb.from("app_users").select("id, name, role, unit, must_change_password, active").eq("id", auth.uid).maybeSingle();
    if (!user || !(user as any).active) { res.status(403).json({ error: "Usuário inativo" }); return; }
    const u = user as any;
    res.status(200).json({ user: { id: u.id, name: u.name, role: u.role, unit: u.unit, must_change_password: u.must_change_password } });
  } catch (error) {
    logger.error({ error }, "Erro em GET /api/auth/me");
    res.status(500).json({ error: "Internal error" });
  }
}
