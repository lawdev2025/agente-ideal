import { logger } from "../logger";
import { isSupabaseEnabled, getSupabase } from "../db/supabase-client";

/**
 * RESPOSTAS DIRETAS (school_faq)
 * ------------------------------------------------------------------
 * Mecanismo determinístico para o dono do colégio adicionar QUALQUER
 * informação nova pelo painel SEM precisar de código novo. Cada linha tem
 * gatilhos (palavras/frases) e uma resposta EXATA. Quando a mensagem do
 * cliente bate com um gatilho, o bot devolve a resposta verbatim — ANTES de
 * qualquer LLM. Assim o LLM nunca pode omitir nem negar a informação.
 *
 * É a versão escalável dos intents determinísticos (document_request,
 * visit_request): em vez de eu codar um handler por assunto, o dono cadastra
 * uma linha. Ver nota [[handler-deterministico-vs-llm]] no Segundo Cérebro.
 */
export interface DirectResponse {
  id: number;
  gatilhos: string;
  resposta: string;
  unit_id: string | null;
  ativo: boolean;
  prioridade: number;
}

// Remove acento e baixa pra comparação robusta ("Piscina" == "piscina").
function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Um gatilho casa se aparece como palavra/expressão inteira na mensagem
// (bordas que não sejam letra/número). Evita que "ano" case dentro de
// "ananindeua", por exemplo.
function gatilhoMatches(gatilho: string, normMessage: string): boolean {
  const g = normalize(gatilho).trim();
  if (g.length < 2) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(g)}(?![\\p{L}\\p{N}])`, "u");
  return re.test(normMessage);
}

/**
 * Procura uma Resposta Direta que case com a mensagem. Devolve a resposta
 * (texto exato) ou null se nenhuma bater. Em caso de empate, vence a de maior
 * prioridade e, depois, o gatilho mais específico (mais longo).
 */
export async function matchDirectResponse(message: string): Promise<string | null> {
  if (!isSupabaseEnabled()) return null;
  const normMessage = normalize(message);
  if (!normMessage.trim()) return null;

  let rows: DirectResponse[];
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("school_faq")
      .select("*")
      .eq("ativo", true);
    if (error) throw error;
    rows = (data ?? []) as DirectResponse[];
  } catch (err) {
    // Falha de banco NÃO pode derrubar a conversa — só seguimos sem FAQ.
    logger.error({ err }, "matchDirectResponse: falha ao ler school_faq");
    return null;
  }

  let best: { resposta: string; prioridade: number; len: number } | null = null;
  for (const row of rows) {
    if (!row.resposta) continue;
    const gatilhos = String(row.gatilhos || "")
      .split(/[,;\n]/)
      .map((g) => g.trim())
      .filter(Boolean);
    let matchedLen = 0;
    for (const g of gatilhos) {
      if (gatilhoMatches(g, normMessage)) {
        matchedLen = Math.max(matchedLen, normalize(g).length);
      }
    }
    if (matchedLen === 0) continue;
    const prioridade = Number(row.prioridade) || 0;
    if (
      !best ||
      prioridade > best.prioridade ||
      (prioridade === best.prioridade && matchedLen > best.len)
    ) {
      best = { resposta: row.resposta, prioridade, len: matchedLen };
    }
  }

  return best ? best.resposta : null;
}
