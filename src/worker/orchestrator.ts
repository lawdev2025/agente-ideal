import { LLMProvider } from "../llm/provider";
import { StateRepository, Contact } from "../state/repository";
import { executeKBTool } from "../kb/tools";
import { WhatsAppClient } from "../whatsapp/client";
import { EscalationHandler } from "../handoff/telegram";
import { logger } from "../logger";
import { config } from "../config";
import { routeIntent, RoutedIntent, detectUnit, detectNivel } from "./intent-router";
import { matchDirectResponse } from "../kb/direct-responses";
import { LearningRepository } from "../learning/repository";
import type { CacheableIntentKind } from "../learning/normalize";

export interface ConversationMessage {
  role: string;
  content: string;
}

// Os 5 intents determinísticos que o cache aprendido pode reproduzir. Espelha
// CacheableIntentKind em src/learning/normalize.ts. escalate/soft_redirect/
// ask_llm ficam de fora (sensíveis demais ou ambíguos por natureza).
type CacheableIntent = Extract<
  RoutedIntent,
  {
    kind:
      | "enrollment_info"
      | "enrollment_contact"
      | "unit_info"
      | "document_request"
      | "visit_request";
  }
>;

const CACHEABLE_INTENT_KINDS: ReadonlySet<string> = new Set([
  "enrollment_info",
  "enrollment_contact",
  "unit_info",
  "document_request",
  "visit_request",
]);

function isCacheableIntent(kind: string): boolean {
  return CACHEABLE_INTENT_KINDS.has(kind);
}

