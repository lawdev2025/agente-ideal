import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config } from "../../src/config";
import { verifyToken } from "../../src/auth/token";

export type AuthUser = {
  uid: string;
  role: "admin" | "unit";
  unit: string | null;
  name: string;
};

function bearer(req: VercelRequest): string {
  const auth = (req.headers.authorization || "") as string;
  return auth.replace(/^Bearer\s+/i, "").trim();
}

export function getAuthUser(req: VercelRequest): AuthUser | null {
  const token = bearer(req);
  if (!token) return null;
  // ADMIN_TOKEN legado → admin sintético (mantém bot/ferramentas e emergência).
  if (config.adminToken && token === config.adminToken) {
    return { uid: "legacy-admin", role: "admin", unit: null, name: "Admin" };
  }
  const p = verifyToken(token);
  if (!p) return null;
  return { uid: p.uid, role: p.role, unit: p.unit, name: p.name };
}

export function requireUser(req: VercelRequest, res: VercelResponse): AuthUser | null {
  const u = getAuthUser(req);
  if (!u) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return u;
}

export function requireAdmin(req: VercelRequest, res: VercelResponse): AuthUser | null {
  const u = getAuthUser(req);
  if (!u) { res.status(401).json({ error: "Unauthorized" }); return null; }
  if (u.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return null; }
  return u;
}

// Compat: handlers antigos chamam checkAdminAuth e seguem se true.
export function checkAdminAuth(req: VercelRequest, res: VercelResponse): boolean {
  return requireUser(req, res) !== null;
}
