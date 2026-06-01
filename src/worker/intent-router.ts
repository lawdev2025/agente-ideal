/**
 * Deterministic intent router. Sits in front of the LLM so we don't depend on
 * Gemini correctly picking between get_enrollment_info and escalate_to_specialist.
 *
 * The model is allowed to choose freely for ambiguous messages, but for the
 * core matrícula path (someone clearly asking about a known level/price/course)
 * we pre-pick get_enrollment_info, and for clearly out-of-scope topics we
 * pre-pick escalate. This keeps the bot consistent even when the underlying
 * model drifts or the prompt is tweaked.
 */

export type RoutedIntent =
  | {
      kind: "enrollment_info";
      nivel?: string;
      unit?: string;
      /**
       * Secondary off-scope reason present in the same message (e.g. user
       * asked for "valor do Médio E desconto pra irmão"). We answer the
       * primary intent and then SOFT-redirect the extra topic to the
       * secretaria (no handoff, no pause).
       */
      escalateAfter?: string;
    }
  | { kind: "enrollment_contact"; unit?: string }
  | { kind: "unit_info"; unit?: string }
  /**
   * Necessidade documental (boletim, histórico escolar, declaração, atestado,
   * 2ª via, transferência). Tudo isso é feito na SECRETARIA da unidade — a
   * gente responde com o telefone da unidade pedida (ou pergunta qual unidade)
   * e avisa a equipe em silêncio. NÃO pausa o bot.
   */
  | { kind: "document_request"; unit?: string }
  /**
   * HARD handoff: pause the bot and bring a human in. Reserved for the two
   * cases that truly need a person — the client explicitly asked for a human,
   * or the topic is entirely outside the school's scope.
   */
  | { kind: "escalate"; reason: string }
  /**
   * SOFT redirect: a school-related topic the bot has no data for (bolsa,
   * desconto, documento, transporte, evento). We DON'T hand off or pause —
   * we point the client to the secretaria and notify the team quietly.
   */
  | { kind: "soft_redirect"; reason: string }
  | { kind: "ask_llm" };

const NIVEL_PATTERNS: Array<{ regex: RegExp; nivel: string }> = [
  // Educação Infantil (must come FIRST so maternal/jardim never reaches escalation)
  {
    regex:
      /\b(maternal|jardim\s*[iI1]?\b|jardim\s+de\s+inf[âa]ncia|educa[çc][ãa]o\s+infantil|ber[çc][áa]rio|pr[ée][-\s]?escola|cre+che|infantil)\b/i,
    nivel: "Educação Infantil",
  },
  // Fundamental 1
  {
    regex:
      /\b(fundamental\s*1|fund\s*1|fundamental\s*i\b|prim[áa]rio|anos\s+iniciais|[1-5][ºo°]?\s*ano|primeiro\s+ao\s+quinto)\b/i,
    nivel: "Fundamental 1",
  },
  // Fundamental 2
  {
    regex:
      /\b(fundamental\s*2|fund\s*2|fundamental\s*ii\b|anos\s+finais|[6-9][ºo°]?\s*ano|sexto\s+ao\s+nono)\b/i,
    nivel: "Fundamental 2",
  },
  // Pré-Enem variants (must come BEFORE Ensino Médio so "3º ano" hits this branch)
  {
    regex:
      /\b(pr[ée][-\s]?enem|terceir[ãa]o|cursinho|pr[ée][-\s]?vestibular|vestibular|eixo|3[ºo°]?\s*ano)\b/i,
    nivel: "Pré-Enem",
  },
  // Ensino Médio
  {
    regex:
      /\b(ensino\s+m[ée]dio|m[ée]dio|colegial|EM|1[ªa]\s*s[ée]rie|2[ªa]\s*s[ée]rie)\b/i,
    nivel: "Ensino Médio",
  },
];

