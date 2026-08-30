import type { VercelRequest, VercelResponse } from "@vercel/node";
import classifyTopics from "./_classify-topics";
import temperature from "./_temperature";

/**
 * Roteador dos jobs agendados: UMA função servindo /api/jobs/*.
 *
 * Por que assim: o plano Hobby da Vercel permite no máximo 12 Serverless
 * Functions por deploy, e o projeto já estava exatamente no limite — o job de
 * temperatura seria o 13º e derrubava o build inteiro. Como rota dinâmica,
 * `[job].ts` conta como UMA função e atende os dois caminhos, então dá pra
 * adicionar job novo daqui pra frente sem gastar cota nenhuma.
 *
 * Os arquivos com prefixo `_` NÃO viram função (mesma convenção já usada em
 * api/_lib/ e nos _handlers.ts) — são só módulos que este aqui importa.
 *
 * As URLs continuam idênticas: /api/jobs/classify-topics e
 * /api/jobs/temperature. Cada job cuida do próprio CORS e da própria
 * autorização, exatamente como antes.
 */
const JOBS: Record<
  string,
  (req: VercelRequest, res: VercelResponse) => Promise<void>
> = {
  "classify-topics": classifyTopics,
  temperature: temperature,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const job = String(req.query.job || "");
  const run = JOBS[job];
  if (!run) {
    res.status(404).json({ error: "Job desconhecido", jobs: Object.keys(JOBS) });
    return;
  }
  return run(req, res);
}
