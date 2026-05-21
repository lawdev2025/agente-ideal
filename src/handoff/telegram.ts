import axios, { AxiosInstance } from "axios";
import { logger } from "../logger";

export interface TelegramMessage {
  chat_id: string | number;
  text: string;
  parse_mode?: string;
  reply_markup?: Record<string, unknown>;
}

export class TelegramClient {
  private client: AxiosInstance;
  private botToken: string;

  constructor(botToken: string) {
    this.botToken = botToken;

    this.client = axios.create({
      baseURL: `https://api.telegram.org/bot${botToken}`,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async sendMessage(chatId: string | number, text: string): Promise<{ messageId: string }> {
    try {
      const payload: TelegramMessage = {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      };

      const response = await this.client.post(`/sendMessage`, payload);

      logger.info(
        {
          chatId,
          messageLength: text.length,
          messageId: response.data.result?.message_id,
        },
        "Telegram message sent"
      );

      return {
        messageId: response.data.result?.message_id?.toString() || "unknown",
      };
    } catch (error) {
      logger.error({ error, chatId }, "Error sending Telegram message");
      throw error;
    }
  }

  async sendPhoto(
    chatId: string | number,
    photoUrl: string,
    caption?: string
  ): Promise<{ messageId: string }> {
    try {
      const payload = {
        chat_id: chatId,
        photo: photoUrl,
        caption,
        parse_mode: "HTML",
      };

      const response = await this.client.post(`/sendPhoto`, payload);

      logger.info({ chatId, photoUrl }, "Telegram photo sent");

      return {
        messageId: response.data.result?.message_id?.toString() || "unknown",
      };
    } catch (error) {
      logger.error({ error, chatId }, "Error sending Telegram photo");
      throw error;
    }
  }

  async sendDocument(
    chatId: string | number,
    documentUrl: string,
    caption?: string
  ): Promise<{ messageId: string }> {
    try {
      const payload = {
        chat_id: chatId,
        document: documentUrl,
        caption,
        parse_mode: "HTML",
      };

      const response = await this.client.post(`/sendDocument`, payload);

      logger.info({ chatId, documentUrl }, "Telegram document sent");

      return {
        messageId: response.data.result?.message_id?.toString() || "unknown",
      };
    } catch (error) {
      logger.error({ error, chatId }, "Error sending Telegram document");
      throw error;
    }
  }

  async editMessage(
    chatId: string | number,
    messageId: string | number,
    text: string
  ): Promise<void> {
    try {
      await this.client.post(`/editMessageText`, {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
      });

      logger.info({ chatId, messageId }, "Telegram message edited");
    } catch (error) {
      logger.error({ error, chatId, messageId }, "Error editing Telegram message");
      throw error;
    }
  }

  async deleteMessage(
    chatId: string | number,
    messageId: string | number
  ): Promise<void> {
    try {
      await this.client.post(`/deleteMessage`, {
        chat_id: chatId,
        message_id: messageId,
      });

      logger.info({ chatId, messageId }, "Telegram message deleted");
    } catch (error) {
      logger.error({ error, chatId, messageId }, "Error deleting Telegram message");
      throw error;
    }
  }
}

export class EscalationHandler {
  private telegramClient: TelegramClient;
  private escalationGroupId: string;

  constructor(botToken: string, escalationGroupId: string) {
    this.telegramClient = new TelegramClient(botToken);
    this.escalationGroupId = escalationGroupId;
  }

  async escalateToGroup(
    studentId: string,
    reason: string,
    context: string
  ): Promise<{ messageId: string }> {
    try {
      const message = `
🔔 <b>Escalação de Suporte</b>

👤 <b>Aluno:</b> ${studentId}
📋 <b>Motivo:</b> ${reason}

📝 <b>Contexto:</b>
<code>${context}</code>
      `.trim();

      const result = await this.telegramClient.sendMessage(
        this.escalationGroupId,
        message
      );

      logger.info(
        { studentId, reason, messageId: result.messageId },
        "Support escalation sent"
      );

      return result;
    } catch (error) {
      logger.error({ error, studentId, reason }, "Error escalating support");
      throw error;
    }
  }
}
