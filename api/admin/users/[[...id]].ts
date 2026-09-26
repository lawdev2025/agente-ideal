// Roteador único de usuários (1 Serverless Function para coleção + item).
// /api/admin/users          → coleção (sem id)
// /api/admin/users/:id      → item (id presente)
// URLs do front inalteradas; consolidado para caber no limite Hobby (≤12).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { collection, item } from "./_handlers";

// RAIZ DE BUG (26/09): na Vercel o [[...id]] NÃO casa o caminho sem id —
// GET /api/admin/users dava 404 e a aba Usuários nunca carregou em produção.
// O vercel.json reescreve /api/admin/users → /api/admin/users/list, e "list"
// aqui é a coleção (id de usuário é uuid, nunca "list").
export default function handler(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.id;
  const first = Array.isArray(raw) ? raw[0] : raw;
  const hasId = !!first && first !== "list";
  return hasId ? item(req, res) : collection(req, res);
}
