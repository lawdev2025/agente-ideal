// Set NODE_ENV to production for tests so pino doesn't try to load pino-pretty
process.env.NODE_ENV = 'production';
process.env.WHATSAPP_DRY_RUN = '0';

// Stub env vars exigidos pelo zod (config/env.ts). Sem isso o import do
// orchestrator/llm explode antes do teste rodar.
const defaults: Record<string, string> = {
  WHATSAPP_PHONE_NUMBER_ID: 'test',
  WHATSAPP_ACCESS_TOKEN: 'test',
  WHATSAPP_APP_SECRET: 'test',
  WHATSAPP_VERIFY_TOKEN: 'test',
  GEMINI_API_KEY: 'test',
  ANTHROPIC_API_KEY: 'test',
  TELEGRAM_BOT_TOKEN: 'test',
  TELEGRAM_CHAT_ID: 'test',
  INSTITUTION_NAME: 'Colégio Ideal',
  ADMIN_TOKEN: 'test',
};
for (const [k, v] of Object.entries(defaults)) {
  if (!process.env[k]) process.env[k] = v;
}

