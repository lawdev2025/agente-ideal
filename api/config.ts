import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "./_lib/cors";
import { config } from "../src/config";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  res.status(200).json({
    SUPABASE_URL: config.database.supabaseUrl || "",
    SUPABASE_ANON_KEY: config.database.supabaseAnonKey || "",
    ADMIN_TOKEN: config.adminToken || "",
  });
}
