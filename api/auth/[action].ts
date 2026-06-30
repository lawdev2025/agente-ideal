// Roteador único de autenticação (1 Serverless Function para 3 rotas).
// /api/auth/login | /api/auth/me | /api/auth/change-password → ?action.
// As URLs do front continuam idênticas; só a estrutura de arquivos mudou para
// caber no limite de funções do plano Hobby da Vercel (≤12).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { login, me, changePassword } from "./_handlers";

export default function handler(req: VercelRequest, res: VercelResponse) {
  const action = (req.query.action as string) || "";
  if (action === "login") return login(req, res);
  if (action === "me") return me(req, res);
  if (action === "change-password") return changePassword(req, res);
  res.status(404).json({ error: "Not found" });
}
