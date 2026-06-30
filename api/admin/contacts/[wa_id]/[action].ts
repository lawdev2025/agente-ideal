// Roteador único por contato (1 Serverless Function para messages + pause).
// /api/admin/contacts/:wa_id/messages | /api/admin/contacts/:wa_id/pause
// As URLs do front continuam idênticas; consolidado p/ caber no limite Hobby.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { messages, pause } from "./_handlers";

export default function handler(req: VercelRequest, res: VercelResponse) {
  const action = (req.query.action as string) || "";
  if (action === "messages") return messages(req, res);
  if (action === "pause") return pause(req, res);
  res.status(404).json({ error: "Not found" });
}
