import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { checkAdminAuth } from "../_lib/auth";
import { logger } from "../../src/logger";
import * as fs from "fs";
import * as path from "path";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (!checkAdminAuth(req, res)) return;

  if (req.method === "GET") {
    try {
      // SEGURANCA: o app mobile usa um token embutido no JS publico (login
      // automatico), entao este GET NAO devolve mais segredos (chaves de API,
      // tokens de WhatsApp/Telegram/Vercel, app secret). Devolve so o que o
      // front precisa (config publica do Supabase/VAPID) + campos de exibicao
      // nao-sensiveis. Para EDITAR chaves, use o POST (que continua aceitando
      // todos os campos). Segredos nunca voltam ao navegador.
      const masked = (v?: string) => (v ? "********" : "");
      res.status(200).json({
        SUPABASE_URL: process.env.SUPABASE_URL || "",
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
        VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || "",
        LLM_PROVIDER: process.env.LLM_PROVIDER || "claude",
        CLAUDE_MODEL: process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001",
        GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
        INSTITUTION_NAME: process.env.INSTITUTION_NAME || "",
        PERSONA_NAME: process.env.PERSONA_NAME || "",
        ENROLLMENT_PERIOD_END: process.env.ENROLLMENT_PERIOD_END || "",
        WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
        // Apenas indicam se ESTAO setados (mascarado), sem revelar o valor:
        ANTHROPIC_API_KEY: masked(process.env.ANTHROPIC_API_KEY),
        GEMINI_API_KEY: masked(process.env.GEMINI_API_KEY),
        TELEGRAM_BOT_TOKEN: masked(process.env.TELEGRAM_BOT_TOKEN),
        WHATSAPP_ACCESS_TOKEN: masked(process.env.WHATSAPP_ACCESS_TOKEN),
        WHATSAPP_APP_SECRET: masked(process.env.WHATSAPP_APP_SECRET),
        WHATSAPP_VERIFY_TOKEN: masked(process.env.WHATSAPP_VERIFY_TOKEN),
        VERCEL_AUTH_TOKEN: masked(process.env.VERCEL_AUTH_TOKEN),
      });
    } catch (error: any) {
      logger.error({ error }, "Erro em GET /api/admin/config");
      res.status(500).json({ error: "Erro interno ao obter configurações" });
    }
    return;
  }

  if (req.method === "POST") {
    try {
      const payload = req.body || {};

      // Mapeamento de chaves do payload frontend para variáveis do .env
      const ENV_MAP: Record<string, string> = {
        supabaseUrl: "SUPABASE_URL",
        supabaseAnonKey: "SUPABASE_ANON_KEY",
        llmProvider: "LLM_PROVIDER",
        anthropicApiKey: "ANTHROPIC_API_KEY",
        geminiApiKey: "GEMINI_API_KEY",
        telegramBotToken: "TELEGRAM_BOT_TOKEN",
        telegramChatId: "TELEGRAM_CHAT_ID",
        whatsappPhoneNumberId: "WHATSAPP_PHONE_NUMBER_ID",
        whatsappAccessToken: "WHATSAPP_ACCESS_TOKEN",
        whatsappAppSecret: "WHATSAPP_APP_SECRET",
        whatsappVerifyToken: "WHATSAPP_VERIFY_TOKEN",
        adminToken: "ADMIN_TOKEN",
        institutionName: "INSTITUTION_NAME",
        personaName: "PERSONA_NAME",
        enrollmentPeriodEnd: "ENROLLMENT_PERIOD_END",
        vercelAuthToken: "VERCEL_AUTH_TOKEN",
        vercelProjectId: "VERCEL_PROJECT_ID",
        vercelTeamId: "VERCEL_TEAM_ID",
      };

      const mappedPayload: Record<string, string> = {};
      for (const [key, envKey] of Object.entries(ENV_MAP)) {
        const val = payload[key];
        // Ignora vazio e o placeholder mascarado "********": evita sobrescrever
        // um segredo existente quando o painel salva sem ter recebido o valor
        // real (o GET agora devolve segredos mascarados). Para trocar uma chave,
        // basta digitar o valor novo.
        if (val !== undefined && val !== "" && val !== "********") {
          mappedPayload[envKey] = val;
        }
      }

      // Em ambiente local, escrevemos no arquivo .env
      const isLocal = process.env.VERCEL === undefined;
      let localUpdated = false;

      if (isLocal) {
        try {
          const envPath = path.join(process.cwd(), ".env");
          let content = "";
          if (fs.existsSync(envPath)) {
            content = fs.readFileSync(envPath, "utf-8");
          }

          const lines = content.split(/\r?\n/);
          const updatedLines: string[] = [];
          const handledKeys = new Set<string>();

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
              const eqIdx = trimmed.indexOf("=");
              const key = trimmed.slice(0, eqIdx).trim();
              if (mappedPayload[key] !== undefined) {
                updatedLines.push(`${key}=${mappedPayload[key]}`);
                handledKeys.add(key);
                continue;
              }
            }
            updatedLines.push(line);
          }

          // Adiciona chaves que não existiam no .env
          for (const [key, val] of Object.entries(mappedPayload)) {
            if (!handledKeys.has(key)) {
              updatedLines.push(`${key}=${val}`);
            }
          }

          fs.writeFileSync(envPath, updatedLines.join("\n"), "utf-8");
          localUpdated = true;
          logger.info("Arquivo .env atualizado com sucesso localmente.");
        } catch (err: any) {
          logger.error({ err }, "Erro ao escrever no arquivo .env local");
        }
      }

      // Sincroniza com a API da Vercel se as credenciais estiverem preenchidas no payload ou no environment
      const vercelToken = payload.vercelAuthToken || process.env.VERCEL_AUTH_TOKEN;
      const vercelProjectId = payload.vercelProjectId || process.env.VERCEL_PROJECT_ID;
      const vercelTeamId = payload.vercelTeamId || process.env.VERCEL_TEAM_ID;

      let vercelSynced = false;
      const vercelStatus: string[] = [];
      let vercelError: string | null = null;

      if (vercelToken && vercelProjectId) {
        try {
          logger.info({ vercelProjectId }, "Iniciando sincronização de variáveis com a Vercel");
          const teamParam = vercelTeamId ? `?teamId=${vercelTeamId}` : "";
          const listUrl = `https://api.vercel.com/v9/projects/${vercelProjectId}/env${teamParam}`;

          const listRes = await fetch(listUrl, {
            headers: { Authorization: `Bearer ${vercelToken}` },
          });

          if (!listRes.ok) {
            const errText = await listRes.text();
            throw new Error(`Falha ao obter lista de variáveis da Vercel: ${errText}`);
          }

          const listData = (await listRes.json()) as {
            envs: Array<{ id: string; key: string; value: string }>;
          };
          const existingEnvs = listData.envs || [];
          const existingMap = new Map<string, string>();
          for (const e of existingEnvs) {
            existingMap.set(e.key, e.id);
          }

          for (const [envKey, envVal] of Object.entries(mappedPayload)) {
            if (envVal === undefined || envVal === null || envVal.trim() === "") continue;

            // Variáveis operacionais da Vercel em si não precisam ser sincronizadas de volta nela
            if (["VERCEL_AUTH_TOKEN", "VERCEL_PROJECT_ID", "VERCEL_TEAM_ID"].includes(envKey)) {
              continue;
            }

            const existingId = existingMap.get(envKey);
            if (existingId) {
              // Atualiza variável existente via PATCH
              const patchUrl = `https://api.vercel.com/v9/projects/${vercelProjectId}/env/${existingId}${teamParam}`;
              const patchRes = await fetch(patchUrl, {
                method: "PATCH",
                headers: {
                  Authorization: `Bearer ${vercelToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  value: envVal,
                  target: ["production", "preview", "development"],
                }),
              });

              if (patchRes.ok) {
                vercelStatus.push(`Atualizado: ${envKey}`);
              } else {
                vercelStatus.push(`Erro ao atualizar ${envKey}: ${await patchRes.text()}`);
              }
            } else {
              // Cria nova variável via POST
              const postUrl = `https://api.vercel.com/v10/projects/${vercelProjectId}/env${teamParam}`;
              const postRes = await fetch(postUrl, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${vercelToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  key: envKey,
                  value: envVal,
                  type: "plain",
                  target: ["production", "preview", "development"],
                }),
              });

              if (postRes.ok) {
                vercelStatus.push(`Criado: ${envKey}`);
              } else {
                vercelStatus.push(`Erro ao criar ${envKey}: ${await postRes.text()}`);
              }
            }
          }

          // Se também forneceu as variáveis da Vercel em si, salva elas na Vercel para persistência
          const vercelMetaVars = {
            VERCEL_AUTH_TOKEN: vercelToken,
            VERCEL_PROJECT_ID: vercelProjectId,
            VERCEL_TEAM_ID: vercelTeamId || "",
          };

          for (const [envKey, envVal] of Object.entries(vercelMetaVars)) {
            if (!envVal) continue;
            const existingId = existingMap.get(envKey);
            if (existingId) {
              const patchUrl = `https://api.vercel.com/v9/projects/${vercelProjectId}/env/${existingId}${teamParam}`;
              await fetch(patchUrl, {
                method: "PATCH",
                headers: {
                  Authorization: `Bearer ${vercelToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  value: envVal,
                  target: ["production", "preview", "development"],
                }),
              });
            } else {
              const postUrl = `https://api.vercel.com/v10/projects/${vercelProjectId}/env${teamParam}`;
              await fetch(postUrl, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${vercelToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  key: envKey,
                  value: envVal,
                  type: "plain",
                  target: ["production", "preview", "development"],
                }),
              });
            }
          }

          vercelSynced = true;
          logger.info("Variáveis de ambiente sincronizadas com sucesso no painel da Vercel.");
        } catch (vErr: any) {
          logger.error({ error: vErr }, "Erro ao sincronizar com Vercel API");
          vercelError = vErr.message || "Erro de conexão com a API da Vercel";
        }
      }

      res.status(200).json({
        success: true,
        localUpdated,
        vercelSynced,
        vercelStatus,
        vercelError,
      });
    } catch (error: any) {
      logger.error({ error }, "Erro em POST /api/admin/config");
      res.status(500).json({ error: error.message || "Erro interno do servidor" });
    }
    return;
  }

  res.status(405).json({ error: "Método não permitido" });
}
