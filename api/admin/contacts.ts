import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { requireUser } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { logger } from "../../src/logger";

// Escopo de visibilidade de um contato para uma atendente de unidade.
// Ela vê os contatos da SUA unidade E os leads de entrada que ainda não
// disseram unidade (unit_tag vazio) — senão esses órfãos não apareciam para
// ninguém. Órfãos aparecem para as 3 ao mesmo tempo (sem "claim"), de propósito.
// Seletiva entra como lead de entrada junto com matrícula: o bot pergunta a
// unidade antes de mandar o link, mas o cliente pode largar a conversa no meio.
const ORPHAN_ENTRY_TAGS = new Set(["matricula", "seletiva"]);
function scopedToUnit(c: any, unit: string | null | undefined): boolean {
  if (c.unit_tag === unit) return true;
  return !c.unit_tag && ORPHAN_ENTRY_TAGS.has(c.tag);
}

// PostgREST corta TODA resposta em `max_rows` (padrão 1000 no Supabase) — sem
// erro e sem aviso. Como get_contacts_inbox() devolve a fila inteira ordenada
// por recência, o corte escondia silenciosamente as conversas mais antigas e
// travava o contador da Central em 1000. Paginamos com .range() até vir uma
// página incompleta: funciona qualquer que seja o teto do projeto, sem depender
// de configuração no painel do Supabase.
const INBOX_PAGE = 1000;
const INBOX_MAX_PAGES = 25; // trava de segurança: 25k contatos

async function fetchInboxAll(sb: any): Promise<{ data: any[] | null; error: any }> {
  const all: any[] = [];
  for (let page = 0; page < INBOX_MAX_PAGES; page++) {
    const from = page * INBOX_PAGE;
    const { data, error } = await sb
      .rpc("get_contacts_inbox")
      .range(from, from + INBOX_PAGE - 1);
    if (error) return { data: null, error };
    const batch = (data || []) as any[];
    all.push(...batch);
    // Página incompleta = acabou. Evita uma ida extra ao banco no caso comum.
    if (batch.length < INBOX_PAGE) return { data: all, error: null };
  }
  logger.warn(
    { loaded: all.length },
    "Inbox atingiu INBOX_MAX_PAGES — lista pode estar truncada"
  );
  return { data: all, error: null };
}

// Busca no HISTÓRICO. A lista já traz só a última mensagem de cada conversa,
// então buscar no navegador só achava quem tinha o termo nela: das 777
// conversas que citaram "bolsa", a busca antiga encontrava 342.
//
// Devolve só os wa_id: a tela já tem os contatos carregados e cruza com esse
// conjunto. Sem a função no banco (supabase-busca.sql não rodado) cai no LIKE
// direto — funciona igual, só sensível a acento.
const BUSCA_MIN = 3;
const BUSCA_PAGE = 1000;
const BUSCA_MAX_PAGES = 25;

// Pagina até vir página incompleta. O .limit() NÃO resolve: o PostgREST corta
// toda resposta em max_rows (1000 no Supabase) sem erro e sem aviso — medido
// aqui, "bolsa" voltava 418 conversas em vez de 777. Mesmo motivo do
// fetchInboxAll acima.
async function paginar(build: (de: number, ate: number) => any): Promise<string[]> {
  const ids = new Set<string>();
  for (let p = 0; p < BUSCA_MAX_PAGES; p++) {
    const de = p * BUSCA_PAGE;
    const { data, error } = await build(de, de + BUSCA_PAGE - 1);
    if (error) throw error;
    const lote = (data || []) as any[];
    for (const r of lote) if (r?.wa_id) ids.add(String(r.wa_id));
    if (lote.length < BUSCA_PAGE) break;
  }
  return [...ids];
}

