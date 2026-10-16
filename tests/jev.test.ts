import { describe, it, expect, vi } from "vitest";

// Sem Supabase: o modo sombra só loga e a FAQ vem vazia (o .env real é
// carregado nos testes — sem isto gravaríamos linhas de teste em produção).
vi.mock("../src/db/supabase-client", () => ({
  isSupabaseEnabled: () => false,
  getSupabase: () => {
    throw new Error("supabase desligado nos testes");
  },
}));

import { JevClient, JEV_ENDPOINT, JevResponse } from "../src/llm/jev";
import {
  buildJevState,
  buildJevQuestions,
  parseJevDecision,
  routesAgree,
  ROUTE_CRITERIA,
  nextSatisfaction,
  classifyTemperatura,
  SATISFACAO_CRITERIA,
  jevVeredito,
  JevDecision,
  LIVE_MIN,
} from "../src/worker/jev-router";
import { MessageOrchestrator, legacyRouteLabel } from "../src/worker/orchestrator";
import { routeIntent } from "../src/worker/intent-router";
import * as shadow from "../src/learning/jev-shadow";
import { LLMProvider } from "../src/llm/provider";
import { StateRepository } from "../src/state/repository";
import { WhatsAppClient } from "../src/whatsapp/client";
import { EscalationHandler } from "../src/handoff/telegram";

function jevApiResponse(rota: string, confidence = 0.9): Omit<JevResponse, "latencyMs"> {
  return {
    model: "jev-1.13.0",
    answers: {
      rota: { type: "choice", choice: rota, confidence, probabilities: { [rota]: confidence, outro: 1 - confidence } },
      unidade: { type: "choice", choice: "cidade_nova", confidence: 0.99, probabilities: { cidade_nova: 1 } },
      nivel: { type: "choice", choice: "fundamental_2", confidence: 0.95, probabilities: { fundamental_2: 1 } },
      humano: { type: "noul", noul: 0.02 },
      satisfacao: { type: "score", score: 4.3, confidence: 0.8, probabilities: { "4": 0.7, "5": 0.3 } },
    },
    usage: { input_tokens: 1900, output_tokens: 60 },
  };
}

function fakeFetch(impl: () => Promise<Response>) {
  return vi.fn(impl) as unknown as typeof fetch;
}

describe("JevClient", () => {
  it("envia model/state/questions com Bearer e devolve answers + latência", async () => {
    const fetchImpl = fakeFetch(async () => new Response(JSON.stringify(jevApiResponse("valores")), { status: 200 }));
    const client = new JevClient({ apiKey: "k", model: "jev-1.13.0", timeoutMs: 1000, fetchImpl });
    const res = await client.evaluate("oi", { x: { type: "noul", instructions: "?" } });
    expect(res?.answers.rota).toMatchObject({ choice: "valores" });
    expect(typeof res?.latencyMs).toBe("number");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(JEV_ENDPOINT);
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body)).toEqual({ model: "jev-1.13.0", state: "oi", questions: { x: { type: "noul", instructions: "?" } } });
  });

  it("HTTP != 200 → null (não lança)", async () => {
    const client = new JevClient({ apiKey: "k", model: "m", timeoutMs: 1000, fetchImpl: fakeFetch(async () => new Response("bad", { status: 400 })) });
    expect(await client.evaluate("oi", {})).toBeNull();
  });

  it("erro de rede / timeout → null (não lança)", async () => {
    const client = new JevClient({ apiKey: "k", model: "m", timeoutMs: 1000, fetchImpl: fakeFetch(async () => { throw new Error("timeout"); }) });
    expect(await client.evaluate("oi", {})).toBeNull();
  });
});

