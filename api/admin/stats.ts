import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { checkAdminAuth } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { logger } from "../../src/logger";
import { LearningRepository } from "../../src/learning/repository";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!checkAdminAuth(req, res)) return;

  try {
    const sb = getSupabase();
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;

    const [
      { count: totalMessages },
      { count: totalContacts },
      { count: activeContacts },
      { count: escalations },
      { count: escalationMessages },
      { data: userMsgs },
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
      sb.from("messages").select("content, created_at, wa_id").eq("role", "user"),
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

    // Últimos 7 dias: contagem de USUÁRIOS ÚNICOS por dia (não de mensagens).
    // Cada dia conta cada wa_id no máximo uma vez, mesmo que ele mande 50 msgs.
    const days: string[] = [];
    const msgCounts: number[] = [];
    const dayLabels = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
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

    // Topic buckets
    const subjects: Record<string, number> = {
      "Mensalidades / Valores": 0,
      "Matrículas & Vagas": 0,
      "Materiais / Livros": 0,
      "Contatos / Secretaria": 0,
      "Horários & Grade": 0,
      "Outras dúvidas": 0,
    };
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

    res.status(200).json({
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
    });
  } catch (error) {
    logger.error({ error }, "Erro em GET /api/admin/stats");
    res.status(500).json({ error: "Internal error" });
  }
}
