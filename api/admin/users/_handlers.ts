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
const USO = ", last_login_at, last_seen_at";

// Registro de uso por atendente, a partir das mensagens que ELA mandou pelo
// CRM (messages.agent_name = nome do usuário, gravado no POST de resposta).
// "Atendimento" = conversa distinta em que ela respondeu no período.
type Uso = {
  ultima_msg_at: number | null;
  hoje: { atendimentos: number; mensagens: number };
  dias7: { atendimentos: number; mensagens: number };
  dias30: { atendimentos: number; mensagens: number };
};
const USO_VAZIO: Uso = {
  ultima_msg_at: null,
  hoje: { atendimentos: 0, mensagens: 0 },
  dias7: { atendimentos: 0, mensagens: 0 },
  dias30: { atendimentos: 0, mensagens: 0 },
};

// Início do dia em Belém (UTC-3, sem horário de verão).
function inicioDoDiaBelem(now: number): number {
  const TZ = 3 * 3600 * 1000;
  return Math.floor((now - TZ) / 86400000) * 86400000 + TZ;
}

async function usoPorAtendente(sb: ReturnType<typeof getSupabase>): Promise<Map<string, Uso>> {
  const now = Date.now();
  const desde30 = now - 30 * 86400000;
  const desde7 = now - 7 * 86400000;
  const hoje = inicioDoDiaBelem(now);
  const rows: { agent_name: string; wa_id: string; created_at: number }[] = [];
  // Paginado: o PostgREST corta em 1000 linhas por resposta.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("messages")
      .select("agent_name, wa_id, created_at")
      .not("agent_name", "is", null)
      .gte("created_at", desde30)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error || !data || !data.length) break;
    rows.push(...(data as any[]));
    if (data.length < 1000) break;
  }
  const acc = new Map<string, { ultima: number; c: Record<"hoje" | "dias7" | "dias30", { conv: Set<string>; msgs: number }> }>();
  for (const r of rows) {
    let a = acc.get(r.agent_name);
    if (!a) {
      const novo = () => ({ conv: new Set<string>(), msgs: 0 });
      a = { ultima: 0, c: { hoje: novo(), dias7: novo(), dias30: novo() } };
      acc.set(r.agent_name, a);
    }
    const t = Number(r.created_at);
    if (t > a.ultima) a.ultima = t;
    const faixas: ("hoje" | "dias7" | "dias30")[] = ["dias30"];
    if (t >= desde7) faixas.push("dias7");
    if (t >= hoje) faixas.push("hoje");
    for (const f of faixas) { a.c[f].msgs++; a.c[f].conv.add(r.wa_id); }
  }
  const out = new Map<string, Uso>();
  for (const [nome, a] of acc) {
    const fx = (f: "hoje" | "dias7" | "dias30") => ({ atendimentos: a.c[f].conv.size, mensagens: a.c[f].msgs });
    out.set(nome, { ultima_msg_at: a.ultima || null, hoje: fx("hoje"), dias7: fx("dias7"), dias30: fx("dias30") });
  }
  return out;
}

// /api/admin/users — GET lista, POST cria
export async function collection(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (!requireAdmin(req, res)) return;
  const sb = getSupabase();

  if (req.method === "GET") {
    try {
      // Colunas de uso (supabase-app-users-uso.sql). Sem elas o select dá
      // 42703 e caímos no SAFE — a lista aparece, só sem último acesso.
      const comUso = await sb.from("app_users").select(SAFE + USO).order("created_at", { ascending: true });
      const res1 = comUso.error
        ? await sb.from("app_users").select(SAFE).order("created_at", { ascending: true })
        : comUso;
      const users = (res1.data || []) as any[];
      const uso = await usoPorAtendente(sb);
      // "Última resposta" é de TODO o histórico, não só dos 30 dias: quem não
      // responde há mais de um mês aparecia como "—" (nunca respondeu), e é
      // justamente o caso que o admin precisa ver. 1 consulta por usuário.
      await Promise.all(users.map(async (u) => {
        const atual = uso.get(u.name);
        if (atual && atual.ultima_msg_at) return;
        const { data } = await sb.from("messages").select("created_at")
          .eq("agent_name", u.name).order("id", { ascending: false }).limit(1);
        const t = data && data[0] ? Number((data[0] as any).created_at) : null;
        if (t) uso.set(u.name, { ...(atual || USO_VAZIO), ultima_msg_at: t });
      }));
      res.status(200).json({
        users: users.map((u) => ({ ...u, uso: uso.get(u.name) || USO_VAZIO })),
      });
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
