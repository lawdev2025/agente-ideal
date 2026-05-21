import { config as rawConfig, Env } from "./env";

export interface Config {
  nodeEnv: string;
  port: number;
  logLevel: string;
  database: {
    path: string;
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
  };
  webhook: {
    secret: string;
    verifyToken: string;
  };
  gemini: {
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
  },
  webhook: {
    secret: rawConfig.WHATSAPP_APP_SECRET,
    verifyToken: rawConfig.WHATSAPP_VERIFY_TOKEN,
  },
  gemini: {
    apiKey: rawConfig.GEMINI_API_KEY,
    model: rawConfig.GEMINI_MODEL,
  },
  telegram: {
    botToken: rawConfig.TELEGRAM_BOT_TOKEN,
    chatId: rawConfig.TELEGRAM_CHAT_ID,
  },
  adminToken: rawConfig.ADMIN_TOKEN,
};

export default config;
