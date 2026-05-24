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
      await this.escalateToSpecialist(
        conversationId,
        studentId,
        `Error processing message: ${error instanceof Error ? error.message : String(error)}`
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

    await this.stateRepository.appendMessage(conversationId, "assistant", reply);
    await this.whatsappClient.sendMessage(studentId, reply);

    // After answering the primary question, fire the queued escalation for
    // the off-scope part of a mixed-intent message (desconto, uniforme, etc.).
    if (escalateAfter) {
      await this.escalateToSpecialist(conversationId, studentId, escalateAfter);
    } else if (!alreadyEscalatedInHistory(updatedConv) && isDeflectionReply(reply)) {
      // The bot said "vou chamar a coordenação" but didn't actually escalate.
      // Fire the real escalation so Telegram is notified and the contact is
      // marked as awaiting human.
      await this.escalateToSpecialist(
        conversationId,
        studentId,
        `Bot deferiu para coordenação. Pergunta original: "${userMessage}"`,
        { skipHandoffMessage: true }
      );
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
        "Olá! Seja muito bem-vindo(a) ao atendimento oficial do Colégio Ideal. 🎓\n" +
        "Estamos aqui para te ajudar com informações sobre nossas turmas, valores, unidades e processo de matrícula para 2026.\n\n" +
        "Para começar, por favor, qual é o seu nome?";
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

    const reply = sanitizeReply(response.message?.trim() ?? "");
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

    await this.stateRepository.appendMessage(conversationId, "assistant", reply);
    await this.whatsappClient.sendMessage(studentId, reply);

    // Same deflection check in the pure-chat path.
    if (!alreadyEscalatedInHistory(conversationHistory) && isDeflectionReply(reply)) {
      await this.escalateToSpecialist(
        conversationId,
        studentId,
        `Bot deferiu para coordenação. Pergunta original: "${userMessage}"`,
        { skipHandoffMessage: true }
      );
    }
  }

  private async escalateToSpecialist(
    conversationId: string,
    studentId: string,
    reason: string,
    opts: { skipHandoffMessage?: boolean } = {}
  ): Promise<void> {
    const history = await this.stateRepository.getHistory(conversationId, 5);
    const context = history.map((m) => `${m.role}: ${m.content}`).join("\n");

    // Mark the contact as awaiting human attendance — this is what increments
    // the "Atendimentos Humanos" counter in the admin panel.
    try {
      await this.stateRepository.pauseBot(studentId, reason);
    } catch (pauseError) {
      logger.error({ error: pauseError, studentId }, "Failed to mark contact as bot_paused");
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
        const handoffMessage = "Vou pedir para a coordenação do Colégio Ideal te responder por aqui mesmo - em instantes alguém da nossa equipe entra em contato com você. 😊";
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

function alreadyEscalatedInHistory(history: ConversationMessage[]): boolean {
  return history.some(
    (m) => m.role === "tool" && m.content.includes("escalate_to_specialist")
  );
}
// Focused phrasing prompt — used when we've already chosen the tool and just
// need natural text. By stripping the production system prompt (which mentions
// tool names) we avoid Gemini hallucinating function-call syntax in its reply.
function buildPhrasingSystemPrompt(escalateAfter?: string): string {
  const lines = [
    "Você é o atendimento oficial do Colégio Ideal (sem nome próprio — fale em nome do colégio, use 'nós'/'aqui no Colégio Ideal'). Sua única tarefa é responder ao cliente em UMA mensagem natural de WhatsApp, usando EXCLUSIVAMENTE o que está no resultado da ferramenta no histórico (role=tool).",
    "",
    "REGRAS DURAS:",
    "- Responda em 1-3 frases curtas, tom WhatsApp informal.",
    "- Use o nome do cliente se ele já apareceu na conversa.",
    "- Se há valor numérico no resultado, formate como 'R$ 1.200/mês'.",
    "- NÃO escreva 'aguarde', 'um momento', 'vou verificar'.",
    "- NUNCA escreva texto que pareça uma chamada de função (ex: 'escalate_to_specialist(...)'). Você só escreve português natural.",
    "- NÃO repita o resumo bruto da ferramenta — extraia o ponto que o cliente perguntou.",
    "- PROIBIDO inventar dados que não estão no resultado da ferramenta. Não tem na ferramenta? Não responda esse ponto.",
    "  Especificamente PROIBIDO: inventar taxa de matrícula, valor de matrícula, datas de vencimento, políticas de desconto, regras de pagamento, datas de início das aulas, lista de documentos, link de cadastro, prazo de resposta. Se o cliente perguntar qualquer um desses, diga: 'Essa parte quem te confirma é a coordenação, já vou pedir pra eles te chamarem aqui.' — e nada mais.",
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
    "REGRAS:",
    "- Tom WhatsApp natural, 1-2 frases curtas.",
    "- Se o cliente ainda não disse o nome dele e essa parece ser a primeira interação, pergunte: 'Como é seu nome?'",
    "- Se o cliente já disse o nome (em mensagens anteriores), USE o nome.",
    "- Se o cliente está confirmando algo ou agradecendo, responda curto e simpático.",
    "- Se o cliente está perguntando algo CONCRETO que você não consegue responder com base no histórico (taxa, prazo, política, documento, data específica), diga: 'Essa parte quem te confirma é a coordenação, eles te respondem aqui em instantes.'",
    "- PROIBIDO inventar números, datas, taxas, políticas, ou qualquer dado.",
    "- PROIBIDO escrever texto que pareça chamada de função (escalate_to_specialist(...), get_enrollment_info(...), etc).",
    "- PROIBIDO copiar markdown bruto de resultado de ferramenta (** ** com Preços: Mensal: ...). Sempre reformule em português corrido.",
    "- PROIBIDO dizer 'aguarde', 'um momento', 'vou verificar'.",
  ].join("\n");
}

// Belt-and-suspenders: strip lines that look like function calls in case
// Gemini still emits them despite the phrasing prompt.
function sanitizeReply(text: string): string {
  // Drop any line containing a parenthesised name=value list that looks like
  // a tool invocation (e.g. `escalate_to_specialist(reason="other", ...)`).
  const cleaned = text
    .split("\n")
    .filter((line) => !/[a-z_]+\([a-z_]+\s*=\s*["']/i.test(line))
    .join("\n")
    .trim();
  return cleaned;
}
