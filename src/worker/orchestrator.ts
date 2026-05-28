import { LLMProvider } from "../llm/provider";
import { StateRepository } from "../state/repository";
import { executeKBTool } from "../kb/tools";
import { WhatsAppClient } from "../whatsapp/client";
import { EscalationHandler } from "../handoff/telegram";
import { logger } from "../logger";
import { config } from "../config";
import { routeIntent, RoutedIntent } from "./intent-router";

export interface ConversationMessage {
  role: string;
  content: string;
}

export class MessageOrchestrator {
  constructor(
    private llmProvider: LLMProvider,
    private stateRepository: StateRepository,
    private whatsappClient: WhatsAppClient,
    private escalationHandler: EscalationHandler
  ) {}

  async processMessage(
    conversationId: string,
    userMessage: string,
    studentId: string
  ): Promise<void> {
    try {
      logger.info(
        { conversationId, messageLength: userMessage.length },
        "Processing message"
      );

      // Cliente digitou "reiniciar" (ou variações). Despausa o bot e responde
      // com saudação curta. Esse comando funciona MESMO se o bot estiver
      // pausado — é a porta de saída do cliente. Avaliado ANTES do isBotPaused.
      if (isResumeCommand(userMessage)) {
        logger.info({ studentId, userMessage }, "Resume command detected — unpausing bot");
        try {
          await this.stateRepository.resumeBot(studentId);
        } catch (err) {
          logger.error({ err, studentId }, "Falha ao retomar bot via comando reiniciar");
        }
        const ack =
          "Pronto! Voltamos ao atendimento automático do *Grupo Ideal*. 🤖✨\n" +
          "Como posso te ajudar agora?";
        await this.stateRepository.appendMessage(conversationId, "assistant", ack);
        await this.whatsappClient.sendMessage(studentId, ack);
        return;
      }

      // ORDEM DO COLÉGIO (regra dura): pergunta sobre valor/mensalidade/
      // matrícula/material → SEMPRE resposta presencial fixa. Sem LLM, sem
      // escalação, sem intermediário "coordenação te chama". Avaliado ANTES
      // do isBotPaused, ANTES do roteamento, ANTES de qualquer LLM — não há
      // caminho que escape isso.
      if (isPriceOrMaterialQuestion(userMessage)) {
        logger.info({ studentId }, "Price/material question — sending presential reply");
        const reply = PRESENTIAL_VALUES_REPLY;
        await this.stateRepository.appendMessage(conversationId, "assistant", reply);
        await this.whatsappClient.sendMessage(studentId, reply);
        return;
      }

      // Bot pausado para este contato: NÃO responde. A mensagem do cliente
      // já foi salva no histórico pelo webhook (pro atendente humano ver),
      // então aqui só registramos e saímos. O atendente humano cuida no
      // painel; quando ele clicar "Retomar Bot", o flag volta a 0.
      if (await this.stateRepository.isBotPaused(studentId)) {
        logger.info(
          { studentId },
          "Bot paused for this contact — skipping LLM response"
        );
        return;
      }

      const history = await this.stateRepository.getHistory(conversationId);
      const conversationHistory: ConversationMessage[] = history.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Have we escalated this conversation already? If so, skip escalation
      // routing — let the LLM just keep talking naturally.
      const alreadyEscalated = history.some(
        (m) => m.role === "tool" && m.content.includes("escalate_to_specialist")
      );

      const intent: RoutedIntent = routeIntent(userMessage, false);
      logger.info({ intent: intent.kind }, "Routed intent");

      // Deterministic path: clear escalation triggers go straight to handoff,
      // unless we already escalated in this conversation.
      if (intent.kind === "escalate" && !alreadyEscalated) {
        await this.escalateToSpecialist(conversationId, studentId, intent.reason);
        return;
      }

      // Deterministic path: clear matrícula/contact/unit questions go straight
      // to the right tool — we don't trust the LLM to route correctly.
      if (
        intent.kind === "enrollment_info" ||
        intent.kind === "enrollment_contact" ||
        intent.kind === "unit_info"
      ) {
        // Pergunta de valor (mensalidade, matrícula, material): resposta FIXA
        // por ordem do colégio — valores APENAS presencialmente, para todas as
        // unidades e segmentos. Sem LLM, sem escalação. Vale para qualquer
        // intent que tenha sinal de preço/material na mensagem original.
        // Pedido de telefone/secretaria sem unidade: responde determinístico
        // perguntando qual unidade — não dispara LLM, não dispara escalação.
        if (intent.kind === "enrollment_contact" && !intent.unit) {
          const ask =
            "Claro! Temos 3 unidades — me diz qual você prefere que eu te passe o número:\n\n" +
            "🏫 *Sede (Batista Campos)*\n" +
            "🏫 *Augusto Montenegro*\n" +
            "🏫 *Cidade Nova (Ananindeua)*\n\n" +
            "Ou, se preferir o WhatsApp central que atende as 3, é só dizer *WhatsApp*. 😊";
          await this.stateRepository.appendMessage(conversationId, "assistant", ask);
          await this.whatsappClient.sendMessage(studentId, ask);
          return;
        }
        await this.runDeterministicToolFlow(
          conversationId,
          studentId,
          userMessage,
          intent,
          conversationHistory
        );
        return;
      }

      // Ambiguous case — let the LLM handle it (greetings, name capture,
      // free-form chat after escalation, etc.)
      await this.runLLMFlow(
        conversationId,
        studentId,
        userMessage,
        conversationHistory
      );
    } catch (error) {
      logger.error({ error, conversationId }, "Error processing message");
      // Erro tecnico transitorio (timeout, token expirado, rede): notifica
      // Telegram mas NAO pausa o bot — proxima msg do mesmo contato deve ser
      // tentada normalmente assim que o problema for resolvido.
      await this.escalateToSpecialist(
        conversationId,
        studentId,
        `Error processing message: ${error instanceof Error ? error.message : String(error)}`,
        { skipPause: true }
      );
    }
  }

