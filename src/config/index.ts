import { config as rawConfig, Env } from "./env";

export interface Config {
  nodeEnv: string;
  port: number;
  logLevel: string;
  database: {
    path: string;
    provider: "sqlite" | "supabase";
    supabaseUrl: string;
    supabaseAnonKey: string;
  };
  institution: {
    name: string;
    personaName: string;
    enrollmentPeriodEnd: string;
  };
  whatsapp: {
    phoneNumberId: string;
    accessToken: string;
    appSecret: string;
    businessAccountId: string;
    dryRun: boolean;
  };
  webhook: {
    secret: string;
    verifyToken: string;
  };
  llmProvider: "claude" | "gemini";
  gemini: {
    apiKey: string;
    model: string;
  };
  claude: {
    apiKey: string;
    model: string;
  };
  telegram: {
    botToken: string;
    chatId: string;
  };
  adminToken: string;
}

// Transform flat config into nested structure
export const config: Config = {
  nodeEnv: rawConfig.NODE_ENV,
  port: rawConfig.PORT,
  logLevel: rawConfig.LOG_LEVEL,
  database: {
    path: rawConfig.DB_PATH,
    provider: rawConfig.DATABASE_PROVIDER,
    supabaseUrl: rawConfig.SUPABASE_URL,
    supabaseAnonKey: rawConfig.SUPABASE_ANON_KEY,
  },
  institution: {
    name: rawConfig.INSTITUTION_NAME,
    personaName: rawConfig.PERSONA_NAME,
    enrollmentPeriodEnd: rawConfig.ENROLLMENT_PERIOD_END,
  },
  whatsapp: {
    phoneNumberId: rawConfig.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: rawConfig.WHATSAPP_ACCESS_TOKEN,
    appSecret: rawConfig.WHATSAPP_APP_SECRET,
    businessAccountId: rawConfig.WHATSAPP_PHONE_NUMBER_ID, // Using phone number ID as business account ID
    dryRun: rawConfig.WHATSAPP_DRY_RUN,
  },
  webhook: {
    secret: rawConfig.WHATSAPP_APP_SECRET,
    verifyToken: rawConfig.WHATSAPP_VERIFY_TOKEN,
  },
  llmProvider: rawConfig.LLM_PROVIDER,
  gemini: {
    apiKey: rawConfig.GEMINI_API_KEY,
    model: rawConfig.GEMINI_MODEL,
  },
  claude: {
    apiKey: rawConfig.ANTHROPIC_API_KEY,
    model: rawConfig.CLAUDE_MODEL,
  },
  telegram: {
    botToken: rawConfig.TELEGRAM_BOT_TOKEN,
    chatId: rawConfig.TELEGRAM_CHAT_ID,
  },
  adminToken: rawConfig.ADMIN_TOKEN,
};

export default config;
