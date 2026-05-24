import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../../../_lib/cors";
import { checkAdminAuth } from "../../../_lib/auth";
import { StateRepository } from "../../../../src/state/repository";
import { logger } from "../../../../src/logger";

const repo = new StateRepository();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "PATCH") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!checkAdminAuth(req, res)) return;

  const wa_id = (req.query.wa_id as string) || "";
  if (!wa_id) {
    res.status(400).json({ error: "wa_id required" });
    return;
  }

  const body = (req.body || {}) as { paused?: boolean };
  if (typeof body.paused !== "boolean") {
    res.status(400).json({ error: "Body must contain { paused: boolean }" });
    return;
  }

  try {
    if (body.paused) {
      await repo.pauseBot(wa_id, "Pausado via painel admin");
    } else {
      await repo.resumeBot(wa_id);
    }
    res.status(200).json({ ok: true, wa_id, bot_paused: body.paused });
  } catch (error) {
    logger.error({ error, wa_id }, "Erro em PATCH /api/admin/contacts/:wa_id/pause");
    res.status(500).json({ error: "Internal error" });
  }
}