  // Runs the deterministic path: call the chosen tool ourselves, then ask the
  // LLM (without tools, with a phrasing-only system prompt) to write a
  // natural-sounding reply using the result.
  private async runDeterministicToolFlow(
    conversationId: string,
    studentId: string,
    userMessage: string,
    intent: Extract<RoutedIntent, { kind: "enrollment_info" | "enrollment_contact" | "unit_info" }>,
    conversationHistory: ConversationMessage[]
  ): Promise<void> {
    const toolName =
      intent.kind === "enrollment_info"
        ? "get_enrollment_info"
        : intent.kind === "unit_info"
        ? "get_unit_info"
        : "get_enrollment_contact";
    let args: Record<string, unknown> = {};
    if (intent.kind === "enrollment_info") {
      if (intent.nivel) args.nivel = intent.nivel;
      if (intent.unit) args.unit = intent.unit;
    } else if (intent.kind === "unit_info" && intent.unit) {
      args = { unit: intent.unit };
    } else if (intent.kind === "enrollment_contact" && intent.unit) {
      args = { assunto: intent.unit };
    }

    let toolResult: string;
    try {
      toolResult = await executeKBTool(toolName, args);
    } catch (e) {
      logger.error({ error: e, toolName }, "Deterministic tool execution failed");
      await this.escalateToSpecialist(
        conversationId,
        studentId,
        `Tool ${toolName} failed for: ${userMessage}`
      );
      return;
    }

    if (/n[ãa]o\s+encontrado/i.test(toolResult)) {
      await this.escalateToSpecialist(
        conversationId,
        studentId,
        `Level requested not found. Mensagem: "${userMessage}"`
      );
      return;
    }

    await this.stateRepository.appendMessage(
      conversationId,
      "tool",
      `Tool ${toolName} result: ${toolResult}`
    );

    const updatedHistory = await this.stateRepository.getHistory(conversationId);
    const updatedConv: ConversationMessage[] = updatedHistory.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const escalateAfter =
      intent.kind === "enrollment_info" ? intent.escalateAfter : undefined;
    const phrasingPrompt = buildPhrasingSystemPrompt(escalateAfter);

    let reply = "";
    try {
      const r = await this.llmProvider.generateMessage(userMessage, updatedConv, [], {
        systemPromptOverride: phrasingPrompt,
      });
      reply = sanitizeReply(r.message?.trim() ?? "");
    } catch (e) {
      logger.error({ error: e }, "LLM phrasing call failed — using raw tool output");
    }

    if (!reply) reply = toolResult;

    // Rede de segurança: se o LLM ainda escapou e disse algo do tipo
    // "vou pedir pra coordenação", REESCREVEMOS pela resposta presencial.
    // Nada de mandar o cliente pra fila — atendimento direto, sempre.
    if (isDeflectionReply(reply)) {
      logger.warn({ original: reply }, "LLM produced deflection text — overriding with presential reply");
      reply = PRESENTIAL_VALUES_REPLY;
    }

    await this.stateRepository.appendMessage(conversationId, "assistant", reply);
    await this.whatsappClient.sendMessage(studentId, reply);

    // After answering the primary question, fire the queued escalation for
    // the off-scope part of a mixed-intent message (desconto, uniforme, etc.).
    if (escalateAfter) {
      await this.escalateToSpecialist(conversationId, studentId, escalateAfter);
    }

    void conversationHistory;
  }

