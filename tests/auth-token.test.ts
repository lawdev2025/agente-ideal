import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "../src/auth/token";

const base = { uid: "u1", role: "unit" as const, unit: "AM", name: "Elizangela" };

describe("session token", () => {
  it("assina e valida um token", () => {
    const t = signToken(base);
    const p = verifyToken(t);
    expect(p?.uid).toBe("u1");
    expect(p?.role).toBe("unit");
    expect(p?.unit).toBe("AM");
    expect(p?.name).toBe("Elizangela");
  });
  it("rejeita token adulterado", () => {
    const t = signToken(base);
    expect(verifyToken(t + "x")).toBeNull();
  });
  it("rejeita token expirado", () => {
    const t = signToken(base, -1000); // já expirado
    expect(verifyToken(t)).toBeNull();
  });
  it("rejeita lixo", () => {
    expect(verifyToken("nada")).toBeNull();
  });
});
