import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageOrchestrator, extractName } from "../src/worker/orchestrator";
import { LLMProvider } from "../src/llm/provider";
import { StateRepository } from "../src/state/repository";
import { WhatsAppClient } from "../src/whatsapp/client";
import { EscalationHandler } from "../src/handoff/telegram";
import { routeIntent } from "../src/worker/intent-router";

function buildMocks(opts: {
  history?: Array<{ role: string; content: string }>;
  paused?: boolean;
  displayName?: string | null;
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
    getOrCreateContact: vi.fn(async () => ({
      wa_id: "u1",
      name: opts.displayName ?? null,
      phone: null,
      bot_paused: !!opts.paused,
      paused_reason: null,
      paused_at: null,
      last_seen_at: null,
    })),
    setName: vi.fn(async () => {}),
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

describe("extractName: extrai nome da resposta à saudação", () => {
  const ok: Array<[string, string]> = [
    ["João", "João"],
    ["maria", "Maria"],
    ["meu nome é Pedro", "Pedro"],
    ["me chamo Ana Clara", "Ana Clara"],
    ["sou a Carla", "Carla"],
    ["pode me chamar de Zé", "Zé"],
    ["oi, sou o Lucas", "Lucas"],
    ["é a Beatriz", "Beatriz"],
  ];
  for (const [input, expected] of ok) {
    it(`'${input}' → '${expected}'`, () => {
      expect(extractName(input)).toBe(expected);
    });
  }

  const rejected = ["oi", "bom dia", "quero saber o valor", "quanto custa?", "sim", "tem ensino médio?", ""];
  for (const input of rejected) {
    it(`'${input}' → null (não é nome)`, () => {
      expect(extractName(input)).toBeNull();
    });
  }
});

describe("Orchestrator: captura do nome e salva no contato (painel)", () => {
  it("resposta à saudação salva display_name", async () => {
    const m = buildMocks({
      displayName: null,
      history: [
        { role: "assistant", content: "Olá! Aqui é o atendimento oficial do Grupo Ideal. Pra começar, como posso te chamar? 😊" },
      ],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "meu nome é João", "u1");
    expect(m.stateRepo.setName).toHaveBeenCalledWith("u1", "João");
  });

  it("garante criação do contato (getOrCreateContact) em toda mensagem", async () => {
    const m = buildMocks({ history: [], displayName: null });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "oi", "u1");
    expect(m.stateRepo.getOrCreateContact).toHaveBeenCalledWith("u1");
  });

  it("não tenta salvar nome se o bot ainda não pediu (sem saudação no histórico)", async () => {
    const m = buildMocks({ history: [], displayName: null });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "João", "u1");
    expect(m.stateRepo.setName).not.toHaveBeenCalled();
  });

  it("não sobrescreve nome já salvo", async () => {
    const m = buildMocks({
      displayName: "João",
      history: [
        { role: "assistant", content: "como posso te chamar?" },
        { role: "assistant", content: "Prazer, João!" },
      ],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "Pedro", "u1");
    expect(m.stateRepo.setName).not.toHaveBeenCalled();
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

describe("Orchestrator: deflexão LLM em pergunta NÃO-preço → secretaria (nunca preço)", () => {
  it("LLM defere uma dúvida concreta → redirect secretaria + Telegram silencioso, sem preço", async () => {
    const m = buildMocks({
      history: [
        { role: "assistant", content: "Oi" },
        { role: "user", content: "tudo bem?" },
      ],
    });
    // LLM gera deflexão clássica
    (m.llm.generateMessage as any) = vi.fn(async () => ({
      message: "Essa parte quem te confirma é a coordenação, já vou pedir pra eles te chamarem aqui.",
      toolCalls: [],
    }));
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    // Pergunta concreta que NÃO é de preço (cai no chat path)
    await orch.processMessage("u1", "vocês têm aula de natação?", "u1");

    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    // Cliente NUNCA vê a frase de deflexão original
    expect(sent).not.toMatch(/vou pedir/i);
    // E vê o redirect pra secretaria — NÃO a resposta de preço
    expect(sent).toMatch(/secretaria/i);
    expect(sent).not.toMatch(/presencialmente/i);
    expect(sent).not.toMatch(/mensalidade/i);
    // Telegram foi avisado (em silêncio)
    expect(m.escalation.escalateToGroup).toHaveBeenCalled();
    // Bot NÃO foi pausado — cliente segue conversando
    expect(m.stateRepo.pauseBot).not.toHaveBeenCalled();
  });

  it("LLM defere uma pergunta DE PREÇO → resposta presencial fixa (não secretaria genérica)", async () => {
    const m = buildMocks({
      history: [
        { role: "assistant", content: "Oi" },
        { role: "user", content: "Ana" },
      ],
    });
    (m.llm.generateMessage as any) = vi.fn(async () => ({
      message: "Não tenho essa informação de valor aqui, vou pedir pra coordenação.",
      toolCalls: [],
    }));
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    // "quanto" + nível dispara o path de preço (enrollment_info), mas mesmo se
    // caísse no chat, isPriceOrMaterialQuestion garante a resposta presencial.
    await orch.processMessage("u1", "quanto fica o valor?", "u1");

    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    expect(sent).toMatch(/presencialmente/i);
    expect(sent).not.toMatch(/R\$/);
  });
});

describe("Orchestrator: soft redirect (bolsa/desconto/documento) → secretaria, sem pausar", () => {
  const softMsgs = [
    "vocês oferecem bolsa de estudo?",
    "tem desconto pra dois irmãos?",
    "como peço a transferência do histórico escolar?",
  ];
  for (const msg of softMsgs) {
    it(`'${msg}' → redirect secretaria + Telegram silencioso, sem pausa e sem handoff`, async () => {
      const m = buildMocks({
        history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "Ana" }],
      });
      const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
      await orch.processMessage("u1", msg, "u1");

      const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
      // Vê secretaria, NÃO o handoff "vou pedir pra coordenação"
      expect(sent).toMatch(/secretaria/i);
      expect(sent).not.toMatch(/vou pedir para a coordena/i);
      // Não responde preço a tema que não é preço
      expect(sent).not.toMatch(/presencialmente/i);
      // Telegram avisado em silêncio, mas SEM pausar o bot
      expect(m.escalation.escalateToGroup).toHaveBeenCalled();
      expect(m.stateRepo.pauseBot).not.toHaveBeenCalled();
      // Não chama o LLM — é determinístico
      expect(m.llm.generateMessage).not.toHaveBeenCalled();
    });
  }
});

describe("Orchestrator: handoff humano de verdade só p/ humano explícito e fora de escopo", () => {
  const hardMsgs = [
    "quero falar com um atendente humano",
    "quem ganha o jogo do Flamengo?",
  ];
  for (const msg of hardMsgs) {
    it(`'${msg}' → pausa o bot + handoff pro cliente + Telegram`, async () => {
      const m = buildMocks({
        history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "Ana" }],
      });
      const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
      await orch.processMessage("u1", msg, "u1");

      const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
      expect(sent).toMatch(/coordena[çc][ãa]o/i);
      expect(m.escalation.escalateToGroup).toHaveBeenCalled();
      expect(m.stateRepo.pauseBot).toHaveBeenCalled();
    });
  }
});

describe("Orchestrator: uniforme não escala mais (roteiro já sabe)", () => {
  it("'onde compro o uniforme?' → cai no chat livre, sem escalar", async () => {
    const m = buildMocks({
      history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "Ana" }],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "onde compro o uniforme?", "u1");
    // Não pausa nem escala — deixa o LLM responder com o que sabe (malharia)
    expect(m.stateRepo.pauseBot).not.toHaveBeenCalled();
    expect(m.escalation.escalateToGroup).not.toHaveBeenCalled();
    expect(m.llm.generateMessage).toHaveBeenCalled();
  });
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

describe("Intent router: soft_redirect vs escalate (hard handoff)", () => {
  it("bolsa → soft_redirect (não pausa)", () => {
    expect(routeIntent("tem bolsa de estudo?", false).kind).toBe("soft_redirect");
  });
  it("desconto → soft_redirect", () => {
    expect(routeIntent("tem desconto pra irmãos?", false).kind).toBe("soft_redirect");
  });
  it("transferência/histórico → soft_redirect", () => {
    expect(routeIntent("como faço a transferência do histórico?", false).kind).toBe("soft_redirect");
  });
  it("transporte escolar → soft_redirect", () => {
    expect(routeIntent("tem transporte escolar?", false).kind).toBe("soft_redirect");
  });
  it("pedido explícito de humano → escalate (hard)", () => {
    expect(routeIntent("quero falar com um humano", false).kind).toBe("escalate");
  });
  it("assunto fora do colégio (futebol) → escalate (hard)", () => {
    expect(routeIntent("quem ganha o jogo do flamengo?", false).kind).toBe("escalate");
  });
  it("uniforme NÃO é mais off-scope → não vira escalate nem soft_redirect", () => {
    const k = routeIntent("onde compro o uniforme?", false).kind;
    expect(k).not.toBe("escalate");
    expect(k).not.toBe("soft_redirect");
  });
  it("mixed: 'valor do médio e desconto pra irmão' → enrollment_info com escalateAfter", () => {
    const r = routeIntent("qual o valor do ensino médio e tem desconto pra irmão?", false);
    expect(r.kind).toBe("enrollment_info");
    if (r.kind === "enrollment_info") expect(r.escalateAfter).toBeTruthy();
  });
});
