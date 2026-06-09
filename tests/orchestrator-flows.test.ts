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

describe("Orchestrator: enrollment_info determinístico (sem LLM) quando há nível", () => {
  it("nível + unidade → entrega completa (link + telefone), sem LLM", async () => {
    const m = buildMocks({
      displayName: "João",
      history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "João" }],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "tem ensino médio na cidade nova?", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    expect(sent).toMatch(/João/); // nome interpolado
    expect(sent).toMatch(/presencialmente/i);
    expect(sent).toMatch(/quillbooking_calendar=agendamento-ideal-cidade-nova/); // link da unidade
    expect(sent).toMatch(/3273-0222/); // telefone da Cidade Nova
    expect(sent).not.toMatch(/R\$/);
    expect(m.llm.generateMessage).not.toHaveBeenCalled();
    expect(m.escalation.escalateToGroup).not.toHaveBeenCalled();
  });

  it("nível sem unidade → pergunta qual unidade, sem LLM", async () => {
    const m = buildMocks({
      displayName: "Maria",
      history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "Maria" }],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "quero matricular meu filho no 5º ano", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    expect(sent).toMatch(/qual/i);
    expect(sent).toMatch(/Batista Campos/);
    expect(sent).toMatch(/Augusto Montenegro/);
    expect(sent).toMatch(/Cidade Nova/);
    expect(m.llm.generateMessage).not.toHaveBeenCalled();
  });

  it("horário do médio → responde 07:30 fixo, sem LLM", async () => {
    const m = buildMocks({
      history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "Ana" }],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "qual o horário do ensino médio?", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    expect(sent).toMatch(/07:30/);
    expect(m.llm.generateMessage).not.toHaveBeenCalled();
  });

  it("mixed: 'tem médio e desconto pra irmão?' → responde matrícula + aponta secretaria, avisa o time, sem LLM", async () => {
    const m = buildMocks({
      history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "Ana" }],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "tem ensino médio e desconto pra irmão?", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    expect(sent).toMatch(/secretaria/i);
    expect(m.llm.generateMessage).not.toHaveBeenCalled();
    // tema off-scope avisado em silêncio, sem pausar
    expect(m.escalation.escalateToGroup).toHaveBeenCalled();
    expect(m.stateRepo.pauseBot).not.toHaveBeenCalled();
  });

  it("enrollment VAGO sem nível (curso genérico) → mantém LLM (válvula de segurança)", async () => {
    const m = buildMocks({
      history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "Ana" }],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "queria informações sobre os cursos", "u1");
    expect(m.llm.generateMessage).toHaveBeenCalled();
  });
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

describe("Orchestrator: redirect secretaria pergunta a unidade direto (sem sim/não)", () => {
  it("'quero pagar a festa Junina' (deflexão LLM) → pergunta a unidade, sem sim/não inútil", async () => {
    const m = buildMocks({
      history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "Ana" }],
    });
    // LLM deflete a dúvida concreta → override pra secretaria
    (m.llm.generateMessage as any).mockResolvedValue({
      message: "Não tenho essa informação, fale com a secretaria.",
      toolCalls: [],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "quero pagar a festa Junina", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    expect(sent).toMatch(/secretaria/i);
    expect(sent).toMatch(/de qual unidade voc[êe] [ée]/i);
    // NUNCA o sim/não antigo "quer que eu te passe o telefone"
    expect(sent).not.toMatch(/quer que eu te passe/i);
  });

  it("redirect com unidade já no histórico → passa o telefone DAQUELA secretaria direto", async () => {
    const m = buildMocks({
      history: [
        { role: "assistant", content: "Oi" },
        { role: "user", content: "sou da Cidade Nova" },
      ],
    });
    (m.llm.generateMessage as any).mockResolvedValue({
      message: "Não tenho essa informação, fale com a secretaria.",
      toolCalls: [],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "tem festa junina esse ano?", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    expect(sent).toMatch(/Cidade Nova/);
    expect(sent).toMatch(/\(91\) 3273-0222/);
    expect(sent).not.toMatch(/de qual unidade/i);
  });
});

describe("Orchestrator: follow-up determinístico de unidade (responde só o nome → telefone)", () => {
  const cases: Array<{ ask: string; reply: string; phone: string }> = [
    {
      ask: "Essa informação específica quem confirma certinho é a nossa *secretaria* 😊\n\nDe qual unidade você é? Aí te passo o telefone certinho:\n🏫 *Sede (Batista Campos)*",
      reply: "Cidade Nova",
      phone: "(91) 3273-0222",
    },
    {
      ask: "Boletim, histórico escolar, declarações e qualquer outro documento são emitidos direto na *secretaria* da unidade. 📄\n\nDe qual unidade você precisa?",
      reply: "Sede",
      phone: "(91) 3323-5000",
    },
    {
      ask: "Pagamento de taxas, mensalidade e prova de *segunda chamada* é resolvido direto na *secretaria* da unidade. 💳\n\nDe qual unidade você precisa?",
      reply: "Augusto Montenegro",
      phone: "(91) 3273-0667",
    },
  ];
  for (const { ask, reply, phone } of cases) {
    it(`bot perguntou a unidade → '${reply}' devolve ${phone} sem LLM`, async () => {
      const m = buildMocks({
        history: [
          { role: "assistant", content: "Oi" },
          { role: "user", content: "Ana" },
          { role: "assistant", content: ask },
        ],
      });
      const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
      await orch.processMessage("u1", reply, "u1");
      const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
      expect(sent).toMatch(/secretaria/i);
      expect(sent).toContain(phone);
      // É determinístico — não improvisa via LLM nem lista todos os telefones
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

describe("Orchestrator: necessidade documental → secretaria da unidade (com telefone)", () => {
  it("'preciso do boletim' (sem unidade) pergunta qual unidade, sem LLM, sem pausar", async () => {
    const m = buildMocks({
      history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "Ana" }],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "preciso do boletim do meu filho", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    expect(sent).toMatch(/secretaria/i);
    expect(sent).toMatch(/qual unidade/i);
    expect(sent).toMatch(/Batista Campos/);
    expect(sent).not.toMatch(/presencialmente/i);
    expect(m.llm.generateMessage).not.toHaveBeenCalled();
    expect(m.stateRepo.pauseBot).not.toHaveBeenCalled();
    // Avisa o time em silêncio
    expect(m.escalation.escalateToGroup).toHaveBeenCalled();
  });

  it("'histórico escolar na Cidade Nova' passa o telefone da Cidade Nova", async () => {
    const m = buildMocks({
      history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "Ana" }],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "como tiro o histórico escolar na Cidade Nova?", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    expect(sent).toMatch(/secretaria/i);
    expect(sent).toMatch(/3273-0222/); // telefone da Cidade Nova
    expect(m.llm.generateMessage).not.toHaveBeenCalled();
    expect(m.stateRepo.pauseBot).not.toHaveBeenCalled();
  });
});

describe("Orchestrator: pagamento de taxas / segunda chamada → secretaria da unidade", () => {
  it("'como faço o pagamento?' (sem unidade) pergunta qual unidade, sem LLM, sem pausar", async () => {
    const m = buildMocks({
      history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "Ana" }],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "como faço o pagamento?", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    expect(sent).toMatch(/secretaria/i);
    expect(sent).toMatch(/qual unidade/i);
    expect(sent).toMatch(/segunda chamada/i);
    expect(sent).not.toMatch(/presencialmente/i);
    expect(m.llm.generateMessage).not.toHaveBeenCalled();
    expect(m.stateRepo.pauseBot).not.toHaveBeenCalled();
  });

  it("'pagamento na Cidade Nova' passa o telefone da Cidade Nova", async () => {
    const m = buildMocks({
      history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "Ana" }],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "como pago a mensalidade na Cidade Nova?", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    expect(sent).toMatch(/3273-0222/); // telefone da Cidade Nova
    expect(m.llm.generateMessage).not.toHaveBeenCalled();
    expect(m.stateRepo.pauseBot).not.toHaveBeenCalled();
  });

  it("'prova de segunda chamada' cai no fluxo de secretaria (não no de preço)", async () => {
    const m = buildMocks({
      history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "Ana" }],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "quando é a prova de segunda chamada?", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    expect(sent).toMatch(/secretaria/i);
    expect(sent).not.toMatch(/presencialmente/i);
    expect(m.llm.generateMessage).not.toHaveBeenCalled();
  });
});

describe("Orchestrator: limite de 7 respostas do bot → atendimento humano", () => {
  // 7 mensagens do bot na sessão (saudação + 6) → a próxima vira handoff.
  const sevenBotMsgs = [
    { role: "assistant", content: "Olá! Aqui é o atendimento oficial do Grupo Ideal 🎓" },
    { role: "user", content: "oi" },
    { role: "assistant", content: "resposta 2" },
    { role: "user", content: "x" },
    { role: "assistant", content: "resposta 3" },
    { role: "assistant", content: "resposta 4" },
    { role: "assistant", content: "resposta 5" },
    { role: "assistant", content: "resposta 6" },
    { role: "assistant", content: "resposta 7" },
  ];

  it("ao bater 7 respostas, passa pra humano (pausa + Telegram), sem LLM", async () => {
    const m = buildMocks({ history: sevenBotMsgs });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "ainda tenho outra dúvida", "u1");
    expect(m.stateRepo.pauseBot).toHaveBeenCalled();
    expect(m.escalation.escalateToGroup).toHaveBeenCalled();
    expect(m.llm.generateMessage).not.toHaveBeenCalled();
  });

  it("com 6 respostas ainda NÃO passa pra humano", async () => {
    const m = buildMocks({ history: sevenBotMsgs.slice(0, -1) }); // tira a 7ª
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "oi de novo", "u1");
    expect(m.stateRepo.pauseBot).not.toHaveBeenCalled();
    expect(m.escalation.escalateToGroup).not.toHaveBeenCalled();
  });

  it("'reiniciar' zera o limite: ack de retomada vira novo marco de contagem", async () => {
    const afterReiniciar = [
      ...sevenBotMsgs,
      { role: "user", content: "reiniciar" },
      { role: "assistant", content: "Pronto! Voltamos ao atendimento automático do Grupo Ideal 🤖" },
    ];
    const m = buildMocks({ history: afterReiniciar });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "quero saber do ensino médio", "u1");
    // Sessão recomeçou → NÃO faz handoff por limite.
    expect(m.stateRepo.pauseBot).not.toHaveBeenCalled();
    expect(m.escalation.escalateToGroup).not.toHaveBeenCalled();
  });
});

describe("Intent router: necessidade documental → document_request", () => {
  it("boletim → document_request", () => {
    expect(routeIntent("preciso do boletim do meu filho", false).kind).toBe("document_request");
  });
  it("histórico escolar com unidade → document_request + unit", () => {
    const r = routeIntent("quero o histórico escolar da Cidade Nova", false);
    expect(r.kind).toBe("document_request");
    if (r.kind === "document_request") expect(r.unit).toBe("Cidade Nova");
  });
  it("segunda via de declaração → document_request", () => {
    expect(routeIntent("preciso da segunda via da declaração", false).kind).toBe("document_request");
  });
});

describe("Intent router: pedido de visita / link → visit_request", () => {
  it("'Quero fazer uma visita a unidade' → visit_request (não unit_info)", () => {
    expect(routeIntent("Quero fazer uma visita a unidade", true).kind).toBe("visit_request");
  });
  it("'quero visitar a Cidade Nova' → visit_request + unit", () => {
    const r = routeIntent("quero visitar a Cidade Nova", true);
    expect(r.kind).toBe("visit_request");
    if (r.kind === "visit_request") expect(r.unit).toBe("Cidade Nova");
  });
  it("'Tem link?' → visit_request (o único link é o de visita)", () => {
    expect(routeIntent("Tem link?", true).kind).toBe("visit_request");
  });
  it("'me manda o link de agendamento' → visit_request", () => {
    expect(routeIntent("me manda o link de agendamento", true).kind).toBe("visit_request");
  });
  it("'quero conhecer a escola' → visit_request", () => {
    expect(routeIntent("quero conhecer a escola", true).kind).toBe("visit_request");
  });
});

describe("Orchestrator: pedido de visita → link determinístico (reproduz o print)", () => {
  it("'Quero fazer uma visita a unidade' (sem unidade) → lista os 3 links, sem LLM", async () => {
    const m = buildMocks({
      history: [{ role: "assistant", content: "Oi" }, { role: "user", content: "João" }],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "Quero fazer uma visita a unidade", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    expect(sent).toMatch(/quillbooking_calendar=agendamento-ideal-batista-campos/);
    expect(sent).toMatch(/quillbooking_calendar=agendamento-ideal-cidade-nova/);
    expect(m.llm.generateMessage).not.toHaveBeenCalled();
    expect(m.stateRepo.pauseBot).not.toHaveBeenCalled();
  });

  it("'Cidade nova' e depois 'Tem link?' → manda SÓ o link da Cidade Nova, sem negar", async () => {
    const m = buildMocks({
      history: [
        { role: "assistant", content: "Oi" },
        { role: "user", content: "João" },
        { role: "user", content: "Quero fazer uma visita a unidade" },
        { role: "assistant", content: "Temos 3 unidades, qual você prefere?" },
        { role: "user", content: "Cidade nova" },
        { role: "assistant", content: "Perfeito!" },
      ],
    });
    const orch = new MessageOrchestrator(m.llm, m.stateRepo, m.whatsapp, m.escalation);
    await orch.processMessage("u1", "Tem link?", "u1");
    const sent = (m.whatsapp.sendMessage as any).mock.calls.map((c: any) => c[1]).join("\n");
    expect(sent).toMatch(/quillbooking_calendar=agendamento-ideal-cidade-nova/);
    expect(sent).not.toMatch(/não tem link|nao tem link/i);
    expect(m.llm.generateMessage).not.toHaveBeenCalled();
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
  it("transferência/histórico → document_request (secretaria, não soft genérico)", () => {
    expect(routeIntent("como faço a transferência do histórico?", false).kind).toBe("document_request");
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
