import { describe, it, expect, vi } from "vitest";
vi.mock("../src/config", () => ({ config: { adminToken: "LEGACY" } }));
import { getAuthUser } from "../api/_lib/auth";
import { signToken } from "../src/auth/token";

function reqWith(auth?: string): any { return { headers: auth ? { authorization: auth } : {} }; }

describe("getAuthUser", () => {
  it("aceita token assinado de unit", () => {
    const t = signToken({ uid: "u1", role: "unit", unit: "AM", name: "Eli" });
    const u = getAuthUser(reqWith("Bearer " + t));
    expect(u?.role).toBe("unit");
    expect(u?.unit).toBe("AM");
  });
  it("aceita ADMIN_TOKEN legado como admin", () => {
    const u = getAuthUser(reqWith("Bearer LEGACY"));
    expect(u?.role).toBe("admin");
  });
  it("rejeita sem header", () => {
    expect(getAuthUser(reqWith())).toBeNull();
  });
  it("rejeita token inválido", () => {
    expect(getAuthUser(reqWith("Bearer xxx"))).toBeNull();
  });
});