async function buscarNoHistorico(sb: any, termo: string): Promise<string[]> {
  try {
    return await paginar((de, ate) => sb.rpc("buscar_conversas", { termo }).range(de, ate));
  } catch (error) {
    logger.warn({ error }, "buscar_conversas indisponível — usando LIKE (rode public/admin/supabase-busca.sql)");
  }
  // % e _ são curingas do LIKE: sem escapar, buscar "100%" viraria "qualquer
  // coisa" e a tela mostraria a lista inteira como se tudo casasse.
  const seguro = termo.replace(/[\\%_]/g, (c) => "\\" + c);
  // role=user igual à função SQL: procura no que o CLIENTE escreveu. Buscar
  // também no texto do bot devolvia 528 conversas pra "escolinha" quando só 3
  // pessoas perguntaram — o resto era a resposta padrão.
  return paginar((de, ate) =>
    sb.from("messages").select("wa_id").eq("role", "user")
      .ilike("content", `%${seguro}%`).order("id").range(de, ate)
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const authUser = requireUser(req, res);
  if (!authUser) return;

  try {
    const sb = getSupabase();

    // ?busca=termo → só os wa_id que casam, sem remontar a lista inteira.
    const termo = String(req.query.busca || "").trim();
    if (termo) {
      if (termo.length < BUSCA_MIN) {
        res.status(200).json({ waIds: [], curto: true });
        return;
      }
      res.status(200).json({ waIds: await buscarNoHistorico(sb, termo) });
      return;
    }

    // Caminho rápido: a RPC get_contacts_inbox() faz backfill de órfãos + preview
    // da última mensagem TODO no Postgres (LATERAL LIMIT 1 por contato, casando
    // com idx_messages_wa). Evita trazer a tabela `messages` inteira pro Node.
    // Ver public/admin/supabase-contacts-inbox-rpc.sql.
    const { data: rpcContacts, error: rpcErr } = await fetchInboxAll(sb);
    if (!rpcErr) {
      const list = (rpcContacts || []) as any[];
      const scoped = authUser.role === "unit"
        ? list.filter((c) => scopedToUnit(c, authUser.unit))
        : list;
      res.status(200).json({ contacts: scoped });
      return;
    }
    // Fallback: migração ainda não rodada (função inexistente → erro 42883).
    // Mantém o comportamento antigo pra não derrubar o painel; loga pra avisar.
    logger.warn(
      { error: rpcErr },
      "RPC get_contacts_inbox indisponível — usando fallback (rode supabase-contacts-inbox-rpc.sql)"
    );

    // Backfill: cria contact rows para wa_ids que existem em messages mas
    // nao em contacts (usuarios antigos antes do auto-create no webhook).
    // Tras tambem role/content pra montar o preview da ultima mensagem por
    // contato (a primeira ocorrencia de cada wa_id, ja que vem ordenado desc).
    const { data: distinctMsgs } = await sb
      .from("messages")
      .select("wa_id, role, content, created_at")
      .order("created_at", { ascending: false });

    const { data: existingContacts } = await sb.from("contacts").select("wa_id");
    const existingSet = new Set(
      (existingContacts || []).map((c: any) => c.wa_id)
    );

    const seen = new Set<string>();
    const orphans: { wa_id: string; last_seen_at: number }[] = [];
    // Preview da ultima mensagem visivel (ignora tool/system) por contato.
    const lastMsgMap = new Map<
      string,
      { role: string; content: string; at: any }
    >();
    for (const m of distinctMsgs || []) {
      const wa = (m as any).wa_id;
      const role = (m as any).role;
      if (!lastMsgMap.has(wa) && role !== "tool" && role !== "system") {
        lastMsgMap.set(wa, {
          role,
          content: (m as any).content || "",
          at: (m as any).created_at,
        });
      }
      if (seen.has(wa)) continue;
      seen.add(wa);
      if (!existingSet.has(wa)) {
        orphans.push({ wa_id: wa, last_seen_at: (m as any).created_at });
      }
    }
    if (orphans.length > 0) {
      // So colunas garantidas: name/phone podem nao existir em instancias
      // criadas pelo schema antigo (supabase_schema.sql) — nao referencie.
      await sb.from("contacts").insert(
        orphans.map((o) => ({
          wa_id: o.wa_id,
          bot_paused: false,
          last_seen_at: o.last_seen_at,
        }))
      );
    }

    // SELECT "*" em vez de colunas fixas: tolera schema sem name/phone (evita o
    // erro 42703 que antes derrubava silenciosamente a lista pra vazia). E NAO
    // engolimos mais o erro do Supabase — devolve 500 visivel se algo falhar.
    const { data: contacts, error: contactsErr } = await sb
      .from("contacts")
      .select("*")
      .order("last_seen_at", { ascending: false, nullsFirst: false });
    if (contactsErr) {
      logger.error({ error: contactsErr }, "Erro ao ler contacts no Supabase");
      res.status(500).json({ error: "Erro ao ler contatos", detail: contactsErr.message });
      return;
    }

    // Anexa o preview da ultima mensagem e a flag "precisa responder" (ultima
    // mensagem foi do cliente). Sinal stateless pro inbox, sem tabela de leitura.
    const enriched = (contacts || []).map((c: any) => {
      const last = lastMsgMap.get(c.wa_id);
      return {
        ...c,
        last_message: last ? last.content : null,
        last_message_role: last ? last.role : null,
        last_message_at: last ? last.at : c.last_seen_at,
        needs_reply: last ? last.role === "user" : false,
      };
    });

    const scoped = authUser.role === "unit"
      ? enriched.filter((c: any) => scopedToUnit(c, authUser.unit))
      : enriched;
    res.status(200).json({ contacts: scoped });
  } catch (error) {
    logger.error({ error }, "Erro em GET /api/admin/contacts");
    res.status(500).json({ error: "Internal error" });
  }
}
