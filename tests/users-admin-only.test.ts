import { describe, it, expect, vi, beforeEach } from "vitest";

// Banco falso: registra se alguém chegou a ler app_users/messages.
const lidas: string[] = [];
vi.mock("../src/db/supabase-client", () => {
  const chain = (table: string) => {
    const q: any = {
      select: () => q, order: () => q, not: () => q, gte: () => q, range: () => q, eq: () => q,
      then: (res: any) => { lidas.push(table); return Promise.resolve({ data: [], error: null }).then(res); },
    };
    return q;
  };
  return { getSupabase: () => ({ from: chain }) };
});

import { collection, item } from "../api/admin/users/_handlers";
import { signToken } from "../src/auth/token";

function fakeRes() {
  const r: any = { statusCode: 0, body: null, headers: {} };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  r.end = () => r;
  return r;
}
function req(method: string, token?: string, id?: string) {
  return {
    method,
    headers: token ? { authorization: "Bearer " + token } : {},
    query: id ? { id: [id] } : {},
    body: {},
  } as any;
}

const atendente = signToken({ uid: "u2", role: "unit", unit: "Batista Campos", name: "Ivane" });
const admin = signToken({ uid: "u1", role: "admin", unit: null, name: "Admin" });

describe("Usuários e registro de uso: SÓ admin", () => {
  beforeEach(() => { lidas.length = 0; });

  it("sem login → 401, nada é lido do banco", async () => {
    const res = fakeRes();
    await collection(req("GET"), res);
    expect(res.statusCode).toBe(401);
    expect(lidas).toEqual([]);
  });

  it("atendente → 403 na lista (com o uso), nada é lido do banco", async () => {
    const res = fakeRes();
    await collection(req("GET", atendente), res);
    expect(res.statusCode).toBe(403);
    expect(lidas).toEqual([]);
  });

  it.each(["POST", "PATCH", "DELETE"])("atendente → 403 em %s (criar/editar/excluir)", async (m) => {
    const res = fakeRes();
    await (m === "POST" ? collection(req(m, atendente), res) : item(req(m, atendente, "u3"), res));
    expect(res.statusCode).toBe(403);
    expect(lidas).toEqual([]);
  });

  it("token adulterado (papel trocado pra admin) → 401", async () => {
    const [p, s] = atendente.split(".");
    const payload = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    const forjado = Buffer.from(JSON.stringify({ ...payload, role: "admin" })).toString("base64url") + "." + s;
    const res = fakeRes();
    await collection(req("GET", forjado), res);
    expect(res.statusCode).toBe(401);
  });

  it("admin → 200 com a lista", async () => {
    const res = fakeRes();
    await collection(req("GET", admin), res);
    expect(res.statusCode).toBe(200);
    expect(lidas).toContain("app_users");
  });
});
