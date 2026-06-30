import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { getSupabase } from "../../src/db/supabase-client";
import { verifyPassword } from "../../src/auth/password";
import { signToken } from "../../src/auth/token";
import { logger } from "../../src/logger";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const { login, password } = (req.body || {}) as { login?: string; password?: string };
  const id = (login || "").trim().toLowerCase();
  if (!id || !password) { res.status(400).json({ error: "login e password obrigatórios" }); return; }

  try {
    const sb = getSupabase();
    const { data: user } = await sb
      .from("app_users")
      .select("*")
      .eq("login", id)
      .eq("active", true)
      .maybeSingle();

    if (!user || !verifyPassword(password, (user as any).password_hash)) {
      res.status(401).json({ error: "Login ou senha inválidos" });
      return;
    }

    const u = user as any;
    const token = signToken({ uid: u.id, role: u.role, unit: u.unit, name: u.name });
    res.status(200).json({
      token,
      user: { id: u.id, name: u.name, role: u.role, unit: u.unit, must_change_password: u.must_change_password },
    });
  } catch (error) {
    logger.error({ error }, "Erro em POST /api/auth/login");
    res.status(500).json({ error: "Internal error" });
  }
}
