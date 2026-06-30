// Handlers de usuários reunidos (prefixo "_" → NÃO vira Serverless Function).
// O roteador é api/admin/users/[[...id]].ts: sem id → coleção (GET lista /
// POST cria); com id → item (PATCH edita/reseta / DELETE soft-delete).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../../_lib/cors";
import { requireAdmin } from "../../_lib/auth";
import { getSupabase } from "../../../src/db/supabase-client";
import { hashPassword } from "../../../src/auth/password";
import { logger } from "../../../src/logger";

const SAFE = "id, name, login, email, role, unit, must_change_password, active, created_at, updated_at";

// /api/admin/users — GET lista, POST cria
export async function collection(req: VercelRequest, res: VercelResponse) {
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

// /api/admin/users/:id — PATCH edita/reseta senha, DELETE soft-delete
export async function item(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (!requireAdmin(req, res)) return;
  // Sob [[...id]] o id chega como array (['<uuid>']); normaliza pra string.
  const raw = req.query.id;
  const id = (Array.isArray(raw) ? raw[0] : raw) || "";
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