  // Pure-chat path for ambiguous messages (greetings, name capture, small
  // talk between tool-driven turns). We deliberately pass NO tools — the
  // intent router is responsible for every tool-triggering case, so anything
  // that reaches here should be plain conversation.
  private async runLLMFlow(
    conversationId: string,
    studentId: string,
    userMessage: string,
    conversationHistory: ConversationMessage[]
  ): Promise<void> {
    // First contact — bypass the LLM entirely and send the official formal
    // greeting. Avoids any risk of the model drifting from the script and
    // saves a token round-trip on every new conversation.
    const isFirstInteraction = !conversationHistory.some(
      (m) => m.role === "assistant"
    );
    if (isFirstInteraction) {
      const greeting =
        "Olá! Aqui é o atendimento oficial do *Grupo Ideal* 🎓✨\n" +
        "É um prazer falar com você! Estamos prontos pra te ajudar com informações sobre nossas turmas, unidades e o processo de matrícula 2026.\n\n" +
        "Pra começar, como posso te chamar? 😊";
      await this.stateRepository.appendMessage(conversationId, "assistant", greeting);
      await this.whatsappClient.sendMessage(studentId, greeting);
      return;
    }

    const chatPrompt = buildChatSystemPrompt();
    const response = await this.llmProvider.generateMessage(
      userMessage,
      conversationHistory,
      [],
      { systemPromptOverride: chatPrompt }
    );

    let reply = sanitizeReply(response.message?.trim() ?? "");
    if (!reply) {
      // Empty reply on an ambiguous-but-pure-chat message means something
      // unusual — escalate so the client gets a human, not silence.
      await this.escalateToSpecialist(
        conversationId,
        studentId,
        `LLM gave empty reply to ambiguous message: "${userMessage}"`
      );
      return;
    }

    // Rede de segurança: se o LLM produziu deflexão pra coordenação,
    // sobrescreve com a resposta presencial fixa. Nada de empurrar
    // pra fila.
    if (isDeflectionReply(reply)) {
      logger.warn({ original: reply }, "LLM produced deflection text — overriding with presential reply");
      reply = PRESENTIAL_VALUES_REPLY;
    }

    await this.stateRepository.appendMessage(conversationId, "assistant", reply);
    await this.whatsappClient.sendMessage(studentId, reply);
  }

  private async escalateToSpecialist(
    conversationId: string,
    studentId: string,
    reason: string,
    opts: { skipHandoffMessage?: boolean; skipPause?: boolean } = {}
  ): Promise<void> {
    const history = await this.stateRepository.getHistory(conversationId, 5);
    const context = history.map((m) => `${m.role}: ${m.content}`).join("\n");

    // Mark the contact as awaiting human attendance — incrementa o contador
    // "Atendimentos Humanos" no painel. Pulado em erros tecnicos transitorios
    // pra nao deixar o bot mudo permanentemente por uma falha pontual.
    if (!opts.skipPause) {
      try {
        await this.stateRepository.pauseBot(studentId, reason);
      } catch (pauseError) {
        logger.error({ error: pauseError, studentId }, "Failed to mark contact as bot_paused");
      }
    }

    try {
      await this.escalationHandler.escalateToGroup(studentId, reason, context);
      logger.info({ conversationId, studentId }, "Issue escalated to specialist via Telegram");
    } catch (telegramError) {
      logger.error({ error: telegramError }, "Failed to send escalation alert to Telegram (network/credentials error)");
    }
    try {
      await this.stateRepository.appendMessage(
        conversationId,
        "tool",
        `Tool escalate_to_specialist result: ${reason}`
      );
      if (!opts.skipHandoffMessage) {
        const handoffMessage =
          "Vou pedir para a coordenação do Colégio Ideal te responder por aqui mesmo — em instantes alguém da nossa equipe entra em contato com você. 😊\n\n" +
          "*Para retornar ao atendimento automático, escreva \"reiniciar\".*";
        await this.stateRepository.appendMessage(conversationId, "assistant", handoffMessage);
        if (!config.whatsapp.dryRun) {
          await this.whatsappClient.sendMessage(studentId, handoffMessage);
        } else {
          logger.info({ studentId, dryRun: true }, "WhatsApp notification skipped (DRY_RUN mode)");
        }
      }
    } catch (dbOrWsError) {
      logger.error({ error: dbOrWsError }, "Error recording handoff message in database/WhatsApp client");
    }
  }
}

