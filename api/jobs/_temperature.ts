import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { checkAdminAuth } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { config as appConfig } from "../../src/config";
import { StateRepository } from "../../src/state/repository";
import { WhatsAppClient } from "../../src/whatsapp/client";
import {
  COLD_AFTER_MS,
  FOLLOWUP_MESSAGES,
  nextFollowupStage,
} from "../../src/kb/contact-temperature";
import { logger } from "../../src/logger";

/**
 * Job de TEMPERATURA + FOLLOW-UP. Roda de hora em hora.
 *
 * Duas etapas, nesta ordem (a segunda depende da primeira):
 *   1. recompute_contact_temperature() — carimba quente/morno/frio em todo
 *      mundo, set-based no Postgres.
 *   2. follow-up dos FRIOS — 1º empurrão com 1h de silêncio, 2º 22h depois.
 *      Só frio recebe: quente e morno já engajaram e merecem uma pessoa.
 *
 * Por que job e não webhook: a temperatura é definida pelo SILÊNCIO, e
 * silêncio não gera evento. Ninguém "manda" uma mensagem de que parou.
 *
 * Disparado pelo GitHub Actions (.github/workflows/followup.yml) com o
 * CRON_SECRET, ou manualmente com o admin token. `?dry=1` calcula e mostra
 * quem receberia, sem mandar nada — use isso na primeira rodada.
 */

// Singletons por warm function (mesmo padrão do webhook).
const repo = new StateRepository();
const whatsapp = new WhatsAppClient(
  appConfig.whatsapp.accessToken,
  appConfig.whatsapp.phoneNumberId,
  appConfig.whatsapp.businessAccountId
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Autoriza por CRON_SECRET (agendador) OU admin token (execução manual).
  const cronSecret = process.env.CRON_SECRET;
  const auth = (req.headers.authorization || "") as string;
  const cronOk = !!cronSecret && auth === `Bearer ${cronSecret}`;
  if (!cronOk && !checkAdminAuth(req, res)) return;

  const dryRun = req.query.dry === "1" || req.query.dry === "true";
  const now = Date.now();

  try {
    const sb = getSupabase();

    // ── 1. Recalcula a temperatura de todos os contatos ────────────────
    const { data: tally, error: tempErr } = await sb.rpc(
      "recompute_contact_temperature",
      { cold_after_ms: COLD_AFTER_MS }
    );
    if (tempErr) {
      logger.warn(
        { error: tempErr },
        "temperature: RPC indisponível (rode supabase-contact-temperature.sql)"
      );
      res.status(200).json({ ok: false, reason: "rpc_unavailable", sent: 0 });
      return;
    }

    // ── 2. Follow-up dos frios ─────────────────────────────────────────
    const { data: candidates, error: candErr } = await sb.rpc(
      "followup_candidates",
      { max_rows: 50 }
    );
    if (candErr) {
      logger.warn({ error: candErr }, "temperature: followup_candidates falhou");
      res.status(200).json({ ok: true, tally, sent: 0, reason: "candidates_failed" });
      return;
    }

    let sent = 0;
    const planned: Array<{ wa_id: string; stage: number; sent: boolean }> = [];

    for (const c of (candidates || []) as any[]) {
      const stage = nextFollowupStage(
        {
          temperature: "frio", // a RPC já filtrou por temperature='frio'
          botPaused: !!c.bot_paused,
          lastUserAt: Number(c.last_user_at),
          lastAt: Number(c.last_at),
          followupStage: Number(c.followup_stage) || 0,
          followupAt: c.followup_at == null ? null : Number(c.followup_at),
        },
        now
      );
      if (!stage) continue;

      if (dryRun) {
        planned.push({ wa_id: c.wa_id, stage, sent: false });
        continue;
      }

      const text = FOLLOWUP_MESSAGES[stage];
      try {
        await whatsapp.sendMessage(c.wa_id, text);
      } catch (err) {
        // Fora da janela de 24h a Meta recusa. Não é erro do job: só registra e
        // segue, sem bumpar o estágio (o contato continua elegível se voltar).
        logger.warn({ err, wa_id: c.wa_id, stage }, "temperature: envio recusado");
        planned.push({ wa_id: c.wa_id, stage, sent: false });
        continue;
      }

      // Grava no histórico pra aparecer na conversa do painel, igual a
      // qualquer resposta do bot.
      await repo.appendMessage(c.wa_id, "assistant", text);
      await repo.setFollowupStage(c.wa_id, stage, now);
      sent++;
      planned.push({ wa_id: c.wa_id, stage, sent: true });
    }

    logger.info({ tally: tally?.[0], sent, dryRun }, "temperature concluído");
    res.status(200).json({
      ok: true,
      dryRun,
      tally: tally?.[0] ?? null,
      candidates: (candidates || []).length,
      sent,
      planned,
    });
  } catch (error) {
    logger.error({ error }, "Erro em /api/jobs/temperature");
    res.status(500).json({ error: "Internal error" });
  }
}