// HARD off-scope → handoff humano de verdade (pausa o bot). Apenas dois casos
// merecem isso: o cliente pediu um humano em palavras claras, ou o assunto não
// tem NADA a ver com o colégio.
const HARD_OFF_SCOPE_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  {
    regex:
      /\b(falar\s+com\s+(?:um\s+)?humano|atendente\s+humano|pessoa\s+de\s+verdade|fala\s+s[ée]rio|quero\s+(?:um\s+)?humano|me\s+transfere|chama\s+(?:um\s+)?humano)\b/i,
    reason: "Cliente pediu humano explicitamente",
  },
  {
    regex:
      /\b(flamengo|corinthians|palmeiras|fluminense|s[ãa]o\s+paulo|jogo|futebol|pol[íi]tica|eleic[ãa]o|piada)\b/i,
    reason: "Pergunta fora do escopo do colégio",
  },
];

// SOFT off-scope → temas DO colégio que o bot não tem na base. NÃO faz handoff
// nem pausa: redireciona pra secretaria e avisa a equipe em silêncio.
// (Uniforme saiu daqui de propósito — o roteiro já sabe: "malharia das
// unidades" — então cai no chat livre e é respondido direto.)
const SOFT_OFF_SCOPE_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  {
    regex: /\b(bolsa|bolsista|filantropi|isen[çc][ãa]o|gratuidade|financiament)/i,
    reason: "Pergunta sobre bolsa/financiamento",
  },
  {
    regex: /\b(desconto|descontos|abatiment|negocia[çc][ãa]o)\b/i,
    reason: "Pergunta sobre desconto/negociação",
  },
  {
    regex:
      /\b(merenda|alimenta[çc][ãa]o|transporte\s+escolar|[ôo]nibus|van\b)/i,
    reason: "Pergunta sobre alimentação/transporte",
  },
  {
    regex:
      /\b(reuni[ãa]o\s+de\s+pais|calend[áa]rio|formatura|festa\s+junina|excurs[ãa]o)\b/i,
    reason: "Pergunta sobre evento/calendário escolar",
  },
];

// Necessidade documental → secretaria da unidade (com telefone). Tratado à
// parte (document_request), não como soft_redirect genérico, porque o cliente
// precisa do NÚMERO da unidade certa pra resolver boletim/histórico/etc.
const DOCUMENT_KEYWORDS =
  /\b(boletim|hist[óo]rico\s+escolar|hist[óo]rico|declara[çc][ãa]o|atestado|segunda\s+via|2[ªa]\s+via|documenta[çc][ãa]o|documento|documentos|transfer[êe]ncia)\b/i;

const ENROLLMENT_KEYWORDS =
  /\b(mensalidade|valor|valores|pre[çc]o|custo|anuidade|semestral|matr[íi]cula|matricular|matriculando|s[ée]rie|turma|curso|aula|hor[áa]rio|turno|matutino|vespertino|integral|fundamental|m[ée]dio|enem|cursinho|terceir[ãa]o|pr[ée][-\s]?enem|incluso|material|simulado|colegial|anos?\s+iniciais|anos?\s+finais|[1-9][ºo°]\s*ano|[1-3][ªa]\s*s[ée]rie)\b/i;

const CONTACT_KEYWORDS =
  /\b(contato|telefone|fone|email|e-mail|whatsapp\s+oficial|site|secretaria|coordena[çc][ãa]o\s+contato)\b/i;

const UNIT_KEYWORDS =
  /\b(unidade|unidades|sede|campus|campi|endere[çc]o|rua|logradouro|onde\s+fica|como\s+chegar|hor[áa]rio\s+de\s+funcionamento|hor[áa]rio\s+da\s+escola|hor[áa]rio\s+de\s+atendimento|infraestrutura|atividades|extracurricular|capacidade|quantos\s+alunos|quantidade\s+de\s+alunos|n[úu]mero\s+de\s+alunos|estrutura|laborat[óo]rio|quadra|gin[áa]sio|parquinho|brinquedoteca|batista|montenegro|cidade\s+nova|ananindeua)\b/i;

const UNIT_NAME_PATTERNS: Array<{ regex: RegExp; unit: string }> = [
  { regex: /\b(batista\s+campos?|sede)\b/i, unit: "Batista Campos" },
  { regex: /\b(augusto\s+montenegro|montenegro)\b/i, unit: "Augusto Montenegro" },
  { regex: /\b(cidade\s+nova|ananindeua)\b/i, unit: "Cidade Nova" },
];

