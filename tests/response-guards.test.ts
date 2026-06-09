import { describe, it, expect } from "vitest";
import {
  isPriceOrMaterialQuestion,
  isDeflectionReply,
  sanitizeReply,
} from "../src/worker/orchestrator";

// Política do colégio: a palavra "equipe" nunca pode chegar ao cliente — o
// sanitizeReply troca por "time" preservando a capitalização, blindando até o
// que o LLM improvisar.
describe("sanitizeReply: 'equipe' nunca vai pro cliente (vira 'time')", () => {
  it("troca preservando capitalização e não deixa nenhum 'equipe'", () => {
    const out = sanitizeReply("Nossa equipe te ajuda! A Equipe está pronta.");
    expect(out).not.toMatch(/equipe/i);
    expect(out).toContain("time");
    expect(out).toContain("Time");
  });

  it("não mexe em palavras que apenas contêm a sequência (ex: 'equiparar')", () => {
    expect(sanitizeReply("vamos equiparar os valores")).toContain("equiparar");
  });
});

// Raiz do problema "pergunto X e ele responde sobre valores": casamento de
// palavra-chave cego ao contexto. Estes testes fixam a fronteira entre
// "perguntar o PREÇO de matrícula/material" (resposta presencial fixa) e
// "perguntar o PROCESSO de matrícula" (deve ser atendido normalmente).
describe("isPriceOrMaterialQuestion: só dispara em pergunta de PREÇO", () => {
  const precoSim = [
    "qual o valor da mensalidade?",
    "quanto custa o ensino médio?",
    "valor da matrícula do maternal",
    "taxa de matrícula",
    "quanto é a matrícula?",
    "preço do material didático",
    "qual a anuidade do fundamental 2",
    "quanto sai o terceirão",
  ];
  for (const p of precoSim) {
    it(`PREÇO: '${p}'`, () => expect(isPriceOrMaterialQuestion(p)).toBe(true));
  }

  // Estas mencionam "matrícula"/"material" mas NÃO perguntam preço — não podem
  // receber o boilerplate de valores.
  const precoNao = [
    "como faço a matrícula?",
    "quero fazer minha matrícula",
    "quais documentos preciso pra matrícula?",
    "vocês têm material de robótica?",
    "qual meu nome?",
    "vocês têm aula de natação?",
  ];
  for (const p of precoNao) {
    it(`NÃO é preço: '${p}'`, () =>
      expect(isPriceOrMaterialQuestion(p)).toBe(false));
  }
});

// A rede de deflexão existe pra pegar o LLM FINGINDO um handoff humano
// ("vou pedir pra coordenação"). Ela NÃO pode pegar uma resposta honesta
// e correta ("não tenho acesso ao seu nome") — senão o bot reescreve uma
// fala boa em "fale com a secretaria", que é a resposta estranha do print.
describe("isDeflectionReply: pega punt pra humano, não resposta honesta", () => {
  const deflexao = [
    "vou pedir pra coordenação te chamar aqui",
    "já vou pedir pra eles te responderem",
    "quem te confirma é a secretaria",
    "vou encaminhar pro setor responsável",
    "peço para a coordenação assumir",
  ];
  for (const d of deflexao) {
    it(`deflexão: '${d}'`, () => expect(isDeflectionReply(d)).toBe(true));
  }

  const honestas = [
    "Opa! Ainda não tenho acesso ao seu nome aqui no chat, como posso te chamar?",
    "Não tenho essa informação aqui no chat, mas me diz: como te chamo?",
    "Hmm, ainda não sei seu nome 😊 me conta?",
  ];
  for (const h of honestas) {
    it(`honesta (não é deflexão): '${h}'`, () =>
      expect(isDeflectionReply(h)).toBe(false));
  }
});
