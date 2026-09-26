import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "./_lib/cors";
import { config } from "../src/config";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  // Endpoint PÚBLICO (sem login): só o que o navegador precisa pro Realtime.
  // RAIZ DE BUG (26/09): devolvia também o ADMIN_TOKEN — qualquer pessoa que
  // abrisse este endereço virava admin, e o painel trocava o token da
  // atendente logada por ele. Nunca devolva segredo aqui.
  res.status(200).json({
    SUPABASE_URL: config.database.supabaseUrl || "",
    SUPABASE_ANON_KEY: config.database.supabaseAnonKey || "",
  });
}