const GREETING_ONLY =
  /^(oi|ol[áa]|opa|hey|e[ai]+|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|td\s+bom|salve)[\s!.,?]*$/i;

export function routeIntent(message: string, hasName: boolean): RoutedIntent {
  const text = message.trim();

  if (GREETING_ONLY.test(text)) return { kind: "ask_llm" };

  // HARD off-scope (humano explícito, assunto totalmente fora do colégio)
  // vence qualquer outro sinal — vai direto pro handoff humano.
  for (const { regex, reason } of HARD_OFF_SCOPE_PATTERNS) {
    if (regex.test(text)) {
      return { kind: "escalate", reason: `${reason}. Mensagem: "${text}"` };
    }
  }

  // Find any SOFT off-scope match (bolsa, desconto, documento, transporte,
  // evento) so we know whether to soft-redirect or attach it as a secondary.
  let softReason: string | null = null;
  for (const { regex, reason } of SOFT_OFF_SCOPE_PATTERNS) {
    if (regex.test(text)) {
      softReason = reason;
      break;
    }
  }

  // Find the most specific nivel match (if any) — needed for both branches.
  let matchedNivel: string | undefined;
  for (const { regex, nivel } of NIVEL_PATTERNS) {
    if (regex.test(text)) {
      matchedNivel = nivel;
      break;
    }
  }
  // Match unit name too — applies to enrollment_info AND unit_info.
  let matchedUnit: string | undefined;
  for (const { regex, unit: u } of UNIT_NAME_PATTERNS) {
    if (regex.test(text)) {
      matchedUnit = u;
      break;
    }
  }
  const hasEnrollmentSignal =
    matchedNivel !== undefined || ENROLLMENT_KEYWORDS.test(text);

  // Necessidade documental (boletim/histórico/declaração/2ª via/transferência)
  // SEM ser pergunta de matrícula → secretaria da unidade. Vem antes de
  // contato/unit_info pra "histórico da Batista Campos" não virar endereço.
  if (DOCUMENT_KEYWORDS.test(text) && !hasEnrollmentSignal) {
    return { kind: "document_request", unit: matchedUnit };
  }

  // Mixed intent: clear enrollment question PLUS a soft off-scope topic
  // (desconto, transporte, etc.) — answer the enrollment part and SOFT-redirect
  // the extra topic to the secretaria afterward (no handoff, no pause).
  if (hasEnrollmentSignal && softReason) {
    return {
      kind: "enrollment_info",
      nivel: matchedNivel,
      unit: matchedUnit,
      escalateAfter: `${softReason}. Mensagem: "${text}"`,
    };
  }

  // Pure soft off-scope (no enrollment signal) — redirect to secretaria.
  if (softReason) {
    return { kind: "soft_redirect", reason: `${softReason}. Mensagem: "${text}"` };
  }

  // Mixed: pergunta sobre VALOR/PRODUTO em uma unidade específica
  // (ex: "mensalidade do maternal na cidade nova"). Vai para enrollment_info
  // com unit, NÃO para unit_info (que retornaria endereço/horário).
  if (hasEnrollmentSignal && matchedUnit) {
    return { kind: "enrollment_info", nivel: matchedNivel, unit: matchedUnit };
  }

  // Pergunta de contato (telefone/secretaria/whatsapp) tem prioridade sobre
  // unit_info quando ambos batem. Ex: "telefone da Sede" — o usuário quer o
  // número, não endereço/horário/infraestrutura.
  if (CONTACT_KEYWORDS.test(text)) {
    return { kind: "enrollment_contact", unit: matchedUnit };
  }

  // Unit/campus questions (address, hours, capacity, infrastructure) — check
  // BEFORE enrollment so "horário de funcionamento da Batista Campos" goes to
  // unit_info, not enrollment_info.
  if (UNIT_KEYWORDS.test(text)) {
    let unit: string | undefined;
    for (const { regex, unit: u } of UNIT_NAME_PATTERNS) {
      if (regex.test(text)) {
        unit = u;
        break;
      }
    }
    return { kind: "unit_info", unit };
  }

  if (hasEnrollmentSignal) {
    return { kind: "enrollment_info", nivel: matchedNivel, unit: matchedUnit };
  }

  void hasName;
  return { kind: "ask_llm" };
}
