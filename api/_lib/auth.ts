import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config } from "../../src/config";

export function checkAdminAuth(req: VercelRequest, res: VercelResponse): boolean {
  const auth = (req.headers.authorization || "") as string;
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== config.adminToken) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}
