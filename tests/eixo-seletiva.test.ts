import { describe, it, expect } from "vitest";
import {
  isEixoQuestion,
  eixoReply,
  eixoJaApresentado,
  eixoLLM,
  EIXO_SELETIVA_URL,
  EIXO_VALOR_REPLY,
} from "../src/kb/eixo-seletiva";
import { classifyContactTag } from "../src/kb/contact-tags";

const ANTES = Date.parse("2026-11-20T10:00:00-03:00");
const DEPOIS = Date.parse("2026-11-29T10:00:00-03:00");

describe("isEixoQuestion", () => {
  it.each([
    "O que é o eixo?",
    "quero saber da seletiva do eixo",
    "vcs tem pré-vestibular?",
    "tem cursinho pro enem?",
    "pre enem de vocês como funciona",
  ])("'%s' → true", (t) => expect(isEixoQuestion(t)).toBe(true));

  it.each(["quero matricular no 6º ano", "resultado da seletiva", "meu filho vai fazer o enem"])(
    "'%s' → false",
    (t) => expect(isEixoQuestion(t)).toBe(false)
  );
});

describe("eixoReply", () => {
  it("antes da prova: curso, datas, desconto por eixo, link e valor só na secretaria/coordenador", () => {
    const r = eixoReply(ANTES);
    expect(r).toMatch(/novo e totalmente diferente/);
    expect(r).toMatch(/27\/11/);
    expect(r).toMatch(/28\/11, às 9h/);
    expect(r).toMatch(/cada um dos eixos/);
    expect(r).toContain(EIXO_SELETIVA_URL);
    expect(r).toMatch(/secretaria/);
    expect(r).toMatch(/99334-4387/);
    expect(r).not.toMatch(/R\$/);
    expect(r).not.toMatch(/equipe/i);
    expect(eixoJaApresentado(r)).toBe(true);
  });

  it("depois da prova: sem Seletiva nem link", () => {
    const r = eixoReply(DEPOIS);
    expect(r).not.toContain(EIXO_SELETIVA_URL);
    expect(eixoJaApresentado(r)).toBe(true);
    expect(eixoLLM(DEPOIS)).not.toMatch(/SELETIVAS EIXO/);
  });

  it("link é o de resposta, não o de edição do Forms", () => {
    expect(EIXO_SELETIVA_URL).toMatch(/ResponsePage/);
    expect(EIXO_VALOR_REPLY).not.toMatch(/R\$/);
  });
});

describe("tag eixo", () => {
  it("'seletiva do eixo' → eixo (não seletiva)", () => {
    expect(classifyContactTag("quero fazer a seletiva do eixo")).toBe("eixo");
  });
  it("'seletiva' sozinha continua seletiva", () => {
    expect(classifyContactTag("quero fazer a seletiva")).toBe("seletiva");
  });
});
