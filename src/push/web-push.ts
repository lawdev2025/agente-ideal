import webpush from "web-push";
import { getSupabase } from "../db/supabase-client";
import { logger } from "../logger";

// Web Push do CRM IDEAL. Notifica o celular do atendente quando um cliente
// escreve e o bot esta em atendimento manual (ou acabou de virar handoff).
//
// As chaves VAPID vivem no ambiente (.env / Vercel):
//   VAPID_PUBLIC_KEY  — publica, vai pro frontend (PushManager.subscribe)
//   VAPID_PRIVATE_KEY — secreta, so no servidor
//   VAPID_SUBJECT     — mailto:... ou URL (opcional, default mailto generico)
//
// Se as chaves nao estiverem setadas, todo o modulo vira no-op silencioso —
// o bot continua funcionando normalmente, so nao manda push.

let _configured = false;

function ensureConfigured(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  if (!publicKey || !privateKey) return false;
  if (_configured) return true;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@crm-ideal.local";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  _configured = true;
  return true;
}

export function isPushEnabled(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export interface PushPayload {
  title: string;
  body: string;
  // wa_id do contato — o service worker usa pra abrir a conversa certa.
  wa_id?: string;
  tag?: string;
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Manda uma notificacao push pra TODAS as inscricoes salvas. Inscricoes mortas
 * (404/410 = navegador desinstalou/expirou) sao removidas do banco. Nunca
 * lanca — falha de push nao pode derrubar o webhook.
 */
export async function sendPushToAll(payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;

  let subs: SubscriptionRow[] = [];
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth");
    if (error) {
      logger.warn({ error }, "[push] falha ao ler push_subscriptions");
      return;
    }
    subs = (data || []) as SubscriptionRow[];
  } catch (err) {
    logger.warn({ err }, "[push] supabase indisponivel — push ignorado");
    return;
  }

  if (subs.length === 0) return;

  const body = JSON.stringify(payload);
  const dead: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          body
        );
      } catch (err: any) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) {
          dead.push(s.endpoint);
        } else {
          logger.warn({ status, endpoint: s.endpoint }, "[push] envio falhou");
        }
      }
    })
  );

  if (dead.length > 0) {
    try {
      const sb = getSupabase();
      await sb.from("push_subscriptions").delete().in("endpoint", dead);
      logger.info({ count: dead.length }, "[push] inscricoes mortas removidas");
    } catch (err) {
      logger.warn({ err }, "[push] falha ao limpar inscricoes mortas");
    }
  }
}
