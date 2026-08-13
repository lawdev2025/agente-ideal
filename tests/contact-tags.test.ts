import { describe, it, expect } from "vitest";
import { classifyContactTag, unitAbbrev } from "../src/kb/contact-tags";
import { detectUnit } from "../src/worker/intent-router";

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

describe("classifyContactTag: Seletiva Ideal 2027", () => {
  const cases = [
    "quero saber da seletiva",
    "como funciona o processo seletivo?",
    "vocês vão ter prova de bolsa esse ano?",
    "quando é o concurso de bolsas?",
    "tem teste de seleção?",
  ];
  for (const c of cases) {
    it(`'${c}' → seletiva`, () => expect(classifyContactTag(c)).toBe("seletiva"));
  }
  it("seletiva vence matrícula quando a frase tem as duas (é campanha própria)", () => {
    expect(classifyContactTag("quero matricular meu filho pela seletiva")).toBe("seletiva");
  });
  it("'sou aluno e quero fazer a seletiva' → seletiva (não rematricula)", () => {
    expect(classifyContactTag("ja sou aluno e quero fazer a seletiva")).toBe("seletiva");
  });
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

// O cliente responde a "em qual unidade?" com só o PRIMEIRO nome. Sem isto o
// unit_tag não era gravado e o lead ficava órfão, sem ir pra atendente da
// unidade — mesmo o bot tendo respondido certo pela via do LLM.
describe("detectUnit: primeiro nome da unidade (resposta curta)", () => {
  const cases: Array<[string, string]> = [
    ["Augusto", "Augusto Montenegro"],
    ["augusto", "Augusto Montenegro"],
    ["Montenegro", "Augusto Montenegro"],
    ["Batista", "Batista Campos"],
    ["batista", "Batista Campos"],
    ["Cidade", "Cidade Nova"],
    ["cidade nova", "Cidade Nova"],
    ["Ananindeua", "Cidade Nova"],
    ["quero a Augusto", "Augusto Montenegro"],
    ["na batista mesmo", "Batista Campos"],
  ];
  for (const [text, unit] of cases) {
    it(`'${text}' → ${unit}`, () => expect(detectUnit(text)).toBe(unit));
  }

  // Nome completo continua valendo em qualquer tamanho de mensagem.
  it("frase longa com nome completo ainda casa", () =>
    expect(detectUnit("boa tarde, gostaria de saber o valor da unidade Augusto Montenegro pro sexto ano")).toBe(
      "Augusto Montenegro"
    ));

  // Palavra solta só conta em mensagem curta (formato de resposta). Numa frase
  // longa, "cidade"/"augusto" são palavra comum ou nome de pessoa, não unidade.
  it("'em que cidade fica a escola?' NÃO vira Cidade Nova", () =>
    expect(detectUnit("em que cidade fica a escola de vocês?")).toBeUndefined());
  it("'meu filho Augusto quer estudar aí' NÃO vira Augusto Montenegro", () =>
    expect(detectUnit("meu filho Augusto quer estudar aí no ano que vem")).toBeUndefined());
});
