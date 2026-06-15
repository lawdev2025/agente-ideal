/**
 * Tag de INTENÇÃO por contato.
 *
 * Classifica a mensagem do cliente em uma das 4 frentes do colégio para o
 * triângulo de atendimento mostrar um selo ao lado do nome (app + painel):
 *   - matricula    → interessado em matricular (aluno novo)
 *   - rematricula  → já é aluno, quer renovar
 *   - eixo         → Pré-Enem / Pré-Vestibular / cursinho (Eixo)
 *   - esporte      → escolinha de esporte
 *
 * Determinístico (regex sobre texto normalizado), roda no webhook a cada
 * mensagem do usuário. Retorna null quando não há sinal claro (mantém a tag
 * anterior). A ORDEM importa: "rematrícula" contém "matrícula", e eixo/esporte
 * vêm antes de matrícula para não serem engolidos.
 */
export type ContactTag = "matricula" | "rematricula" | "eixo" | "esporte";

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function classifyContactTag(text: string): ContactTag | null {
  const t = norm(text);
  if (!t.trim()) return null;

  if (/(rematricul|renovac|renova matric|ja sou aluno|sou aluno do|aluno antigo|ja estudo|ja estuda|filho ja estuda|filha ja estuda|voltar a estudar)/.test(t))
    return "rematricula";

  if (/(\beixo\b|pre.?vestibular|pre.?enem|\bvestibular\b|\bcursinho\b|terceirao|pre.?universitario|\benem\b)/.test(t))
    return "eixo";

  if (/(escolinha|\besporte|\besportiva|futebol|futsal|natacao|\bjudo\b|jiu.?jitsu|\bdanca\b|\bvolei|basquete|handebol|\btreino\b|modalidade|karate|ginastica|capoeira|muay)/.test(t))
    return "esporte";

  if (/(matricul|inscric|inscrev|novo aluno|nova aluna|quero estudar|quero matricular|ingressar|fazer matricula|interesse em estudar|colocar meu filho|colocar minha filha|estudar no colegio|estudar ai|tem vaga)/.test(t))
    return "matricula";

  return null;
}

/**
 * Tag de UNIDADE de interesse a partir do nome de unidade detectado
 * (reaproveita detectUnit do intent-router). Abreviações do selo:
 *   AM = Augusto Montenegro · BC = Batista Campos · CN = Cidade Nova
 */
export type UnitTag = "AM" | "BC" | "CN";

export function unitAbbrev(unit: string | null | undefined): UnitTag | null {
  if (!unit) return null;
  const u = norm(unit);
  if (u.includes("augusto") || u.includes("montenegro")) return "AM";
  if (u.includes("batista")) return "BC";
  if (u.includes("cidade nova") || u.includes("ananindeua")) return "CN";
  return null;
}
