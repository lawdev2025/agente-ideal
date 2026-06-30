import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

export type TokenPayload = {
  uid: string;
  role: "admin" | "unit";
  unit: string | null;
  name: string;
  iat: number;
  exp: number;
};

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function secret(): string {
  return process.env.AUTH_SECRET || config.adminToken || "dev-insecure-secret";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(data: string): string {
  return b64url(createHmac("sha256", secret()).update(data).digest());
}

export function signToken(
  data: { uid: string; role: "admin" | "unit"; unit: string | null; name: string },
  ttlMs: number = DEFAULT_TTL_MS
): string {
  const now = Date.now();
  const payload: TokenPayload = { ...data, iat: now, exp: now + ttlMs };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as TokenPayload;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