// Detects when the assistant's reply is a "deflection" to human staff — i.e.
// it didn't actually answer and is punting to coordenação/secretaria. When
// this happens we still want a real escalation to fire (Telegram + counter).
function isDeflectionReply(text: string): boolean {
  const t = (text || "").toLowerCase();
  const patterns = [
    /coordena[çc][ãa]o\s+(te|vai|j[áa])/,
    /quem\s+te\s+(confirma|passa|responde)/,
    /vou\s+(pedir|chamar|avisar)\s+(pra|para|a|o)/,
    /j[áa]\s+vou\s+(pedir|chamar|avisar)/,
    /n[ãa]o\s+tenho\s+(essa|essas|esse|esses|a)\s+informa[çc]/,
    /n[ãa]o\s+(tenho|possuo|sei)\s+(essa|esse|essas|esses|o|a)\s+(dado|detalhe|valor|informa)/,
    /entre\s+em\s+contato\s+com\s+(a|o)\s+(coordena|secretaria|secret)/,
    /pe[çc]o\s+(que|para)\s+(a|o)\s+(coordena|secretaria)/,
    /vou\s+(direcionar|encaminhar|repassar)/,
  ];
  return patterns.some((p) => p.test(t));
}

// Detecta se o cliente está pedindo pra retomar o atendimento automatizado.
// Aceita variações comuns. Case-insensitive, ignora pontuação/acentos.
function isResumeCommand(text: string): boolean {
  const normalized = (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/[^a-z0-9\s]/g, " ")    // remove pontuação
    .replace(/\s+/g, " ")
    .trim();
  const triggers = [
    "reiniciar",
    "reinicia",
    "reset",
    "resetar",
    "restart",
    "reiniciar atendimento",
    "reiniciar conversa",
    "reiniciar bot",
    "voltar ao bot",
    "voltar pro bot",
    "voltar para o bot",
    "voltar bot",
    "voltar para o atendimento automatico",
    "voltar ao atendimento automatico",
    "voltar atendimento",
    "atendimento automatico",
    "modo automatico",
    "ativar bot",
    "chamar bot",
  ];
  // Match exato OR começa com o gatilho seguido de espaço/pontuação
  return triggers.some(
    (t) => normalized === t || normalized.startsWith(t + " ")
  );
}

// Resposta canônica para qualquer pergunta de valor. Centralizada aqui pra
// nunca divergir entre paths (top-level, sanitizer, fallback).
const PRESENTIAL_VALUES_REPLY =
  "Os valores de *mensalidade*, *matrícula* e *material didático* nós informamos *somente presencialmente*, " +
  "em qualquer uma das 3 unidades e para todos os segmentos. 🤝\n\n" +
  "Assim a equipe consegue te apresentar as melhores condições com calma. " +
  "Quer que eu te passe o telefone da unidade mais próxima pra você agendar uma visita?";

// Detecta se a mensagem é sobre valor (mensalidade/matrícula/material). Quando
// é, devolvemos a resposta fixa "valores só presencialmente" e nunca chamamos
// LLM nem escalamos — ordem do colégio.
function isPriceOrMaterialQuestion(text: string): boolean {
  const t = (text || "").toLowerCase();
  return /\b(valor|valores|mensalidade|mensalidades|pre[çc]o|pre[çc]os|custo|custa|quanto\s+(custa|fica|sai|paga)|anuidade|semestralidade|matr[íi]cula|taxa\s+de\s+matr[íi]cula|material\s+did[áa]tico|material\s+escolar|kit\s+escolar)\b/.test(t);
}