describe("jev-router", () => {
  it("state: última fala do colégio em campo próprio, sem tool, só as 6 últimas", () => {
    const hist = [
      ...Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` })),
      { role: "tool", content: "Tool get_enrollment_info result: ..." },
    ];
    const state = buildJevState(hist, "e pra cidade nova?");
    expect(state.ultima_fala_do_colegio).toBe("m7");
    expect(state.mensagem_atual_do_cliente).toBe("e pra cidade nova?");
    expect(state.conversa_anterior.map((t) => t.texto)).toEqual(["m2", "m3", "m4", "m5", "m6"]);
  });

  it("state: se a última fala foi do cliente, não há fala do colégio pendente", () => {
    const state = buildJevState([{ role: "user", content: "oi" }], "tudo bem?");
    expect(state.ultima_fala_do_colegio).toBeNull();
    expect(state.conversa_anterior).toEqual([{ quem: "cliente", texto: "oi" }]);
  });

  it("regras: continuação vence o assunto, menos resposta_unidade", () => {
    const comCont = (rota: string, cont: number) => {
      const r = jevApiResponse(rota);
      r.answers.continuacao = { type: "noul", noul: cont };
      return parseJevDecision({ ...r, latencyMs: 1 })!;
    };
    expect(comCont("seletiva_resultado_nao_recebido", 0.9)).toMatchObject({ route: "continuacao", rawRoute: "seletiva_resultado_nao_recebido" });
    expect(comCont("seletiva_resultado_nao_recebido", 0.3).route).toBe("seletiva_resultado_nao_recebido");
    expect(comCont("resposta_unidade", 0.99).route).toBe("resposta_unidade");
  });

  it("regras: humano só com Noul >= 0,95; senão vale a 2ª rota", () => {
    const r = jevApiResponse("humano");
    r.answers.rota = { type: "choice", choice: "humano", confidence: 0.6, probabilities: { humano: 0.7, visita: 0.3 } };
    r.answers.humano = { type: "noul", noul: 0.9 };
    expect(parseJevDecision({ ...r, latencyMs: 1 })!.route).toBe("visita");
    r.answers.humano = { type: "noul", noul: 0.97 };
    expect(parseJevDecision({ ...r, latencyMs: 1 })!.route).toBe("humano");
  });

  it("perguntas: cada linha ativa da school_faq vira a opção faq:<id>", () => {
    const q = buildJevQuestions([
      { id: 7, gatilhos: "piscina, natação", resposta: "Temos piscina na Batista Campos.", unit_id: null, ativo: true, prioridade: 0 },
    ]);
    expect(q.rota.type).toBe("choice");
    const criteria = (q.rota as { criteria: Record<string, unknown> }).criteria;
    expect(criteria["faq:7"]).toBeDefined();
    expect(Object.keys(criteria)).toEqual(expect.arrayContaining(Object.keys(ROUTE_CRITERIA)));
  });

  it("decisão: traduz unidade/nível para os rótulos do bot", () => {
    const d = parseJevDecision({ ...jevApiResponse("valores"), latencyMs: 300 });
    expect(d).toMatchObject({ route: "valores", unit: "Cidade Nova", nivel: "Fundamental 2", humano: 0.02, satisfacao: 4.3, inputTokens: 1900 });
  });

  it("concordância regex × Jev", () => {
    expect(routesAgree("valores", "valores")).toBe(true);
    expect(routesAgree("faq", "faq:12")).toBe(true);
    expect(routesAgree("llm_livre", "conversa")).toBe(true);
    expect(routesAgree("llm_livre", "continuacao")).toBe(true);
    expect(routesAgree("bolsa_desconto", "seletiva_resultado")).toBe(false);
    expect(routesAgree("pausado", "valores")).toBeNull();
  });

  it("rótulo legado usa o vocabulário do Jev", () => {
    const label = (m: string) => legacyRouteLabel(routeIntent(m, false), m);
    expect(label("quero falar com um atendente")).toBe("humano");
    expect(label("tem van?")).toBe("transporte_alimentacao");
    expect(label("quero fazer uma visita")).toBe("visita");
    expect(label("quero matricular meu filho")).toBe("matricula");
    expect(label("como é o 6º ano?")).toBe("nivel_info");
  });
});

describe("satisfação", () => {
  it("escala de 0 a 5: 6 níveis, o índice é a nota", () => {
    expect(SATISFACAO_CRITERIA).toHaveLength(6);
    const q = buildJevQuestions();
    expect(q.satisfacao.type).toBe("score");
  });

  it("média móvel: 1ª leitura é a própria nota, depois metade/metade, 1 casa", () => {
    expect(nextSatisfaction(null, 4.27)).toBe(4.3);
    expect(nextSatisfaction(4.6, 1)).toBe(2.8);
    expect(nextSatisfaction(5, 5)).toBe(5);
    expect(nextSatisfaction(0.2, -1)).toBe(0);
  });
});

describe("temperatura pela conversa", () => {
  const conversa = [
    { role: "user", content: "quero matricular" },
    { role: "assistant", content: "Agende: https://x" },
    { role: "tool", content: "Tool x" },
  ];

  it("manda a conversa sem tool e devolve a escolha com confiança", async () => {
    const fetchImpl = fakeFetch(async () => new Response(JSON.stringify({
      model: "jev-1.13.0",
      answers: { temperatura: { type: "choice", choice: "quente", confidence: 0.9, probabilities: { quente: 0.95 } } },
    }), { status: 200 }));
    const client = new JevClient({ apiKey: "k", model: "m", timeoutMs: 1000, fetchImpl });
    expect(await classifyTemperatura(client, conversa)).toEqual({ temperatura: "quente", confidence: 0.9 });
    const body = JSON.parse((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.state.mensagens_do_cliente).toBe(1);
    expect(body.state.conversa).toHaveLength(2);
    expect(Object.keys(body.questions.temperatura.criteria)).toEqual(["quente", "morno", "frio"]);
  });

  it("conversa sem mensagem do cliente → null, sem chamar a API", async () => {
    const fetchImpl = fakeFetch(async () => new Response("{}", { status: 200 }));
    const client = new JevClient({ apiKey: "k", model: "m", timeoutMs: 1000, fetchImpl });
    expect(await classifyTemperatura(client, [{ role: "assistant", content: "oi" }])).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("orquestrador: alerta de cliente insatisfeito", () => {
  it("cliente irritado com bot ativo → abre alerta com título e motivo", async () => {
    const shadowSpy = vi.spyOn(shadow, "recordJevShadow").mockResolvedValue();
    const satSpy = vi.spyOn(shadow, "recordSatisfaction").mockResolvedValue();
    const alertSpy = vi.spyOn(shadow, "recordAlerta").mockResolvedValue();
    const api = jevApiResponse("valores", 0.95);
    api.answers.satisfacao = { type: "score", score: 0.9, confidence: 0.9, probabilities: { "0": 0.3, "1": 0.7 } };
    api.answers.emocao = { type: "choice", choice: "irritado", confidence: 0.9, probabilities: { irritado: 0.95 } };
    api.answers.motivo = { type: "choice", choice: "quer_valor", confidence: 0.9, probabilities: { quer_valor: 0.95 } };
    const jev = new JevClient({ apiKey: "k", model: "m", timeoutMs: 1000, fetchImpl: fakeFetch(async () => new Response(JSON.stringify(api), { status: 200 })) });
    const m = orchestratorMocks();
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation, undefined, jev);
    await orch.processMessage("u1", "Que absurdo, ninguém me diz o valor da mensalidade", "u1");
    expect(alertSpy).toHaveBeenCalledWith(
      "u1",
      { acao: "abrir", titulo: "Cliente irritado", motivo: "quer o valor da mensalidade e não recebeu" },
      "Carla"
    );
    shadowSpy.mockRestore(); satSpy.mockRestore(); alertSpy.mockRestore();
  });
});

function orchestratorMocks() {
  const llm = { generateMessage: vi.fn(async () => ({ message: "ok", toolCalls: [] })) } as unknown as LLMProvider;
  const stateRepo = {
    getHistory: vi.fn(async () => [
      { id: 1, wa_id: "u1", role: "assistant", content: "Olá! Como posso te chamar?", created_at: 1 },
      { id: 2, wa_id: "u1", role: "user", content: "Carla", created_at: 2 },
      { id: 3, wa_id: "u1", role: "assistant", content: "Prazer, Carla!", created_at: 3 },
    ]),
    appendMessage: vi.fn(async () => 1),
    isBotPaused: vi.fn(async () => false),
    getOrCreateContact: vi.fn(async () => ({ wa_id: "u1", name: "Carla", phone: null, bot_paused: false, paused_reason: null, paused_at: null, last_seen_at: null })),
    setContactUnitTag: vi.fn(async () => {}),
    markSeletivaAgendada: vi.fn(async () => {}),
  } as unknown as StateRepository;
  const whatsapp = {
    sendMessage: vi.fn(async () => ({ messageId: "m1" })),
    sendImage: vi.fn(),
    sendDocument: vi.fn(async () => ({ messageId: "d1" })),
  } as unknown as WhatsAppClient;
  const escalation = { escalateToGroup: vi.fn(async () => ({ messageId: "e1" })) } as unknown as EscalationHandler;
  return { llm, stateRepo, whatsapp, escalation };
}

describe("orquestrador em modo sombra", () => {
  const mocks = orchestratorMocks;

  it("grava regex × Jev e a satisfação, sem mudar a resposta enviada", async () => {
    const spy = vi.spyOn(shadow, "recordJevShadow").mockResolvedValue();
    const satSpy = vi.spyOn(shadow, "recordSatisfaction").mockResolvedValue();
    const alertSpy = vi.spyOn(shadow, "recordAlerta").mockResolvedValue();
    const m = mocks();
    const jev = new JevClient({
      apiKey: "k", model: "m", timeoutMs: 1000,
      fetchImpl: fakeFetch(async () => new Response(JSON.stringify(jevApiResponse("visita", 0.97)), { status: 200 })),
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation, undefined, jev);
    await orch.processMessage("u1", "quero fazer uma visita na cidade nova", "u1");

    expect(m.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    const row = spy.mock.calls[0][0];
    expect(row.legacyRoute).toBe("visita");
    expect(row.decision?.route).toBe("visita");
    expect(row.legacyUnit).toBe("Cidade Nova");
    // 1ª leitura de satisfação do contato = a própria nota do Jev.
    expect(satSpy).toHaveBeenCalledWith("u1", 4.3);
    // Satisfeito (4,3) e sem alerta aberto → nada a fazer com o alerta.
    expect(alertSpy).toHaveBeenCalledWith("u1", { acao: "nada" }, "Carla");
    spy.mockRestore();
    satSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it("Jev fora do ar: atendimento segue igual e a linha é gravada sem decisão", async () => {
    const spy = vi.spyOn(shadow, "recordJevShadow").mockResolvedValue();
    const m = mocks();
    const jev = new JevClient({ apiKey: "k", model: "m", timeoutMs: 1000, fetchImpl: fakeFetch(async () => { throw new Error("down"); }) });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation, undefined, jev);
    await orch.processMessage("u1", "quero fazer uma visita na cidade nova", "u1");

    expect(m.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].decision).toBeNull();
    spy.mockRestore();
  });

  it("sem Jev injetado: nada de sombra", async () => {
    const spy = vi.spyOn(shadow, "recordJevShadow").mockResolvedValue();
    const m = mocks();
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "quero fazer uma visita na cidade nova", "u1");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("modo live: veto do bloco fixo", () => {
  const dec = (route: string, confidence: number): JevDecision =>
    ({ route, rawRoute: route, confidence } as JevDecision);
  const SEL = ["seletiva_resultado", "seletiva_edital", "seletiva_agendamento"];

  it("concorda, rota equivalente ou confiança baixa → segue o regex", () => {
    expect(jevVeredito("valores", dec("valores", 0.99))).toEqual({ acao: "seguir" });
    expect(jevVeredito("nivel_info", dec("matricula", 0.99))).toEqual({ acao: "seguir" });
    expect(jevVeredito("unidade_info", dec("resposta_unidade", 1))).toEqual({ acao: "seguir" });
    expect(jevVeredito("seletiva_resultado", dec("bolsa_desconto", LIVE_MIN - 0.01))).toEqual({ acao: "seguir" });
    expect(jevVeredito("valores", null)).toEqual({ acao: "seguir" });
  });

  it("discorda com confiança alta → veta; se o portão sabe a rota do Jev, troca", () => {
    expect(jevVeredito("seletiva_resultado", dec("bolsa_desconto", 1))).toEqual({ acao: "vetar" });
    expect(jevVeredito("seletiva_agendamento", dec("seletiva_edital", 1), SEL)).toEqual({ acao: "trocar", rota: "seletiva_edital" });
  });

  it("continuação veta bloco fixo mesmo com a rota bruta incerta", () => {
    expect(jevVeredito("seletiva_resultado", dec("continuacao", 0.3))).toEqual({ acao: "vetar" });
  });

  it("nunca veta humano, fora de escopo, pausa, limite nem o LLM livre", () => {
    for (const r of ["humano", "fora_escopo", "pausado", "limite", "llm_livre"]) {
      expect(jevVeredito(r, dec("valores", 1))).toEqual({ acao: "seguir" });
    }
  });
});

describe("orquestrador em modo live", () => {
  const jevCom = (rota: string, conf: number) =>
    new JevClient({
      apiKey: "k", model: "m", timeoutMs: 1000,
      fetchImpl: fakeFetch(async () => new Response(JSON.stringify(jevApiResponse(rota, conf)), { status: 200 })),
    });

  it("Jev discorda com confiança alta → bloco fixo do regex vetado, LLM responde", async () => {
    const spy = vi.spyOn(shadow, "recordJevShadow").mockResolvedValue();
    const satSpy = vi.spyOn(shadow, "recordSatisfaction").mockResolvedValue();
    const alertSpy = vi.spyOn(shadow, "recordAlerta").mockResolvedValue();
    const m = orchestratorMocks();
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation, undefined, jevCom("matricula", 0.97), true);
    // Regex: "link" → visita. Cliente na verdade não conseguiu se matricular.
    await orch.processMessage("u1", "não consegui fazer a matrícula pelo link de visita", "u1");

    expect(m.llm.generateMessage).toHaveBeenCalled();
    const row = spy.mock.calls[0][0];
    expect(row.legacyRoute).toBe("visita");
    expect(row.finalRoute).toBe("llm_livre");
    spy.mockRestore(); satSpy.mockRestore(); alertSpy.mockRestore();
  });

  it("pedido de edital que o regex não pega → Jev puxa o arquivo do segmento dele", async () => {
    const spy = vi.spyOn(shadow, "recordJevShadow").mockResolvedValue();
    const satSpy = vi.spyOn(shadow, "recordSatisfaction").mockResolvedValue();
    const alertSpy = vi.spyOn(shadow, "recordAlerta").mockResolvedValue();
    const m = orchestratorMocks();
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation, undefined, jevCom("seletiva_edital", 0.95), true);
    await orch.processMessage("u1", "pode me mandar as regras do teste, por favor?", "u1");
    // nivel fundamental_2 no jevApiResponse → edital do 6º ano ao Médio.
    expect((m.whatsapp.sendDocument as any).mock.calls[0][1]).toContain("edital-seletiva-ideal-2027-teste-agendado");
    spy.mockRestore(); satSpy.mockRestore(); alertSpy.mockRestore();
  });

  it("Jev concorda → resposta do regex igual, final = legacy", async () => {
    const spy = vi.spyOn(shadow, "recordJevShadow").mockResolvedValue();
    const satSpy = vi.spyOn(shadow, "recordSatisfaction").mockResolvedValue();
    const alertSpy = vi.spyOn(shadow, "recordAlerta").mockResolvedValue();
    const m = orchestratorMocks();
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation, undefined, jevCom("visita", 0.97), true);
    await orch.processMessage("u1", "quero fazer uma visita na cidade nova", "u1");

    expect(m.llm.generateMessage).not.toHaveBeenCalled();
    expect(m.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ legacyRoute: "visita", finalRoute: "visita" });
    spy.mockRestore(); satSpy.mockRestore(); alertSpy.mockRestore();
  });

  it("modo sombra com o mesmo desacordo → regex responde, nada muda", async () => {
    const spy = vi.spyOn(shadow, "recordJevShadow").mockResolvedValue();
    const satSpy = vi.spyOn(shadow, "recordSatisfaction").mockResolvedValue();
    const alertSpy = vi.spyOn(shadow, "recordAlerta").mockResolvedValue();
    const m = orchestratorMocks();
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation, undefined, jevCom("matricula", 0.97));
    await orch.processMessage("u1", "não consegui fazer a matrícula pelo link de visita", "u1");

    expect(m.llm.generateMessage).not.toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toMatchObject({ legacyRoute: "visita", finalRoute: undefined });
    spy.mockRestore(); satSpy.mockRestore(); alertSpy.mockRestore();
  });
});
