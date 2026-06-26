import { describe, it, expect } from "vitest";
import { classifyContactTag, unitAbbrev } from "../src/kb/contact-tags";

describe("classifyContactTag: matrícula EXPLÍCITA", () => {
  const cases = [
    "quero matricular meu filho",
    "tem vaga pro ano que vem?",
    "como faço a inscrição?",
    "quero estudar aí",
  ];
  for (const c of cases) {
    it(`'${c}' → matricula`, () => expect(classifyContactTag(c)).toBe("matricula"));
  }
});

describe("classifyContactTag: matrícula IMPLÍCITA (valor/série/nível) — bug do print", () => {
  const cases = [
    "Bom dia! Qual o valor do sexto ano?", // <- o print que não era identificado
    "qual o valor do 6º ano?",
    "quanto custa a mensalidade do fundamental?",
    "preço do maternal",
    "tem vaga no jardim?", // 'tem vaga' já casava, mas reforça
    "valores do ensino médio",
    "quanto fica o ideal junior?",
  ];
  for (const c of cases) {
    it(`'${c}' → matricula`, () => expect(classifyContactTag(c)).toBe("matricula"));
  }
});

describe("classifyContactTag: prioridade (eixo/esporte/rematrícula antes de matrícula)", () => {
  it("'valor do eixo' → eixo (não matricula)", () => {
    expect(classifyContactTag("qual o valor do eixo?")).toBe("eixo");
  });
  it("'valor da natação' → esporte", () => {
    expect(classifyContactTag("quanto custa a natação?")).toBe("esporte");
  });
  it("'sou aluno e quero renovar' → rematricula", () => {
    expect(classifyContactTag("ja sou aluno do colegio, quero renovar")).toBe("rematricula");
  });
});

describe("classifyContactTag: sem sinal → null (mantém tag anterior)", () => {
  for (const c of ["oi", "bom dia", "obrigado", ""]) {
    it(`'${c}' → null`, () => expect(classifyContactTag(c)).toBeNull());
  }
});

describe("unitAbbrev", () => {
  it("Cidade Nova → CN", () => expect(unitAbbrev("Cidade Nova")).toBe("CN"));
  it("Augusto Montenegro → AM", () => expect(unitAbbrev("Augusto Montenegro")).toBe("AM"));
  it("Batista Campos → BC", () => expect(unitAbbrev("Batista Campos")).toBe("BC"));
});