export class MessageOrchestrator {
  constructor(
    private llmProvider: LLMProvider,
    private stateRepository: StateRepository,
    private whatsappClient: WhatsAppClient,
    private escalationHandler: EscalationHandler,
    // Opcional: quando ausente (ex.: testes), o aprendizado é simplesmente
    // ignorado e o bot se comporta exatamente como antes.
    private learning?: LearningRepository
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

      // Carrega o contato (o webhook já garantiu que ele existe). Usamos pra
      // saber se já tem nome salvo antes de tentar capturar. Falha aqui não
      // derruba a conversa — seguimos com um registro vazio.
      let contact: Contact = {
        wa_id: studentId,
        name: null,
        phone: null,
        bot_paused: false,
        paused_reason: null,
        paused_at: null,
        last_seen_at: null,
      };
      try {
        contact = await this.stateRepository.getOrCreateContact(studentId);
      } catch (err) {
        logger.error({ err, studentId }, "getOrCreateContact falhou — seguindo sem registro");
      }

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
        const reply = buildPresentialValuesReply(detectUnit(userMessage));
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

      // Captura do nome: se o contato ainda não tem nome salvo e o bot já pediu
      // ("como posso te chamar?"), esta mensagem é a resposta com o nome.
      // Salva no contato pra aparecer no painel. Best-effort — não atrapalha o
      // fluxo se não der pra extrair um nome plausível.
      if (!contact.name) {
        const greetingAsked = history.some(
          (m) => m.role === "assistant" && /como posso te chamar/i.test(m.content)
        );
        if (greetingAsked) {
          const name = extractName(userMessage);
          if (name) {
            try {
              await this.stateRepository.setName(studentId, name);
              contact.name = name;
              logger.info({ studentId, name }, "Nome do contato capturado e salvo");
            } catch (err) {
              logger.error({ err, studentId }, "Falha ao salvar nome do contato");
            }
          }
        }
      }

      // RESPOSTAS DIRETAS (school_faq): info que o dono cadastrou no painel com
      // gatilho + resposta exata. Se a mensagem bate num gatilho, devolvemos a
      // resposta VERBATIM — sem LLM, que não pode omitir nem negar. Avaliado
      // antes do roteamento pra qualquer assunto novo funcionar sem código.
      // Fica depois do guard de preço (linha ~75) e do pause: a política de
      // valores e o handoff humano continuam tendo prioridade.
      const direct = await matchDirectResponse(userMessage);
      if (direct) {
        logger.info({ studentId }, "Direct response (school_faq) matched — sending verbatim");
        await this.stateRepository.appendMessage(conversationId, "assistant", direct);
        await this.whatsappClient.sendMessage(studentId, direct);
        return;
      }

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

      // Soft redirect: tema do colégio que o bot não tem na base (bolsa,
      // desconto, documento, transporte, evento). Redireciona pra secretaria,
      // avisa a equipe em silêncio e NÃO pausa o bot — o cliente segue
      // conversando normalmente.
      if (intent.kind === "soft_redirect") {
        await this.softRedirectToSecretaria(
          conversationId,
          studentId,
          intent.reason
        );
        return;
      }

      // Intents determinísticos cacheáveis (documento, visita, matrícula,
      // contato, unidade): roteados pelo regex com confiança. APRENDEMOS esse
      // mapeamento (frase→intent vira candidata no cache) e despachamos pelo
      // caminho determinístico compartilhado. NÃO confiamos no LLM pra rotear.
      if (isCacheableIntent(intent.kind)) {
        await this.learnFromRegex(userMessage, intent.kind as CacheableIntentKind);
        await this.dispatchCacheableIntent(
          intent as CacheableIntent,
          conversationId,
          studentId,
          userMessage,
          contact,
          conversationHistory
        );
        return;
      }

      // Caso ambíguo (ask_llm). ANTES de gastar uma chamada de LLM, consultamos
      // o cache aprendido: se uma frase parecida já foi roteada com confiança e
      // promovida a 'active', reaproveitamos aquele intent determinístico. Só
      // entra fora da primeira interação (a saudação oficial tem prioridade) e
      // quando o aprendizado está disponível. Best-effort — qualquer erro cai no
      // fluxo de LLM normal.
      const isFirstInteraction = !conversationHistory.some(
        (m) => m.role === "assistant"
      );
      if (!isFirstInteraction && this.learning) {
        let cachedKind: CacheableIntentKind | null = null;
        try {
          cachedKind = await this.learning.lookup(userMessage);
        } catch (err) {
          logger.warn({ err }, "learning.lookup falhou — seguindo pro LLM");
        }
        if (cachedKind) {
          logger.info(
            { intent: cachedKind, via: "learning-cache" },
            "Cache aprendido respondeu (LLM evitado)"
          );
          await this.dispatchCacheableIntent(
            this.buildIntentFromCache(cachedKind, userMessage),
            conversationId,
            studentId,
            userMessage,
            contact,
            conversationHistory
          );
          return;
        }
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

  // Despacha os 5 intents determinísticos cacheáveis pelos handlers existentes.
  // Compartilhado entre o caminho do regex (rota confiante) e o do cache
  // aprendido (rota reconstruída a partir de uma frase parecida). O
  // comportamento é IDÊNTICO ao bloco inline anterior — só foi extraído pra não
  // duplicar a lógica nos dois pontos de entrada.
  private async dispatchCacheableIntent(
    intent: CacheableIntent,
    conversationId: string,
    studentId: string,
    userMessage: string,
    contact: Contact,
    conversationHistory: ConversationMessage[]
  ): Promise<void> {
    if (intent.kind === "document_request") {
      await this.handleDocumentRequest(conversationId, studentId, userMessage, intent.unit);
      await this.recordTurnOutcome(userMessage, true);
      return;
    }

    if (intent.kind === "visit_request") {
      await this.handleVisitRequest(conversationId, studentId, intent.unit, conversationHistory);
      await this.recordTurnOutcome(userMessage, true);
      return;
    }

    // Pedido de telefone/secretaria sem unidade: pergunta determinística qual
    // unidade — não dispara LLM nem escalação.
    if (intent.kind === "enrollment_contact" && !intent.unit) {
      const ask =
        "Claro! Temos 3 unidades — me diz qual você prefere que eu te passe o número:\n\n" +
        "🏫 *Sede (Batista Campos)*\n" +
        "🏫 *Augusto Montenegro*\n" +
        "🏫 *Cidade Nova (Ananindeua)*";
      await this.stateRepository.appendMessage(conversationId, "assistant", ask);
      await this.whatsappClient.sendMessage(studentId, ask);
      await this.recordTurnOutcome(userMessage, true);
      return;
    }

    // enrollment_info COM nível concreto → resposta determinística por template,
    // sem chamar o LLM (a tool já devolve texto fixo). Sinal vago segue no fluxo
    // de tool (runDeterministicToolFlow), que é a válvula pra palavra-chave que
    // disparou por engano.
    if (intent.kind === "enrollment_info" && intent.nivel) {
      await this.handleEnrollmentInfo(conversationId, studentId, userMessage, intent, contact.name);
      await this.recordTurnOutcome(userMessage, true);
      return;
    }

    await this.runDeterministicToolFlow(
      conversationId,
      studentId,
      userMessage,
      intent,
      conversationHistory
    );
  }

  // Registra que o regex roteou (com confiança) essa frase pra um intent
  // cacheável → cria/atualiza a entrada como candidata. Best-effort: nunca
  // derruba o atendimento.
  private async learnFromRegex(message: string, kind: CacheableIntentKind): Promise<void> {
    if (!this.learning) return;
    try {
      await this.learning.recordObservation(message, kind);
    } catch (err) {
      logger.warn({ err }, "learning.recordObservation falhou (ignorado)");
    }
  }

  // Registra o desfecho do turno (positivo = sem deflexão/escalação). Promove
  // candidata→ativa quando os limiares batem; negativo rebaixa ativa. No-op se
  // o aprendizado não estiver disponível ou a frase nunca tiver sido observada.
  private async recordTurnOutcome(message: string, positive: boolean): Promise<void> {
    if (!this.learning) return;
    try {
      await this.learning.recordOutcome(message, positive);
    } catch (err) {
      logger.warn({ err }, "learning.recordOutcome falhou (ignorado)");
    }
  }

  // Reconstrói um RoutedIntent a partir de um acerto do cache: o cache guarda só
  // o TIPO de intent, então re-derivamos nível/unidade da própria mensagem com
  // os mesmos detectores do roteador.
  private buildIntentFromCache(kind: CacheableIntentKind, message: string): CacheableIntent {
    const unit = detectUnit(message);
    switch (kind) {
      case "enrollment_info":
        return { kind, nivel: detectNivel(message), unit };
      case "enrollment_contact":
        return { kind, unit };
      case "unit_info":
        return { kind, unit };
      case "document_request":
        return { kind, unit };
      case "visit_request":
        return { kind, unit };
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
        flow: escalateAfter ? "phrasing+escalateAfter" : "phrasing",
      });
      reply = sanitizeReply(r.message?.trim() ?? "");
    } catch (e) {
      logger.error({ error: e }, "LLM phrasing call failed — using raw tool output");
    }

    if (!reply) reply = toolResult;

    // Rede de segurança: se o LLM escapou e deu uma resposta de deflexão,
    // REESCREVEMOS. Mas o texto certo depende do TEMA: pergunta de valor vira
    // a resposta presencial; qualquer outra dúvida vira o redirect pra
    // secretaria (NUNCA mandamos resposta de preço pra pergunta que não é de
    // preço). O cliente nunca vê a deflexão crua.
    const deflected = isDeflectionReply(reply);
    if (deflected) {
      reply = isPriceOrMaterialQuestion(userMessage)
        ? buildPresentialValuesReply(detectUnit(userMessage))
        : SECRETARIA_REDIRECT_REPLY;
      logger.warn({ tema: isPriceOrMaterialQuestion(userMessage) ? "preço" : "outro" }, "LLM produced deflection text — overriding");
    }

    await this.stateRepository.appendMessage(conversationId, "assistant", reply);
    await this.whatsappClient.sendMessage(studentId, reply);

    // After answering the primary question, SOFT-redirect the off-scope part
    // of a mixed-intent message (desconto, transporte, etc.) — avisa a equipe
    // em silêncio, sem pausar nem mandar handoff pro cliente.
    if (escalateAfter) {
      await this.softNotifyTeam(conversationId, studentId, escalateAfter);
    } else if (deflected) {
      // Bot tropeçou e redirecionou pra secretaria: avisa a equipe em silêncio.
      await this.softNotifyTeam(
        conversationId,
        studentId,
        `Bot redirecionou para secretaria. Pergunta original: "${userMessage}"`
      );
    }

    // Desfecho pro aprendizado: deflexão = negativo (rebaixa/não promove),
    // resposta limpa = positivo. É o sinal que decide se uma frase candidata
    // vira mapeamento ativo do cache.
    await this.recordTurnOutcome(userMessage, !deflected);

    void conversationHistory;
  }

