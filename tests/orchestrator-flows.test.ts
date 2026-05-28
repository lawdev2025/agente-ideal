import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageOrchestrator } from "../src/worker/orchestrator";
import { LLMProvider } from "../src/llm/provider";
import { StateRepository } from "../src/state/repository";
import { WhatsAppClient } from "../src/whatsapp/client";
import { EscalationHandler } from "../src/handoff/telegram";
import { routeIntent } from "../src/worker/intent-router";

function buildMocks(opts: {
  history?: Array<{ role: string; content: string }>;
  paused?: boolean;
}) {
  const history = opts.history ?? [];
  const llm = {
    generateMessage: vi.fn(async () => ({ message: "ok", toolCalls: [] })),
  } as unknown as LLMProvider;
  const stateRepo = {
    getHistory: vi.fn(async () =>
      history.map((h, i) => ({
        id: i + 1,
        wa_id: "u1",
        role: h.role,
        content: h.content,
        created_at: Date.now(),
      }))
    ),
    appendMessage: vi.fn(async () => 1),
    pauseBot: vi.fn(async () => {}),
    resumeBot: vi.fn(async () => {}),
    isBotPaused: vi.fn(async () => !!opts.paused),
    getOrCreateContact: vi.fn(async () => ({ wa_id: "u1", bot_paused: false })),
    updateLastSeen: vi.fn(async () => {}),
  } as unknown as StateRepository;
  const whatsapp = {
    sendMessage: vi.fn(async () => ({ messageId: "m1" })),
  } as unknown as WhatsAppClient;
  const escalation = {
    escalateToGroup: vi.fn(async () => ({ messageId: "e1" })),
  } as unknown as EscalationHandler;
  return { llm, stateRepo, whatsapp, escalation };
}

describe("Orchestrator: greeting de boas-vindas (Grupo Ideal)", () => {
  it("primeira mensagem responde com saudação do Grupo Ideal", async () => {
    const m = buildMocks({ history: [] });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "olá", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls[0][1] as string;
    expect(sent).toMatch(/Grupo Ideal/i);
    expect(sent).toMatch(/como posso te chamar|qual.*nome/i);
    expect(m.llm.generateMessage).not.toHaveBeenCalled();
  });
});

describe("Orchestrator: comando 'reiniciar' (várias variações)", () => {
  const variants = ["reiniciar", "Reiniciar", "REINICIAR", "reset", "voltar ao bot", "ativar bot"];

  for (const v of variants) {
    it(`'${v}' despausa e responde ack do Grupo Ideal`, async () => {
      const m = buildMocks({ paused: true });
      const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
      await orch.processMessage("u1", v, "u1");
      expect(m.stateRepo.resumeBot).toHaveBeenCalledWith("u1");
      const sent = (m.whatsapp.sendMessage as any).mock.calls[0][1] as string;
      expect(sent).toMatch(/Grupo Ideal/i);
      expect(sent).toMatch(/automático|automatico/i);
      expect(m.llm.generateMessage).not.toHaveBeenCalled();
    });
  }

  it("mensagem comum em bot pausado NÃO responde (só reiniciar abre)", async () => {
    const m = buildMocks({ paused: true, history: [{ role: "assistant", content: "oi" }] });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "olá tudo bem", "u1");
    expect(m.whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(m.stateRepo.resumeBot).not.toHaveBeenCalled();
  });
});

describe("Orchestrator: pedido de número/secretaria sem unidade", () => {
  it("'numero da secretaria' pergunta qual unidade (sem LLM, sem escalar)", async () => {
    const m = buildMocks({
      history: [
        { role: "assistant", content: "Olá! Aqui é o atendimento oficial do Grupo Ideal" },
        { role: "user", content: "João" },
      ],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "numero da secretaria", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls[0][1] as string;
    expect(sent).toMatch(/qual.*unidade|qual você prefere|me diz qual/i);
    expect(sent).toMatch(/Batista Campos/);
    expect(sent).toMatch(/Augusto Montenegro/);
    expect(sent).toMatch(/Cidade Nova/);
    expect(m.llm.generateMessage).not.toHaveBeenCalled();
    expect(m.escalation.escalateToGroup).not.toHaveBeenCalled();
  });
});

describe("Orchestrator: valor/mensalidade/matrícula/material → resposta fixa presencial", () => {
  const perguntas = [
    "qual o valor da mensalidade?",
    "quanto custa o ensino medio?",
    "valor da matricula do maternal",
    "qual a anuidade do fundamental 2",
    "preco do material didatico",
    "valores da Cidade Nova",
    "quanto sai o terceirao",
    "taxa de matricula",
  ];
  for (const p of perguntas) {
    it(`'${p}' responde só presencial, sem LLM, sem escalar`, async () => {
      const m = buildMocks({
        history: [{ role: "assistant", content: "Olá! Aqui é o atendimento oficial do Grupo Ideal" }],
      });
      const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
      await orch.processMessage("u1", p, "u1");
      const sent = (m.whatsapp.sendMessage as any).mock.calls[0][1] as string;
      expect(sent).toMatch(/presencialmente/i);
      expect(sent).toMatch(/mensalidade|matr[íi]cula|material/i);
      // Não deve citar valor numérico
      expect(sent).not.toMatch(/R\$/);
      // Não pode escalar
      expect(m.escalation.escalateToGroup).not.toHaveBeenCalled();
      // Não pode chamar LLM
      expect(m.llm.generateMessage).not.toHaveBeenCalled();
    });
  }
});

describe("Intent router: detecta unit em pergunta de contato", () => {
  it("'numero da secretaria da Cidade Nova' → enrollment_contact com unit", () => {
    const r = routeIntent("numero da secretaria da Cidade Nova", false);
    expect(r.kind).toBe("enrollment_contact");
    if (r.kind === "enrollment_contact") expect(r.unit).toBe("Cidade Nova");
  });
  it("'telefone da Sede' → enrollment_contact com unit Batista Campos", () => {
    const r = routeIntent("telefone da Sede", false);
    expect(r.kind).toBe("enrollment_contact");
    if (r.kind === "enrollment_contact") expect(r.unit).toBe("Batista Campos");
  });
  it("'numero da secretaria' (sem unidade) → enrollment_contact sem unit", () => {
    const r = routeIntent("numero da secretaria", false);
    expect(r.kind).toBe("enrollment_contact");
    if (r.kind === "enrollment_contact") expect(r.unit).toBeUndefined();
  });
});
