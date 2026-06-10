import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { checkAdminAuth } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { logger } from "../../src/logger";
import { LearningRepository } from "../../src/learning/repository";

// Cache em memória do payload de stats. Vive enquanto a function está "warm"
// (singleton por módulo no Vercel). Métricas de dashboard toleram ~30s de
// atraso, e isso corta o recomputo em aberturas/refreshes repetidos.
const STATS_TTL_MS = 30_000;
let statsCache: { at: number; payload: any } | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!checkAdminAuth(req, res)) return;

  if (statsCache && Date.now() - statsCache.at < STATS_TTL_MS) {
    res.setHeader("X-Cache", "HIT");
    res.status(200).json(statsCache.payload);
    return;
  }

  try {
    const sb = getSupabase();
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;

    const [
      { count: totalMessages },
      { count: totalContacts },
      { count: activeContacts },
      { count: escalations },
      { count: escalationMessages },
      uniqueUsersRes,
      subjectsRes,
    ] = await Promise.all([
      sb.from("messages").select("*", { count: "exact", head: true }),
      sb.from("contacts").select("*", { count: "exact", head: true }),
      sb.from("contacts").select("*", { count: "exact", head: true }).gte("last_seen_at", cutoff24h),
      sb.from("contacts").select("*", { count: "exact", head: true }).eq("bot_paused", true),
      sb
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("role", "tool")
        .like("content", "%escalate_to_specialist%"),
      // Agregações no Postgres em vez de trazer todas as msgs de usuário pro Node.
      // Ver public/admin/supabase-stats-rpc.sql.
      sb.rpc("stats_unique_users_7d"),
      sb.rpc("stats_subjects"),
    ]);

    const inactiveContacts = (totalContacts ?? 0) - (activeContacts ?? 0);

    // Métricas do cache aprendido de intenções. Best-effort: se a tabela ainda
    // não existe (migração não rodada), zera tudo em vez de quebrar o dashboard.
    let learning = {
      activeIntents: 0,
      candidateIntents: 0,
      totalCacheHits: 0,
      learnedThisWeek: 0,
    };
    try {
      learning = await new LearningRepository().metrics();
    } catch (err) {
      logger.warn({ err }, "Métricas de aprendizado indisponíveis (migração pendente?)");
    }

    const dayLabels = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

    // Topic buckets — ordem/chaves fixas pro gráfico renderizar consistente.
    const subjects: Record<string, number> = {
      "Mensalidades / Valores": 0,
      "Matrículas & Vagas": 0,
      "Materiais / Livros": 0,
      "Contatos / Secretaria": 0,
      "Horários & Grade": 0,
      "Outras dúvidas": 0,
    };

    let days: string[] = [];
    let msgCounts: number[] = [];

    // Caminho rápido: as RPCs (supabase-stats-rpc.sql) já devolvem os agregados.
    if (!uniqueUsersRes.error && !subjectsRes.error) {
      for (const row of (uniqueUsersRes.data || []) as any[]) {
        // row.day vem como 'YYYY-MM-DD' (date). Monta label "seg 5".
        const d = new Date(`${row.day}T00:00:00`);
        days.push(`${dayLabels[d.getDay()]} ${d.getDate()}`);
        msgCounts.push(Number(row.unique_users) || 0);
      }
      for (const row of (subjectsRes.data || []) as any[]) {
        if (row.subject in subjects) subjects[row.subject] = Number(row.total) || 0;
      }
    } else {
      // Fallback: migração não rodada. Recalcula em JS (carrega as msgs de user).
      logger.warn(
        { uniqueErr: uniqueUsersRes.error, subjErr: subjectsRes.error },
        "RPCs de stats indisponíveis — usando fallback (rode supabase-stats-rpc.sql)"
      );
      const { data: userMsgs } = await sb
        .from("messages")
        .select("content, created_at, wa_id")
        .eq("role", "user");

      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const start = new Date(d);
        start.setHours(0, 0, 0, 0);
        const end = new Date(d);
        end.setHours(23, 59, 59, 999);
        days.push(`${dayLabels[d.getDay()]} ${d.getDate()}`);
        const uniqueUsers = new Set<string>();
        for (const m of userMsgs || []) {
          const ts = (m as any).created_at;
          if (ts >= start.getTime() && ts <= end.getTime()) {
            const id = (m as any).wa_id;
            if (id) uniqueUsers.add(id);
          }
        }
        msgCounts.push(uniqueUsers.size);
      }
      for (const m of userMsgs || []) {
        const t = ((m as any).content || "").toLowerCase();
        if (/mensal|pre[çc]o|valor|pagamento|custo/.test(t))
          subjects["Mensalidades / Valores"]++;
        else if (/matr[íi]cula|vaga|inscri[çc][ãa]o|inscrever/.test(t))
          subjects["Matrículas & Vagas"]++;
        else if (/material|livro|apostila|caderno/.test(t))
          subjects["Materiais / Livros"]++;
        else if (/contato|telefone|whatsapp|secretaria|falar com/.test(t))
          subjects["Contatos / Secretaria"]++;
        else if (/hor[áa]rio|aula|grade|calend[áa]rio/.test(t))
          subjects["Horários & Grade"]++;
        else subjects["Outras dúvidas"]++;
      }
    }

    const payload = {
      totalMessages: totalMessages ?? 0,
      totalContacts: totalContacts ?? 0,
      activeContacts: activeContacts ?? 0,
      inactiveContacts,
      escalations: escalations ?? 0,
      escalationMessages: escalationMessages ?? 0,
      days,
      msgCounts,
      subjects,
      learning,
    };
    statsCache = { at: Date.now(), payload };
    res.setHeader("X-Cache", "MISS");
    res.status(200).json(payload);
  } catch (error) {
    logger.error({ error }, "Erro em GET /api/admin/stats");
    res.status(500).json({ error: "Internal error" });
  }
}
