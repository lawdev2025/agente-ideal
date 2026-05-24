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
       * primary intent and queue this for a follow-up escalation.
       */
      escalateAfter?: string;
    }
  | { kind: "enrollment_contact" }
  | { kind: "unit_info"; unit?: string }
  | { kind: "escalate"; reason: string }
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

const OFF_SCOPE_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  {
    regex: /\b(bolsa|bolsista|filantropi|isen[çc][ãa]o|gratuidade|financiament)/i,
    reason: "Pergunta sobre bolsa/desconto/financiamento",
  },
  {
    regex: /\b(desconto|descontos|abatiment|negocia[çc][ãa]o)\b/i,
    reason: "Pergunta sobre desconto/negociação",
  },
  {
    regex:
      /\b(uniforme|merenda|alimenta[çc][ãa]o|transporte\s+escolar|[ôo]nibus|van\b)/i,
    reason: "Pergunta sobre uniforme/alimentação/transporte",
  },
  {
    regex:
      /\b(reuni[ãa]o\s+de\s+pais|calend[áa]rio|formatura|festa\s+junina|excurs[ãa]o)\b/i,
    reason: "Pergunta sobre evento/calendário escolar",
  },
  {
    regex:
      /\b(transfer[êe]ncia|hist[óo]rico\s+escolar|declara[çc][ãa]o|atestado)\b/i,
    reason: "Pergunta sobre documento/transferência",
  },
  {
    regex:
      /\b(falar\s+com\s+(?:um\s+)?humano|atendente\s+humano|pessoa\s+de\s+verdade|fala\s+s[ée]rio)\b/i,
    reason: "Cliente pediu humano explicitamente",
  },
  {
    regex:
      /\b(flamengo|corinthians|palmeiras|fluminense|s[ãa]o\s+paulo|jogo|futebol|pol[íi]tica|eleic[ãa]o|piada)\b/i,
    reason: "Pergunta fora do escopo do colégio",
  },
];

const ENROLLMENT_KEYWORDS =
  /\b(mensalidade|valor|valores|pre[çc]o|custo|anuidade|semestral|matr[íi]cula|matricular|matriculando|s[ée]rie|turma|curso|aula|hor[áa]rio|turno|matutino|vespertino|integral|fundamental|m[ée]dio|enem|cursinho|terceir[ãa]o|pr[ée][-\s]?enem|incluso|material|simulado|colegial|anos?\s+iniciais|anos?\s+finais|[1-9][ºo°]\s*ano|[1-3][ªa]\s*s[ée]rie)\b/i;

const CONTACT_KEYWORDS =
  /\b(contato|telefone|fone|email|e-mail|whatsapp\s+oficial|site|secretaria|coordena[çc][ãa]o\s+contato)\b/i;

const UNIT_KEYWORDS =
  /\b(unidade|unidades|sede|campus|campi|endere[çc]o|onde\s+fica|como\s+chegar|hor[áa]rio\s+de\s+funcionamento|hor[áa]rio\s+da\s+escola|hor[áa]rio\s+de\s+atendimento|infraestrutura|atividades|extracurricular|capacidade|quantos\s+alunos|quantidade\s+de\s+alunos|n[úu]mero\s+de\s+alunos|estrutura|laborat[óo]rio|quadra|gin[áa]sio|parquinho|brinquedoteca|batista|montenegro|cidade\s+nova|ananindeua)\b/i;

const UNIT_NAME_PATTERNS: Array<{ regex: RegExp; unit: string }> = [
  { regex: /\b(batista\s+campos?|sede)\b/i, unit: "Batista Campos" },
  { regex: /\b(augusto\s+montenegro|montenegro)\b/i, unit: "Augusto Montenegro" },
  { regex: /\b(cidade\s+nova|ananindeua)\b/i, unit: "Cidade Nova" },
];

const GREETING_ONLY =
  /^(oi|ol[áa]|opa|hey|e[ai]+|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|td\s+bom|salve)[\s!.,?]*$/i;

// Off-scope patterns that should HARD-OVERRIDE any enrollment intent.
// "Maternal" and "futebol" are absolute escalations — even if "valor" appears
// in the same sentence, we never answer with a level price.
const HARD_OFF_SCOPE_KEYS = new Set([
  "Pergunta fora do escopo do colégio",
  "Cliente pediu humano explicitamente",
]);

export function routeIntent(message: string, hasName: boolean): RoutedIntent {
  const text = message.trim();

  if (GREETING_ONLY.test(text)) return { kind: "ask_llm" };

  // Find any off-scope match first so we know whether to hard-override or
  // attach it as a secondary escalation.
  let offScope: { reason: string; hard: boolean } | null = null;
  for (const { regex, reason } of OFF_SCOPE_PATTERNS) {
    if (regex.test(text)) {
      offScope = { reason, hard: HARD_OFF_SCOPE_KEYS.has(reason) };
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

  // Hard off-scope wins regardless of mixed intent.
  if (offScope?.hard) {
    return { kind: "escalate", reason: `${offScope.reason}. Mensagem: "${text}"` };
  }

  // Mixed intent: clear enrollment question PLUS a soft off-scope topic
  // (desconto, uniforme, transporte, etc.) — answer the enrollment part and
  // queue the off-scope for a follow-up escalation.
  if (hasEnrollmentSignal && offScope) {
    return {
      kind: "enrollment_info",
      nivel: matchedNivel,
      unit: matchedUnit,
      escalateAfter: `${offScope.reason}. Mensagem: "${text}"`,
    };
  }

  // Pure off-scope (no enrollment signal in the same message).
  if (offScope) {
    return { kind: "escalate", reason: `${offScope.reason}. Mensagem: "${text}"` };
  }

  // Mixed: pergunta sobre VALOR/PRODUTO em uma unidade específica
  // (ex: "mensalidade do maternal na cidade nova"). Vai para enrollment_info
  // com unit, NÃO para unit_info (que retornaria endereço/horário).
  if (hasEnrollmentSignal && matchedUnit) {
    return { kind: "enrollment_info", nivel: matchedNivel, unit: matchedUnit };
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

  if (CONTACT_KEYWORDS.test(text)) {
    return { kind: "enrollment_contact" };
  }

  void hasName;
  return { kind: "ask_llm" };
}