  // Resposta determinística de matrícula (enrollment_info com nível concreto):
  // monta o texto por template e envia, SEM tool e SEM LLM. Se a mensagem trazia
  // um tema off-scope junto (escalateAfter), avisa a equipe em silêncio depois —
  // mesmo comportamento do fluxo antigo, só que sem o custo do fraseamento.
  private async handleEnrollmentInfo(
    conversationId: string,
    studentId: string,
    userMessage: string,
    intent: Extract<RoutedIntent, { kind: "enrollment_info" }>,
    name: string | null
  ): Promise<void> {
    const reply = buildEnrollmentReply({
      nivel: intent.nivel,
      unit: intent.unit,
      name,
      asksSchedule: SCHEDULE_KEYWORDS.test(userMessage),
      escalateAfter: intent.escalateAfter,
    });
    await this.stateRepository.appendMessage(conversationId, "assistant", reply);
    await this.whatsappClient.sendMessage(studentId, reply);
    if (intent.escalateAfter) {
      await this.softNotifyTeam(conversationId, studentId, intent.escalateAfter);
    }
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
      { systemPromptOverride: chatPrompt, flow: "chat" }
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

    // Rede de segurança: se o LLM produziu deflexão, sobrescreve. Pergunta de
    // valor → resposta presencial fixa; qualquer outra → redirect pra
    // secretaria (nunca resposta de preço pra pergunta que não é de preço).
    const deflected = isDeflectionReply(reply);
    if (deflected) {
      reply = isPriceOrMaterialQuestion(userMessage)
        ? buildPresentialValuesReply(detectUnit(userMessage))
        : SECRETARIA_REDIRECT_REPLY;
      logger.warn({ tema: isPriceOrMaterialQuestion(userMessage) ? "preço" : "outro" }, "LLM produced deflection text — overriding");
    }

    await this.stateRepository.appendMessage(conversationId, "assistant", reply);
    await this.whatsappClient.sendMessage(studentId, reply);

    // Avisa a equipe no Telegram em silêncio que o bot redirecionou pra
    // secretaria (não pausa, não manda handoff pro cliente).
    if (deflected) {
      await this.softNotifyTeam(
        conversationId,
        studentId,
        `Bot redirecionou para secretaria. Pergunta original: "${userMessage}"`
      );
    }
  }

