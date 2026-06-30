// Handlers de autenticação reunidos num único módulo (prefixo "_" → NÃO vira
// Serverless Function na Vercel). O roteador é api/auth/[action].ts, que
// despacha por ?action (login | me | change-password). Mantém o limite de
// funções do plano Hobby (≤12) sem mudar nenhuma URL do front.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { getAuthUser } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { hashPassword, verifyPassword } from "../../src/auth/password";
import { signToken } from "../../src/auth/token";
import { logger } from "../../src/logger";

// POST /api/auth/login
export async function login(req: VercelRequest, res: VercelResponse) {
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

// GET /api/auth/me
export async function me(req: VercelRequest, res: VercelResponse) {
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

// POST /api/auth/change-password
export async function changePassword(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  // Obtém o usuário autenticado
  const auth = getAuthUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (auth.uid === "legacy-admin") { res.status(400).json({ error: "Admin legado não troca senha por aqui" }); return; }

  const { currentPassword, newPassword } = (req.body || {}) as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) { res.status(400).json({ error: "Campos obrigatórios" }); return; }
  if (newPassword.length < 6) { res.status(400).json({ error: "A nova senha precisa ter ao menos 6 caracteres" }); return; }
  if (newPassword === currentPassword) { res.status(400).json({ error: "A nova senha deve ser diferente da atual" }); return; }

  try {
    const sb = getSupabase();
    const { data: user } = await sb.from("app_users").select("id, password_hash").eq("id", auth.uid).maybeSingle();
    if (!user || !verifyPassword(currentPassword, (user as any).password_hash)) {
      res.status(400).json({ error: "Senha atual incorreta" });
      return;
    }
    const { error } = await sb.from("app_users")
      .update({ password_hash: hashPassword(newPassword), must_change_password: false, updated_at: Date.now() })
      .eq("id", auth.uid);
    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error({ error }, "Erro em POST /api/auth/change-password");
    res.status(500).json({ error: "Internal error" });
  }
}
