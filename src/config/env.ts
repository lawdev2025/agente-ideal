import { z } from 'zod';
import { config as loadEnv } from 'dotenv';

// Load .env for dev; production uses env vars directly
loadEnv();

const EnvSchema = z.object({
  // WhatsApp
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_DRY_RUN: z.enum(['0', '1']).default('0').transform(v => v === '1'),

  // LLM provider selection — "claude" (default) or "gemini"
  LLM_PROVIDER: z.enum(['claude', 'gemini']).default('claude'),

  // Gemini (kept for fallback/comparison)
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default('gemini-3.1-flash-lite'),

  // Anthropic Claude
  ANTHROPIC_API_KEY: z.string().min(1),
  CLAUDE_MODEL: z.string().default('claude-haiku-4-5-20251001'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),

  // Institution
  INSTITUTION_NAME: z.string().min(1),
  PERSONA_NAME: z.string().default('Ana'),
  ENROLLMENT_PERIOD_END: z.string().default('2026-12-15'),

  // Operational
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DB_PATH: z.string().default('./data/agente.db'),
  ADMIN_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema>;

export const config: Env = EnvSchema.parse(process.env);

export default config;
