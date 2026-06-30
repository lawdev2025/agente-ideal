import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashPassword } from "../src/auth/password";
import { signToken } from "../src/auth/token";

let ROW: any = null;
let UPDATED: any = null;
vi.mock("../src/db/supabase-client", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ROW }) }) }),
      update: (vals: any) => ({ eq: async () => { UPDATED = vals; return { error: null }; } }),
    }),
  }),
}));
vi.mock("../api/_lib/cors", () => ({ applyCors: () => true }));
vi.mock("../src/config", () => ({ config: { adminToken: "LEGACY" } }));

import { changePassword as handler } from "../api/auth/_handlers";

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}
const token = signToken({ uid: "u1", role: "unit", unit: "AM", name: "Eli" });

describe("POST /api/auth/change-password", () => {
  beforeEach(() => { ROW = { id: "u1", password_hash: hashPassword("senha123") }; UPDATED = null; });
  it("troca a senha com a atual correta", async () => {
    const res = mockRes();
    await handler({ method: "POST", headers: { authorization: "Bearer " + token }, body: { currentPassword: "senha123", newPassword: "novaSenha9" } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(UPDATED.must_change_password).toBe(false);
    expect(typeof UPDATED.password_hash).toBe("string");
  });
  it("recusa senha atual errada", async () => {
    const res = mockRes();
    await handler({ method: "POST", headers: { authorization: "Bearer " + token }, body: { currentPassword: "errada", newPassword: "novaSenha9" } } as any, res);
    expect(res.statusCode).toBe(400);
  });
  it("recusa nova senha curta", async () => {
    const res = mockRes();
    await handler({ method: "POST", headers: { authorization: "Bearer " + token }, body: { currentPassword: "senha123", newPassword: "123" } } as any, res);
    expect(res.statusCode).toBe(400);
  });
  it("recusa sem token", async () => {
    const res = mockRes();
    await handler({ method: "POST", headers: {}, body: { currentPassword: "senha123", newPassword: "novaSenha9" } } as any, res);
    expect(res.statusCode).toBe(401);
  });
});
