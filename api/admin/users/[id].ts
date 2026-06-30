// api/admin/users/[id].ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../../_lib/cors";
import { requireAdmin } from "../../_lib/auth";
import { getSupabase } from "../../../src/db/supabase-client";
import { hashPassword } from "../../../src/auth/password";
import { logger } from "../../../src/logger";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (!requireAdmin(req, res)) return;
  const id = (req.query.id as string) || "";
  if (!id) { res.status(400).json({ error: "id required" }); return; }
  const sb = getSupabase();

  if (req.method === "PATCH") {
    const b = (req.body || {}) as any;
    const patch: any = { updated_at: Date.now() };
    if (typeof b.name === "string") patch.name = b.name;
    if (typeof b.login === "string") patch.login = b.login.trim().toLowerCase();
    if (typeof b.email === "string") patch.email = b.email || null;
    if (b.role === "admin" || b.role === "unit") patch.role = b.role;
    if (typeof b.unit === "string" || b.unit === null) patch.unit = b.unit;
    if (typeof b.active === "boolean") patch.active = b.active;
    if (typeof b.resetPassword === "string" && b.resetPassword.length >= 6) {
      patch.password_hash = hashPassword(b.resetPassword);
      patch.must_change_password = true;
    }
    try {
      const { error } = await sb.from("app_users").update(patch).eq("id", id);
      if (error) { res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "Login já existe" : "Erro ao editar" }); return; }
      res.status(200).json({ ok: true });
    } catch (error) { logger.error({ error }, "PATCH user"); res.status(500).json({ error: "Internal error" }); }
    return;
  }

  if (req.method === "DELETE") {
    try {
      // Não desativa o último admin ativo.
      const { data: target } = await sb.from("app_users").select("role").eq("id", id).maybeSingle();
      if ((target as any)?.role === "admin") {
        const { count } = await sb.from("app_users").select("*", { count: "exact", head: true }).eq("role", "admin").eq("active", true);
        if ((count ?? 0) <= 1) { res.status(409).json({ error: "Não dá pra remover o último admin" }); return; }
      }
      const { error } = await sb.from("app_users").update({ active: false, updated_at: Date.now() }).eq("id", id);
      if (error) throw error;
      res.status(200).json({ ok: true });
    } catch (error) { logger.error({ error }, "DELETE user"); res.status(500).json({ error: "Internal error" }); }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
