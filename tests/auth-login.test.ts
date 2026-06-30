import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashPassword } from "../src/auth/password";

let ROW: any = null;
vi.mock("../src/db/supabase-client", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ROW }) }) }) }),
    }),
  }),
}));
vi.mock("../api/_lib/cors", () => ({ applyCors: () => true }));

import { login as handler } from "../api/auth/_handlers";

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}

describe("POST /api/auth/login", () => {
  beforeEach(() => { ROW = null; });
  it("loga com senha correta", async () => {
    ROW = { id: "1", name: "Admin", login: "admin", role: "admin", unit: null, must_change_password: false, active: true, password_hash: hashPassword("Ideal@2090") };
    const res = mockRes();
    await handler({ method: "POST", body: { login: "admin", password: "Ideal@2090" }, headers: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe("admin");
    expect(res.body.user.password_hash).toBeUndefined();
  });
  it("recusa senha errada", async () => {
    ROW = { id: "1", name: "Admin", login: "admin", role: "admin", unit: null, must_change_password: false, active: true, password_hash: hashPassword("Ideal@2090") };
    const res = mockRes();
    await handler({ method: "POST", body: { login: "admin", password: "x" }, headers: {} } as any, res);
    expect(res.statusCode).toBe(401);
  });
  it("recusa usuário inexistente", async () => {
    const res = mockRes();
    await handler({ method: "POST", body: { login: "nao", password: "x" }, headers: {} } as any, res);
    expect(res.statusCode).toBe(401);
  });
});
