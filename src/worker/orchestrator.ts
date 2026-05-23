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

      const history = this.stateRepository.getHistory(conversationId);
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

      // Deterministic path: clear matrícula/contact questions go straight to
      // the right tool — we don't trust the LLM to route correctly.
      if (intent.kind === "enrollment_info" || intent.kind === "enrollment_contact") {
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
    intent: Extract<RoutedIntent, { kind: "enrollment_info" | "enrollment_contact" }>,
    conversationHistory: ConversationMessage[]
  ): Promise<void> {
    const toolName =
      intent.kind === "enrollment_info" ? "get_enrollment_info" : "get_enrollment_contact";
    const args =
      intent.kind === "enrollment_info" && intent.nivel
        ? { nivel: intent.nivel }
        : {};

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

    this.stateRepository.appendMessage(
      conversationId,
      "tool",
      `Tool ${toolName} result: ${toolResult}`
    );

    const updatedHistory = this.stateRepository.getHistory(conversationId);
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

    this.stateRepository.appendMessage(conversationId, "assistant", reply);
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

    this.stateRepository.appendMessage(conversationId, "assistant", reply);
    await this.whatsappClient.sendMessage(studentId, reply);
  }

  private async escalateToSpecialist(
    conversationId: string,
    studentId: string,
    reason: string
  ): Promise<void> {
    const history = this.stateRepository.getHistory(conversationId, 5);
    const context = history.map((m) => `${m.role}: ${m.content}`).join("\n");
    try {
      await this.escalationHandler.escalateToGroup(studentId, reason, context);
      logger.info({ conversationId, studentId }, "Issue escalated to specialist via Telegram");
    } catch (telegramError) {
      logger.error({ error: telegramError }, "Failed to send escalation alert to Telegram (network/credentials error)");
    }
    try {
      this.stateRepository.appendMessage(
        conversationId,
        "tool",
        `Tool escalate_to_specialist result: ${reason}`
      );
      const handoffMessage =
        "Vou pedir para a coordena��o do Col�gio Ideal te responder por aqui mesmo � em instantes algu�m da nossa equipe entra em contato com voc�. ??";
      this.stateRepository.appendMessage(conversationId, "assistant", handoffMessage);
      if (!config.whatsapp.dryRun) {
        await this.whatsappClient.sendMessage(studentId, handoffMessage);
      } else {
        logger.info({ studentId, dryRun: true }, "WhatsApp notification skipped (DRY_RUN mode)");
      }
    } catch (dbOrWsError) {
      logger.error({ error: dbOrWsError }, "Error recording handoff message in database/WhatsApp client");
    }
  }
}
// Focused phrasing prompt — used when we've already chosen the tool and just
// need natural text. By stripping the production system prompt (which mentions
// tool names) we avoid Gemini hallucinating function-call syntax in its reply.
function buildPhrasingSystemPrompt(escalateAfter?: string): string {
  const lines = [
    "Você é Ana, atendente do Colégio Ideal. Sua única tarefa é responder ao cliente em UMA mensagem natural de WhatsApp, usando EXCLUSIVAMENTE o que está no resultado da ferramenta no histórico (role=tool).",
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
    "Você é Ana, atendente do Colégio Ideal, conversando por WhatsApp. Nesta mensagem você está apenas conversando — outras decisões já foram tratadas pelo sistema.",
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
