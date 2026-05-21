import crypto from "crypto";
import { logger } from "../logger";

export function validateMetaSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hash = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const isValid = hash === signature;

  logger.info({ isValid }, "Meta signature validation");

  return isValid;
}

export function validateTelegramSignature(
  data: string,
  signature: string,
  botToken: string
): boolean {
  const hash = crypto
    .createHash("sha256")
    .update(botToken)
    .digest();

  const hmac = crypto
    .createHmac("sha256", hash)
    .update(data)
    .digest("hex");

  const isValid = hmac === signature;

  logger.info({ isValid }, "Telegram signature validation");

  return isValid;
}

export function generateMetaSignature(
  payload: string,
  secret: string
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}