// Focused phrasing prompt — used when we've already chosen the tool and just
// need natural text. By stripping the production system prompt (which mentions
// tool names) we avoid Gemini hallucinating function-call syntax in its reply.
function buildPhrasingSystemPrompt(escalateAfter?: string): string {
  const lines = [
    "Você é o atendimento oficial do Colégio Ideal (sem nome próprio — fale em nome do colégio, use 'nós'/'aqui no Colégio Ideal'). Sua única tarefa é responder ao cliente em UMA mensagem natural de WhatsApp, usando EXCLUSIVAMENTE o que está no resultado da ferramenta no histórico (role=tool) E nos DADOS OFICIAIS abaixo.",
    "",
    "DADOS OFICIAIS DO COLÉGIO (use estes valores VERBATIM — NUNCA invente outros):",
    "• Telefones reais: Sede (Batista Campos) (91) 3323-5000 · WhatsApp central (91) 99389-8000 · Augusto Montenegro (91) 3273-0667 · Cidade Nova (Ananindeua) (91) 3273-0222.",
    "• Endereços: Sede em Batista Campos, Belém · Augusto Montenegro nº 130, Parque Verde, Belém · Cidade Nova II, Av. SN-3 esq. WE-21, 3277, Ananindeua.",
    "• 3 unidades no total. Todas oferecem do Maternal ao Pré-Enem (Eixo). Sistema Poliedro.",
    "• Aulas começam 07:30 com 30 min de tolerância, igual nas 3 unidades.",
    "",
    "REGRAS DURAS:",
    "- Responda em 1-3 frases curtas, tom WhatsApp informal.",
    "- Use o nome do cliente se ele já apareceu na conversa.",
    "- NÃO escreva 'aguarde', 'um momento', 'vou verificar'.",
    "- NUNCA escreva texto que pareça uma chamada de função (ex: 'escalate_to_specialist(...)'). Você só escreve português natural.",
    "- NÃO repita o resumo bruto da ferramenta — extraia o ponto que o cliente perguntou.",
    "- ❗ Se o cliente perguntou TELEFONE / NÚMERO / SECRETARIA / WHATSAPP, devolva os números acima literalmente (priorize Sede e WhatsApp central). NUNCA diga 'não tenho essa informação' — você tem essa informação aí em cima.",
    "- ❗ Se o cliente perguntar valor/mensalidade/preço/taxa, responda EXATAMENTE: 'Os valores são informados somente na secretaria pra te dar a melhor condição. Posso te passar o telefone pra você falar direto com a equipe?' — NUNCA cite R$. NÃO use 'quem te confirma' / 'vou pedir pra eles' / 'vou chamar a coordenação'.",
    "- ❗ Se o cliente perguntou DUAS coisas (ex: valor + número da secretaria), RESPONDA AS DUAS na mesma mensagem usando os dados acima.",
    "- PROIBIDO inventar taxa de matrícula, datas de vencimento, políticas de desconto, regras de pagamento, datas de início das aulas, lista de documentos, link de cadastro, prazo de resposta. Pra esses, diga: 'Pra essa informação específica, o melhor é falar direto com a secretaria pelo (91) 99389-8000.'",
    "- Termine com no MÁXIMO uma pergunta curta de avanço (ou nenhuma pergunta).",
  ];
  if (escalateAfter) {
    lines.push(
      "",
      `IMPORTANTE: além de responder a pergunta principal, AVISE em UMA frase curta no final que essa parte específica (${escalateAfter.split(".")[0]}) será respondida pela coordenação em instantes. Não dê detalhes sobre o tema escalado, só avise.`
    );
  }
  return lines.join("\n");
}