  // Soft redirect: o cliente perguntou algo do colégio que o bot não tem na
  // base (bolsa, desconto, documento, transporte, evento). Não é handoff: a
  // gente aponta pra secretaria, mantém o bot ATIVO e só avisa a equipe em
  // silêncio. O cliente segue podendo conversar.
  private async softRedirectToSecretaria(
    conversationId: string,
    studentId: string,
    reason: string
  ): Promise<void> {
    const reply = SECRETARIA_REDIRECT_REPLY;
    await this.stateRepository.appendMessage(conversationId, "assistant", reply);
    await this.whatsappClient.sendMessage(studentId, reply);
    await this.softNotifyTeam(conversationId, studentId, reason);
  }

  // Necessidade documental (boletim, histórico, declaração, atestado, 2ª via,
  // transferência): feito na SECRETARIA da unidade. Se o cliente já disse a
  // unidade, mandamos o telefone dela direto; senão perguntamos qual unidade
  // pra passar o número certo. Sempre avisa a equipe em silêncio, sem pausar.
  private async handleDocumentRequest(
    conversationId: string,
    studentId: string,
    userMessage: string,
    unit?: string
  ): Promise<void> {
    const reply = unit
      ? buildDocumentReplyWithUnit(unit)
      : DOCUMENT_ASK_UNIT_REPLY;
    await this.stateRepository.appendMessage(conversationId, "assistant", reply);
    await this.whatsappClient.sendMessage(studentId, reply);
    await this.softNotifyTeam(
      conversationId,
      studentId,
      `Necessidade documental (secretaria). Mensagem: "${userMessage}"`
    );
  }

  // Pedido de visita / link de agendamento: resposta DETERMINÍSTICA com o link
  // da unidade. Se a unidade não veio na mensagem atual, procura no histórico
  // recente (cliente disse "Cidade Nova" e na mensagem seguinte só "tem link?").
  // Sem LLM e sem pausar o bot — visita é lead quente, então avisa a equipe.
  private async handleVisitRequest(
    conversationId: string,
    studentId: string,
    unit: string | undefined,
    conversationHistory: ConversationMessage[]
  ): Promise<void> {
    const resolvedUnit = unit ?? this.findRecentUnit(conversationHistory);
    const reply = resolvedUnit
      ? buildVisitReplyWithUnit(resolvedUnit)
      : VISIT_ASK_UNIT_REPLY;
    await this.stateRepository.appendMessage(conversationId, "assistant", reply);
    await this.whatsappClient.sendMessage(studentId, reply);
    await this.softNotifyTeam(
      conversationId,
      studentId,
      `Cliente quer agendar VISITA${resolvedUnit ? ` (${resolvedUnit})` : ""}.`
    );
  }

  // Varre o histórico do mais recente pro mais antigo e devolve a primeira
  // unidade citada — usado pra resolver "tem link?" depois que o cliente já
  // disse de qual unidade estava falando.
  private findRecentUnit(history: ConversationMessage[]): string | undefined {
    for (let i = history.length - 1; i >= 0; i--) {
      const u = detectUnit(history[i]?.content ?? "");
      if (u) return u;
    }
    return undefined;
  }

