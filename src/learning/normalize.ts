/**
 * Funções puras de normalização e matching para o cache aprendido de intenções.
 *
 * Tudo aqui é determinístico e sem dependência de DB/rede — testável isolado e
 * barato (zero token de LLM). O repositório (repository.ts) usa estas funções
 * pra gravar e consultar mapeamentos frase→intenção na tabela intent_learning.
 */

// Intents que o cache pode aprender. NUNCA inclui escalate/soft_redirect — esses
// são sensíveis demais pra automatizar (handoff humano, redirect off-scope).
export type CacheableIntentKind =
  | "enrollment_info"
  | "enrollment_contact"
  | "unit_info"
  | "document_request"
  | "visit_request";

export interface LearnedEntry {
  canonical_key: string;
  tokens: string[];
  intent_kind: CacheableIntentKind;
  regex_hits: number;
  positive_outcomes: number;
  negative_outcomes: number;
  status: "candidate" | "active" | "disabled";
}

// Stopwords PT-BR: artigos, preposições, pronomes e ruído de conversa que não
// carregam intenção. Mantido enxuto — palavras-chave de domínio (valor, medio,
// telefone, unidade...) JAMAIS entram aqui.
const STOPWORDS = new Set([
  "o", "a", "os", "as", "um", "uma", "uns", "umas",
  "de", "do", "da", "dos", "das", "no", "na", "nos", "nas",
  "em", "para", "pra", "por", "com", "sem", "sob", "ao", "aos",
  "e", "ou", "que", "se", "ja", "la", "ai", "aqui",
  "eu", "voce", "voces", "ele", "ela", "nos", "tu", "me", "te", "meu",
  "minha", "seu", "sua", "isso", "esse", "essa", "este", "esta",
  "quero", "queria", "gostaria", "preciso", "pode", "poderia", "saber",
  "ver", "tem", "ter", "qual", "quais", "como", "onde", "quando",
  "oi", "ola", "opa", "bom", "boa", "dia", "tarde", "noite", "obrigado",
  "obrigada", "favor", "ai", "entao", "sobre", "informacao", "informacoes",
  "ess", "esses", "essas",
]);

// Remove acentos via NFD e mantém só [a-z0-9] + espaço.
function deburr(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Tokens significativos: deburr → split → tira stopwords e tokens de 1 char.
export function tokenSet(message: string): Set<string> {
  const out = new Set<string>();
  for (const tok of deburr(message).split(" ")) {
    if (!tok || tok.length < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

// Chave canônica: tokens significativos, dedupe + ordenados, juntos por espaço.
// Frases que diferem só em caixa/acento/pontuação/ordem/stopwords colidem na
// mesma chave — o que dá o match exato barato no lookup.
export function canonicalKey(message: string): string {
  return Array.from(tokenSet(message)).sort().join(" ");
}

// Similaridade de Jaccard entre dois conjuntos de tokens: |∩| / |∪|.
// Dois conjuntos vazios → 0 (evita divisão por zero e match espúrio).
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Melhor entrada que casa com os tokens da mensagem. Recebe APENAS entradas que
// o caller já filtrou como relevantes (tipicamente status='active'). Match exato
// pela chave canônica vence (score 1); senão, maior Jaccard ≥ threshold.
export function bestMatch(
  tokens: Set<string>,
  entries: LearnedEntry[],
  threshold: number
): { entry: LearnedEntry; score: number } | null {
  const key = Array.from(tokens).sort().join(" ");
  let best: { entry: LearnedEntry; score: number } | null = null;
  for (const e of entries) {
    if (key && e.canonical_key === key) {
      return { entry: e, score: 1 };
    }
    const score = jaccard(tokens, new Set(e.tokens));
    if (score >= threshold && (!best || score > best.score)) {
      best = { entry: e, score };
    }
  }
  return best;
}

// Regra de promoção candidate→active: a frase precisa ter sido roteada com
// confiança pelo regex várias vezes E ter desfechos positivos, sem nenhum
// negativo. Mantém o cache conservador (não envenena com mapeamento errado).
export function shouldPromote(entry: {
  regex_hits: number;
  positive_outcomes: number;
  negative_outcomes: number;
}): boolean {
  return (
    entry.regex_hits >= 3 &&
    entry.positive_outcomes >= 2 &&
    entry.negative_outcomes === 0
  );
}
