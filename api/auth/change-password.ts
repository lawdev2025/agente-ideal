import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { getAuthUser } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { hashPassword, verifyPassword } from "../../src/auth/password";
import { logger } from "../../src/logger";

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