// Chat-only system prompt for ambiguous messages (greetings, name capture,
// small talk). No tools are exposed in this path so the prompt focuses on
// keeping the conversation moving without inventing data.
function buildChatSystemPrompt(): string {
  return [
    "Você é o atendimento oficial do Colégio Ideal (sem nome próprio — fale em nome do colégio, use 'nós'/'aqui no Colégio Ideal'), conversando por WhatsApp. Nesta mensagem você está apenas conversando — outras decisões já foram tratadas pelo sistema.",
    "",
    "DADOS REAIS DO COLÉGIO (use APENAS estes — nada fora daqui existe):",
    "• Telefones: Sede (Batista Campos) (91) 3323-5000 · WhatsApp central (91) 99389-8000 · Augusto Montenegro (91) 3273-0667 · Cidade Nova (Ananindeua) (91) 3273-0222.",
    "• Endereços: Sede em Batista Campos, Belém · Augusto Montenegro nº 130, Parque Verde, Belém · Cidade Nova II, Av. SN-3 esq. WE-21, 3277, Ananindeua.",
    "• Níveis: Maternal, Jardim I/II, Fundamental 1 (1º-5º), Fundamental 2 (6º-9º), Ensino Médio, Pré-Enem (Eixo). Todos disponíveis nas 3 unidades.",
    "• Início das aulas: 07:30 com 30 min de tolerância. Iguais nas 3 unidades.",
    "• Sistema: Poliedro. Material comprado direto na escola. Uniforme na malharia das unidades.",
    "",
    "REGRAS:",
    "- Tom WhatsApp natural, 1-2 frases curtas.",
    "- Se o cliente já disse o nome (em mensagens anteriores), USE o nome.",
    "- Se o cliente está confirmando algo ou agradecendo, responda curto e simpático.",
    "- ❗ Se o cliente perguntar VALOR / MENSALIDADE / TAXA / PREÇO / QUANTO CUSTA, responda SEMPRE: 'Os valores são informados somente na secretaria pra te dar a melhor condição. Posso te passar o telefone pra você falar direto com a equipe?' — NUNCA cite R$. NÃO use as frases 'quem te confirma' / 'vou pedir pra eles' / 'vou chamar a coordenação'.",
    "- ❗ Se o cliente perguntar TELEFONE / NÚMERO / SECRETARIA / WHATSAPP, devolva UM dos números acima — escolha a Sede por padrão a menos que o cliente especifique outra unidade. NUNCA invente número.",
    "- Se o cliente está perguntando algo CONCRETO que não está acima (taxa, prazo, documento específico), diga: 'Essa parte quem te confirma é a secretaria — quer o telefone?'",
    "- PROIBIDO inventar QUALQUER número de telefone com DDD diferente de 91. (11), (21), (31)... TODOS proibidos. Se você escreveu (11)... você quebrou a regra.",
    "- PROIBIDO inventar valores em R$. NUNCA escreva 'R$' na resposta.",
    "- PROIBIDO inventar datas, taxas, políticas, ou qualquer dado fora da lista acima.",
    "- PROIBIDO escrever texto que pareça chamada de função (escalate_to_specialist(...), get_enrollment_info(...), etc).",
    "- PROIBIDO copiar markdown bruto de resultado de ferramenta. Sempre reformule em português corrido.",
    "- PROIBIDO dizer 'aguarde', 'um momento', 'vou verificar'.",
  ].join("\n");
}

// Belt-and-suspenders: strip lines that look like function calls in case
// Gemini still emits them despite the phrasing prompt. ALSO neutraliza
// alucinações de telefone (qualquer DDD ≠ 91) e qualquer valor em R$
// que o modelo possa ter inventado.
function sanitizeReply(text: string): string {
  // 1. Drop function-call-shaped lines
  let cleaned = text
    .split("\n")
    .filter((line) => !/[a-z_]+\([a-z_]+\s*=\s*["']/i.test(line))
    .join("\n");

  // 2. Substitui qualquer DDD que NÃO seja 91. Padrão: (XX) XXXX-XXXX,
  //    (XX) XXXXX-XXXX, XX XXXXX-XXXX, XX 9XXXX-XXXX. Se DDD ≠ 91, vira [contato].
  cleaned = cleaned.replace(
    /\(?\b(\d{2})\)?\s?9?\s?\d{4,5}[\s-]?\d{4}\b/g,
    (match, ddd) => (ddd === "91" ? match : "[contato confirmado na secretaria]")
  );

  // 3. Neutraliza qualquer "R$" + número que o modelo tenha inventado.
  cleaned = cleaned.replace(
    /R\$\s?[\d.,]+(?:\s?(?:\/m[êe]s|por m[êe]s|mensal|anual|semestral))?/gi,
    "(valor informado na secretaria)"
  );

  return cleaned.trim();
}
