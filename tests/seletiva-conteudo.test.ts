import { describe, it, expect } from "vitest";
import { isSeletivaContentQuestion, pickSeletivaEditais } from "../src/kb/seletiva-conteudo";
import { classifyContactTag } from "../src/kb/contact-tags";

const PRINT =
  "Irei fazer ideal regular estou no 9 ano devo estudar os conteúdos do 9 ano ou do 1 ano do ensino médio que é a qual quero entrar";

describe("isSeletivaContentQuestion: pergunta de conteúdo da prova", () => {
  const sim = [
    PRINT,
    "o que cai na seletiva?",
    "quais os conteúdos da prova?",
    "o conteúdo é do ano que ele está ou do que vai cursar?",
    "quais matérias caem?",
    "tem edital?",
    "conteúdo programático da prova de bolsa",
    "devo estudar o 9º ano ou o 1º ano?",
    "o que ele precisa estudar?",
  ];
  for (const t of sim) it(`'${t.slice(0, 50)}' → sim`, () => expect(isSeletivaContentQuestion(t)).toBe(true));

  const nao = [
    "quanto custa o 9 ano?",
    "quais matérias tem no ensino médio?",
    "quero estudar no Ideal",
    "o que cai no enem?",
    "o que vai cair na prova do 3º bimestre?",
    "meu filho estuda no 6º ano",
    "boa noite",
  ];
  for (const t of nao) it(`'${t}' → não`, () => expect(isSeletivaContentQuestion(t)).toBe(false));
});

describe("pickSeletivaEditais: edital pela série citada", () => {
  const casos: Array<[string, ReturnType<typeof pickSeletivaEditais>]> = [
    [PRINT, ["regular"]],
    ["vai pro 7º ano", ["regular"]],
    ["ela vai cursar a 2ª série do médio", ["regular"]],
    ["2º ano do ensino médio", ["regular"]],
    ["meu filho vai pro 4º ano", ["jr"]],
    ["quinto ano", ["jr"]],
    ["fundamental 1", ["jr"]],
    ["está no 5º ano e vai pro 6º ano", ["regular", "jr"]],
    ["turmas militares", ["militar"]],
    ["quero a EsPCEx", ["militar"]],
    ["o que cai na seletiva?", null],
    ["3 ano", null], // Fundamental ou terceirão: ambíguo
  ];
  for (const [t, esperado] of casos) {
    it(`'${t.slice(0, 50)}' → ${JSON.stringify(esperado)}`, () => expect(pickSeletivaEditais(t)).toEqual(esperado));
  }
});

describe("classifyContactTag: conteúdo da prova é Seletiva", () => {
  it("a frase do print vira seletiva (não matrícula)", () => {
    expect(classifyContactTag(PRINT)).toBe("seletiva");
  });
  it("pergunta de valor da série continua matrícula", () => {
    expect(classifyContactTag("quanto custa o 9 ano?")).toBe("matricula");
  });
});
