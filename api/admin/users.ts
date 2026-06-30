// api/admin/users.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { requireAdmin } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { hashPassword } from "../../src/auth/password";
import { logger } from "../../src/logger";

const SAFE = "id, name, login, email, role, unit, must_change_password, active, created_at, updated_at";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (!requireAdmin(req, res)) return;
  const sb = getSupabase();

  if (req.method === "GET") {
    try {
      const { data } = await sb.from("app_users").select(SAFE).order("created_at", { ascending: true });
      res.status(200).json({ users: data || [] });
    } catch (error) { logger.error({ error }, "GET users"); res.status(500).json({ error: "Internal error" }); }
    return;
  }

  if (req.method === "POST") {
    const b = (req.body || {}) as any;
    const login = (b.login || "").trim().toLowerCase();
    if (!b.name || !login || !b.password || !b.role) { res.status(400).json({ error: "name, login, password e role obrigatórios" }); return; }
    if (b.role === "unit" && !b.unit) { res.status(400).json({ error: "unidade obrigatória para papel unit" }); return; }
    try {
      const now = Date.now();
      const { data, error } = await sb.from("app_users").insert({
        name: b.name, login, email: b.email || null, password_hash: hashPassword(b.password),
        role: b.role, unit: b.role === "unit" ? b.unit : null, must_change_password: true,
        active: true, created_at: now, updated_at: now,
      }).select(SAFE).single();
      if (error) { res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "Login já existe" : "Erro ao criar" }); return; }
      res.status(201).json({ user: data });
    } catch (error) { logger.error({ error }, "POST users"); res.status(500).json({ error: "Internal error" }); }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
