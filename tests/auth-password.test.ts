import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password";

describe("password hashing", () => {
  it("verifica a senha correta", () => {
    const stored = hashPassword("Ideal@2090");
    expect(verifyPassword("Ideal@2090", stored)).toBe(true);
  });
  it("rejeita senha errada", () => {
    const stored = hashPassword("Ideal@2090");
    expect(verifyPassword("errada", stored)).toBe(false);
  });
  it("gera hashes diferentes (salt aleatório) pra mesma senha", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });
  it("rejeita formato inválido sem lançar", () => {
    expect(verifyPassword("x", "lixo-sem-dois-pontos")).toBe(false);
  });
});
