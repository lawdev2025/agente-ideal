import { describe, it, expect } from "vitest";
import {
  classifyTemperature,
  nextFollowupStage,
  COLD_AFTER_MS,
  FREE_WINDOW_MS,
  FOLLOWUP_2_AFTER_MS,
  FOLLOWUP_MESSAGES,
} from "../src/kb/contact-temperature";

const NOW = 1_800_000_000_000;
const H = 60 * 60 * 1000;

// Base: cliente falou, bot respondeu, e faz 2h que ninguém fala.
function stats(over: Partial<Parameters<typeof classifyTemperature>[0]> = {}) {
  return {
    userMsgs: 3,
    botLinkMsgs: 0,
    lastAt: NOW - 2 * H,
    lastRole: "assistant" as const,
    ...over,
  };
}

describe("classifyTemperature", () => {
  // O degrau mais importante: quem está ESPERANDO resposta não é lead frio, é
  // fila de atendimento. Sem isto o robô mandaria "ainda está aí?" pra quem
  // acabou de perguntar algo.
  it("última mensagem do cliente não recebe temperatura", () => {
    expect(classifyTemperature(stats({ lastRole: "user" }), NOW)).toBeNull();
    // Vale até pro caso extremo: 1 mensagem só, silêncio longo, mas é a nossa vez.
    expect(
      classifyTemperature(stats({ lastRole: "user", userMsgs: 1, lastAt: NOW - 50 * H }), NOW)
    ).toBeNull();
  });

  it("conversa viva (silêncio < 1h) não recebe temperatura", () => {
    expect(classifyTemperature(stats({ lastAt: NOW - 59 * 60 * 1000 }), NOW)).toBeNull();
    expect(classifyTemperature(stats({ lastAt: NOW - COLD_AFTER_MS }), NOW)).toBe("morno");
  });

  it("uma mensagem só e sumiu = frio", () => {
    expect(classifyTemperature(stats({ userMsgs: 1 }), NOW)).toBe("frio");
    // Frio vence link: se o bot mandou link mas o cliente nunca voltou a
    // falar, ele não chegou a engajar.
    expect(classifyTemperature(stats({ userMsgs: 1, botLinkMsgs: 2 }), NOW)).toBe("frio");
  });

  it("conversou e recebeu link = quente; sem link = morno", () => {
    expect(classifyTemperature(stats({ userMsgs: 4, botLinkMsgs: 1 }), NOW)).toBe("quente");
    expect(classifyTemperature(stats({ userMsgs: 4, botLinkMsgs: 0 }), NOW)).toBe("morno");
  });
});

// Base: frio, bot ativo, cliente falou há 2h, nenhum empurrão ainda.
function cand(over: Partial<Parameters<typeof nextFollowupStage>[0]> = {}) {
  return {
    temperature: "frio",
    botPaused: false,
    lastUserAt: NOW - 2 * H,
    lastAt: NOW - 2 * H,
    followupStage: 0,
    followupAt: null,
    ...over,
  };
}

describe("nextFollowupStage", () => {
  it("só frio recebe empurrão", () => {
    expect(nextFollowupStage(cand(), NOW)).toBe(1);
    expect(nextFollowupStage(cand({ temperature: "quente" }), NOW)).toBeNull();
    expect(nextFollowupStage(cand({ temperature: "morno" }), NOW)).toBeNull();
    expect(nextFollowupStage(cand({ temperature: null }), NOW)).toBeNull();
  });

  it("bot pausado (humano assumiu) não recebe empurrão", () => {
    expect(nextFollowupStage(cand({ botPaused: true }), NOW)).toBeNull();
  });

  it("1º empurrão só depois de 1h de silêncio", () => {
    expect(nextFollowupStage(cand({ lastAt: NOW - 30 * 60 * 1000 }), NOW)).toBeNull();
    expect(nextFollowupStage(cand({ lastAt: NOW - COLD_AFTER_MS }), NOW)).toBe(1);
  });

  it("2º empurrão conta a partir do 1º, não do silêncio", () => {
    const base = { followupStage: 1, lastAt: NOW - 30 * H };
    // 10h depois do 1º: ainda não.
    expect(
      nextFollowupStage(cand({ ...base, followupAt: NOW - 10 * H, lastUserAt: NOW - 12 * H }), NOW)
    ).toBeNull();
    // 22h depois do 1º, e o cliente falou há 23h → ainda dentro da janela.
    expect(
      nextFollowupStage(
        cand({ ...base, followupAt: NOW - FOLLOWUP_2_AFTER_MS, lastUserAt: NOW - 23 * H }),
        NOW
      )
    ).toBe(2);
  });

  // A trava que faz a diferença entre mandar e a Meta recusar.
  it("fora da janela de 24h da Meta não manda nada", () => {
    expect(nextFollowupStage(cand({ lastUserAt: NOW - FREE_WINDOW_MS }), NOW)).toBeNull();
    expect(nextFollowupStage(cand({ lastUserAt: NOW - 30 * H }), NOW)).toBeNull();
    // Lead antigo, frio há dias: continua frio no painel, mas sem empurrão.
    expect(
      nextFollowupStage(cand({ lastUserAt: NOW - 200 * H, lastAt: NOW - 200 * H }), NOW)
    ).toBeNull();
  });

  it("depois do 2º empurrão para de vez", () => {
    expect(
      nextFollowupStage(cand({ followupStage: 2, followupAt: NOW - 50 * H }), NOW)
    ).toBeNull();
  });

  // Política do colégio: "equipe" nunca vai pro cliente.
  it("as mensagens não usam a palavra proibida", () => {
    for (const m of Object.values(FOLLOWUP_MESSAGES)) {
      expect(m.toLowerCase()).not.toContain("equipe");
      expect(m.length).toBeGreaterThan(20);
    }
  });
});
