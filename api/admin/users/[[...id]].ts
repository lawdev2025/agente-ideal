// Roteador único de usuários (1 Serverless Function para coleção + item).
// /api/admin/users          → coleção (sem id)
// /api/admin/users/:id      → item (id presente)
// URLs do front inalteradas; consolidado para caber no limite Hobby (≤12).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { collection, item } from "./_handlers";

export default function handler(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.id;
  const hasId = Array.isArray(raw) ? raw.length > 0 : !!raw;
  return hasId ? item(req, res) : collection(req, res);
}