  // Aviso silencioso pra equipe no Telegram: registra no histórico e notifica
  // o grupo, MAS não pausa o bot nem manda "vou pedir pra coordenação" pro
  // cliente. Usado quando o bot redireciona pra secretaria sem virar handoff.
  private async softNotifyTeam(
    conversationId: string,
    studentId: string,
    reason: string
  ): Promise<void> {
    await this.escalateToSpecialist(conversationId, studentId, reason, {
      skipHandoffMessage: true,
      skipPause: true,
    });
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
//
// RAIZ DE BUG (não reintroduzir): só pegamos o LLM FINGINDO um handoff humano
// ("vou pedir pra coordenação", "quem te confirma é a secretaria"). NÃO pegamos
// "não tenho essa informação" genérico — isso às vezes é a resposta CORRETA
// (ex: "qual meu nome?" → "não tenho acesso ao seu nome, como te chamo?"). Quando
// pegávamos isso, o bot reescrevia uma fala boa num "fale com a secretaria"
// sem sentido — a resposta estranha do print. O prompt já manda o LLM oferecer
// a secretaria pra dúvidas concretas; essas frases caem nos padrões de punt abaixo.
export function isDeflectionReply(text: string): boolean {
  const t = (text || "").toLowerCase();
  const patterns = [
    /coordena[çc][ãa]o\s+(te|vai|j[áa])/,
    /quem\s+te\s+(confirma|passa|responde)/,
    /vou\s+(pedir|chamar|avisar)\s+(pra|para|a|o)/,
    /j[áa]\s+vou\s+(pedir|chamar|avisar)/,
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

// Extrai um nome plausível da resposta do cliente à pergunta "como posso te
// chamar?". Aceita "João", "meu nome é João", "me chamo Maria Silva", "sou a
// Ana", "pode me chamar de Zé". Devolve null pra saudações/perguntas/não-nomes
// (ex: "oi", "bom dia", "quero saber o valor"). Exportada pra teste.
export function extractName(raw: string): string | null {
  if (!raw) return null;
  let t = raw.trim();
  // Remove saudação inicial ("oi,", "olá!", "opa") antes do nome.
  t = t.replace(/^(ol[áa]|oi+|opa|e[ai]+|hey|salve)[\s,!.]+/i, "").trim();
  // Remove prefixos comuns de apresentação.
  t = t
    .replace(
      /^(meu\s+nome\s+(?:é|e|eh)\s+|me\s+chamo\s+|pode\s+me\s+chamar\s+de\s+|me\s+chama\s+de\s+|sou\s+(?:o|a)\s+|sou\s+|aqui\s+(?:é|e|eh)\s+(?:o\s+|a\s+)?|nome[:\s]+|é\s+(?:o\s+|a\s+)?|e\s+(?:o\s+|a\s+)?)/i,
      ""
    )
    .trim();
  // Pega de 1 a 3 palavras alfabéticas (acentos, hífen, apóstrofo).
  const m = t.match(/^[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2}/u);
  if (!m) return null;
  let name = m[0].trim();
  const firstWord = name
    .split(/\s+/)[0]
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  // Palavras que NÃO são nome — se a fala começa com uma delas, não captura.
  const STOP = new Set([
    "sim", "nao", "ok", "obrigado", "obrigada", "valeu", "quero", "queria",
    "preciso", "gostaria", "quanto", "qual", "quais", "tem", "voce", "voces",
    "bom", "boa", "dia", "tarde", "noite", "tudo", "bem", "como", "onde",
    "quando", "porque", "pode", "poderia", "info", "informacao", "informacoes",
    "valor", "valores", "mensalidade", "matricula", "material", "ajuda",
    "ajudar", "nada", "talvez", "ainda", "sei", "entao", "blz", "beleza",
    "certo", "claro", "aham", "uniforme", "horario", "telefone", "numero",
    "oi", "ola", "opa", "ei", "eai", "hey", "salve", "oie", "oii",
  ]);
  if (STOP.has(firstWord)) return null;
  if (name.replace(/[^\p{L}]/gu, "").length < 2) return null;
  if (name.length > 40) return null;
  // Title-case leve (primeira letra de cada palavra).
  name = name
    .split(/\s+/)
    .map((w) => w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1).toLocaleLowerCase("pt-BR"))
    .join(" ");
  return name;
}

// Links de agendamento de visita presencial — um por unidade.
// Chaves casam com os rótulos de UNIT_NAME_PATTERNS no intent-router.
const VISIT_LINKS: Record<string, string> = {
  "Batista Campos":
    "https://grupoideal.com.br?quillbooking_calendar=agendamento-ideal-batista-campos&event=visita-ideal-batista-campos",
  "Augusto Montenegro":
    "https://grupoideal.com.br?quillbooking_calendar=agendamento-ideal-augusto-montenegro&event=visita-ideal-augusto-montenegro",
  "Cidade Nova":
    "https://grupoideal.com.br?quillbooking_calendar=agendamento-ideal-cidade-nova&event=visita-ideal-cidade-nova",
};

// Resposta determinística de visita quando a unidade é conhecida: manda o link
// direto. Sem LLM — garante que o link SEMPRE aparece.
function buildVisitReplyWithUnit(unit: string): string {
  const link = VISIT_LINKS[unit] ?? VISIT_LINKS["Batista Campos"];
  return (
    `Que ótimo que você quer conhecer a gente! 🎉\n\n` +
    `Pra agendar sua visita à unidade *${unit}*, é só clicar no link e escolher o melhor horário:\n` +
    `👉 ${link}\n\n` +
    `Qualquer dúvida, é só chamar aqui! 😊`
  );
}

// Resposta de visita sem unidade definida: lista os 3 links pra escolher.
const VISIT_ASK_UNIT_REPLY =
  "Que ótimo que você quer conhecer a gente! 🎉\n\n" +
  "Temos 3 unidades — é só clicar no link da que você prefere pra agendar a visita:\n" +
  `🏫 *Sede (Batista Campos)*: ${VISIT_LINKS["Batista Campos"]}\n` +
  `🏫 *Augusto Montenegro*: ${VISIT_LINKS["Augusto Montenegro"]}\n` +
  `🏫 *Cidade Nova (Ananindeua)*: ${VISIT_LINKS["Cidade Nova"]}`;

// Resposta canônica para qualquer pergunta de valor. Centralizada aqui pra
// nunca divergir entre paths (top-level, sanitizer, fallback).
// Quando a unidade é conhecida exibe o link de visita daquela unidade;
// quando não é, mostra os três para o cliente escolher.
function buildPresentialValuesReply(unit?: string): string {
  const intro =
    "Os valores de *mensalidade*, *matrícula* e *material didático* nós informamos *somente presencialmente* — " +
    "assim a equipe consegue te apresentar as melhores condições com calma. 🤝\n\n";

  if (unit && VISIT_LINKS[unit]) {
    return (
      intro +
      `Que tal agendar uma visita à unidade *${unit}*? É só clicar no link:\n` +
      `👉 ${VISIT_LINKS[unit]}`
    );
  }

  return (
    intro +
    "Quer agendar uma visita? Escolha a unidade mais próxima:\n" +
    `🏫 *Sede (Batista Campos)*: ${VISIT_LINKS["Batista Campos"]}\n` +
    `🏫 *Augusto Montenegro*: ${VISIT_LINKS["Augusto Montenegro"]}\n` +
    `🏫 *Cidade Nova (Ananindeua)*: ${VISIT_LINKS["Cidade Nova"]}`
  );
}

// Sinais de pergunta sobre HORÁRIO/turno dentro de uma intenção de matrícula.
// O horário é igual nas 3 unidades, então respondemos direto (sem pedir unidade).
const SCHEDULE_KEYWORDS = /\b(hor[áa]rio|turno|matutino|vespertino|integral)\b/i;

// Resposta DETERMINÍSTICA para enrollment_info quando já temos um nível concreto
// (médio, fundamental, etc.). Substitui a chamada de fraseamento ao Haiku: a tool
// get_enrollment_info já devolve texto fixo (política presencial), então frasear
// com LLM era token gasto à toa. Interpola o nome do cliente quando disponível.
// NÃO é usada para sinais vagos ("aula", "curso" sem série) — esses seguem no
// fluxo LLM, que serve de válvula pra palavras-chave que disparam por engano.
function buildEnrollmentReply(opts: {
  nivel?: string;
  unit?: string;
  name?: string | null;
  asksSchedule: boolean;
  escalateAfter?: string;
}): string {
  const { nivel, unit, name, asksSchedule, escalateAfter } = opts;
  const hi = name ? `Oi ${name}! ` : "";
  const nivelTxt = nivel ? ` no *${nivel}*` : "";

  let reply: string;

  if (asksSchedule) {
    // Horário/turno é igual nas 3 unidades — resposta direta, sem pedir unidade.
    reply =
      `${hi}As aulas começam às *07:30*, com 30 minutos de tolerância — ` +
      `igual nas 3 unidades. 😊\nQuer agendar uma visita pra conhecer a estrutura?`;
  } else if (unit) {
    // Temos a unidade → entrega completa: política presencial + link + telefone.
    reply =
      `${hi}Que bom seu interesse${nivelTxt} na unidade *${unit}*! 🎓\n` +
      `Os valores de mensalidade, matrícula e material são informados ` +
      `*presencialmente* — assim a equipe te apresenta as melhores condições. 🤝\n\n` +
      `👉 Agende uma visita: ${VISIT_LINKS[unit] ?? VISIT_LINKS["Batista Campos"]}\n` +
      `📞 Ou fale com a secretaria: *${UNIT_SECRETARIA_PHONE[unit] ?? "(91) 3323-5000"}*`;
  } else {
    // Sem unidade → pergunta qual (o cliente escolhe pra receber link + telefone).
    reply =
      `${hi}Que bom seu interesse${nivelTxt}! 🎓 Temos 3 unidades — me diz qual ` +
      `fica melhor pra você que eu já te passo a visita e o contato certinho:\n` +
      `🏫 *Sede (Batista Campos)*\n🏫 *Augusto Montenegro*\n🏫 *Cidade Nova (Ananindeua)*`;
  }

  if (escalateAfter) {
    // Intenção mista (ex.: "tem médio E desconto pra irmão?"): respondemos a
    // matrícula acima e apontamos o tema extra pra secretaria, sem handoff.
    const tema = escalateAfter.replace(/^Pergunta sobre\s*/i, "").split(".")[0].trim();
    reply +=
      `\n\nSobre ${tema}, quem confirma certinho é a *secretaria* — ` +
      `quer que eu te passe o telefone? 😊`;
  }

  return reply;
}

// Resposta canônica para temas do colégio que o bot não tem na base (bolsa,
// desconto, documento, transporte, evento) OU quando o LLM tropeçou numa
// dúvida concreta que não é de preço. Aponta pra secretaria e mantém a
// conversa viva — NUNCA é uma resposta de valor.
const SECRETARIA_REDIRECT_REPLY =
  "Essa informação específica quem confirma certinho é a nossa *secretaria* 😊\n\n" +
  "Quer que eu te passe o telefone pra você falar direto com a equipe?";

// Telefone da secretaria de cada unidade. As chaves casam EXATAMENTE com os
// rótulos que o intent-router devolve em `unit` (UNIT_NAME_PATTERNS).
const UNIT_SECRETARIA_PHONE: Record<string, string> = {
  "Batista Campos": "(91) 3323-5000",
  "Augusto Montenegro": "(91) 3273-0667",
  "Cidade Nova": "(91) 3273-0222",
};

// Resposta documental quando a unidade já é conhecida: aponta a secretaria e
// passa o telefone DAQUELA unidade.
function buildDocumentReplyWithUnit(unit: string): string {
  const phone = UNIT_SECRETARIA_PHONE[unit] ?? "(91) 3323-5000";
  return (
    "Boletim, histórico escolar, declarações e qualquer outro documento são " +
    "emitidos direto na *secretaria* da unidade. 📄\n\n" +
    `Na *${unit}* é só falar com a secretaria pelo *${phone}* que a equipe te orienta certinho. 😊`
  );
}

// Resposta documental sem unidade definida: explica a regra e pergunta de qual
// unidade o cliente precisa pra passar o número certo.
const DOCUMENT_ASK_UNIT_REPLY =
  "Boletim, histórico escolar, declarações e qualquer outro documento são " +
  "emitidos direto na *secretaria* da unidade. 📄\n\n" +
  "De qual unidade você precisa? Aí te passo o telefone certinho:\n" +
  "🏫 *Sede (Batista Campos)*\n" +
  "🏫 *Augusto Montenegro*\n" +
  "🏫 *Cidade Nova (Ananindeua)*";

// Detecta se a mensagem é sobre o VALOR de mensalidade/matrícula/material.
// Quando é, devolvemos a resposta fixa "valores só presencialmente" e nunca
// chamamos LLM nem escalamos — ordem do colégio.
//
// RAIZ DE BUG (não reintroduzir): a palavra "matrícula" SOZINHA NÃO entra aqui.
// "matrícula" tanto é a TAXA (preço) quanto o ATO de se matricular ("como faço
// a matrícula?", "quais documentos pra matrícula?"). Casá-la crua fazia toda
// pergunta de PROCESSO cair no boilerplate de valores — a resposta estranha do
// cliente. Só conta como preço quando há um sinal de custo explícito (valor,
// taxa, preço, quanto custa/é, etc.), que já cobre "valor/taxa da matrícula".
export function isPriceOrMaterialQuestion(text: string): boolean {
  const t = (text || "").toLowerCase();
  // Lookarounds com \p{L} (em vez de \b) porque \b não fecha depois de vogal
  // acentuada — "quanto é" quebraria com \b. As bordas garantem palavra inteira.
  return /(?<!\p{L})(valor|valores|mensalidade|mensalidades|pre[çc]o|pre[çc]os|custo|custa|custam|quanto\s+(custa|fica|sai|paga|[ée]|s[ãa]o)|anuidade|semestralidade|taxa|material\s+did[áa]tico|material\s+escolar|kit\s+escolar)(?!\p{L})/u.test(t);
}

// Identidade e dados oficiais compactos, compartilhados pelos prompts de frase
// e chat. Antes esses blocos eram repetidos (palavreado diferente) nos dois
// fluxos — o conteúdo ia inteiro em CADA chamada LLM. Centralizar aqui (e
// reusar VISIT_LINKS / UNIT_SECRETARIA_PHONE, já definidos acima) corta tokens
// por chamada e impede que telefones/links/endereços divirjam entre fluxos.
const IDENTIDADE_ATENDIMENTO =
  "Você é o atendimento oficial do Colégio Ideal (sem nome próprio — fale em nome do colégio, use 'nós'/'aqui no Colégio Ideal').";

const DADOS_COLEGIO = [
  "DADOS OFICIAIS (use VERBATIM — nunca invente outros):",
  `• Telefones fixos (NUNCA ofereça WhatsApp — o cliente já está no WhatsApp): Sede/Batista Campos ${UNIT_SECRETARIA_PHONE["Batista Campos"]} · Augusto Montenegro ${UNIT_SECRETARIA_PHONE["Augusto Montenegro"]} · Cidade Nova/Ananindeua ${UNIT_SECRETARIA_PHONE["Cidade Nova"]}.`,
  "• Endereços (dê a rua completa quando perguntarem): Sede — Rua dos Mundurucus, 1412, Batista Campos, Belém-PA · Augusto Montenegro — Rodovia Augusto Montenegro, 130, Parque Verde, Belém-PA · Cidade Nova — Conjunto Cidade Nova II, Av. SN-3, nº 3277 (esq. WE-21), Coqueiro, Ananindeua-PA.",
  `• Links de visita: Sede → ${VISIT_LINKS["Batista Campos"]} · Augusto Montenegro → ${VISIT_LINKS["Augusto Montenegro"]} · Cidade Nova → ${VISIT_LINKS["Cidade Nova"]}.`,
  "• 3 unidades, todas do Maternal ao Pré-Enem: Maternal, Jardim, Fund 1 (1º-5º), Fund 2 (6º-9º), Médio, Pré-Enem (Eixo). Sistema Poliedro. Material/uniforme comprados na escola/malharia. Aulas 07:30 (30 min de tolerância), iguais nas 3 unidades.",
].join("\n");

// Regras duras compartilhadas (telefone, valor, anti-alucinação). Antes estavam
// duplicadas e divergiam levemente entre os dois prompts; unificadas aqui. Cada
// regra dos prompts antigos está preservada — só sem repetição.
const REGRAS_COMUNS = [
  "REGRAS:",
  "- Tom WhatsApp, frases curtas. Use o nome do cliente se ele já apareceu na conversa.",
  "- Telefone/número/secretaria → dê o telefone fixo da unidade pedida (Sede por padrão se não disser qual). Nunca ofereça WhatsApp, nunca diga 'não tenho essa informação' (os números estão acima).",
  "- Valor/mensalidade/preço/taxa → diga que os valores são informados presencialmente e convide para agendar visita pelo link da unidade (ou liste os 3 se não souber qual). Nunca cite R$. Não use 'quem te confirma' / 'vou pedir pra eles' / 'vou chamar a coordenação'.",
  "- Dado concreto fora dos dados acima (taxa de matrícula, vencimento, desconto, pagamento, início das aulas, documentos, link de cadastro, prazo): NÃO invente — diga que a secretaria confirma certinho e ofereça o telefone (ex.: Sede (91) 3323-5000).",
  "- Nunca invente telefone com DDD diferente de 91. Nunca escreva texto que pareça chamada de função (ex.: get_enrollment_info(...)). Nunca diga 'aguarde' / 'um momento' / 'vou verificar'.",
].join("\n");

// Focused phrasing prompt — used when we've already chosen the tool and just
// need natural text. By stripping the production system prompt (which mentions
// tool names) we avoid Gemini hallucinating function-call syntax in its reply.
function buildPhrasingSystemPrompt(escalateAfter?: string): string {
  const lines = [
    `${IDENTIDADE_ATENDIMENTO} Sua tarefa: responder ao cliente em UMA mensagem natural de WhatsApp (1-3 frases curtas), usando EXCLUSIVAMENTE o resultado da ferramenta no histórico (role=tool) e os dados oficiais abaixo. Não repita o resumo bruto da ferramenta — extraia só o ponto que o cliente perguntou. Se ele perguntou duas coisas (ex.: valor + telefone), responda as duas. Termine com no máximo uma pergunta curta de avanço.`,
    "",
    DADOS_COLEGIO,
    "",
    REGRAS_COMUNS,
  ];
  if (escalateAfter) {
    lines.push(
      "",
      `IMPORTANTE: além de responder a pergunta principal, AVISE em UMA frase curta no final que essa parte específica (${escalateAfter.split(".")[0]}) quem confirma certinho é a secretaria, e ofereça passar o telefone. NÃO diga que a coordenação vai responder nem que alguém vai entrar em contato — o bot continua no atendimento. Não dê detalhes sobre o tema.`
    );
  }
  return lines.join("\n");
}

// Chat-only system prompt for ambiguous messages (greetings, name capture,
// small talk). No tools are exposed in this path so the prompt focuses on
// keeping the conversation moving without inventing data.
function buildChatSystemPrompt(): string {
  return [
    `${IDENTIDADE_ATENDIMENTO} Nesta mensagem você está apenas conversando por WhatsApp — outras decisões já foram tratadas pelo sistema. Responda natural, 1-2 frases curtas. Se o cliente está confirmando algo ou agradecendo, responda curto e simpático. Não copie markdown bruto de resultado de ferramenta — reformule em português corrido.`,
    "",
    DADOS_COLEGIO,
    "",
    REGRAS_COMUNS,
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
