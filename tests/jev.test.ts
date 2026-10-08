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
    expect(d).toMatchObject({ route: "valores", unit: "Cidade Nova", nivel: "Fundamental 2", humano: 0.02, inputTokens: 1900 });
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

describe("orquestrador em modo sombra", () => {
  function mocks() {
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
    const whatsapp = { sendMessage: vi.fn(async () => ({ messageId: "m1" })), sendImage: vi.fn() } as unknown as WhatsAppClient;
    const escalation = { escalateToGroup: vi.fn(async () => ({ messageId: "e1" })) } as unknown as EscalationHandler;
    return { llm, stateRepo, whatsapp, escalation };
  }

  it("grava regex × Jev sem mudar a resposta enviada", async () => {
    const spy = vi.spyOn(shadow, "recordJevShadow").mockResolvedValue();
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
    spy.mockRestore();
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
