import axios, { AxiosInstance } from "axios";
import { logger } from "../logger";
import { config } from "../config";

export interface WhatsAppMessage {
  messaging_product: string;
  recipient_type: string;
  to: string;
  type: string;
  text?: {
    body: string;
  };
  image?: {
    link: string;
  };
  document?: {
    link: string;
  };
}

export class WhatsAppClient {
  private client: AxiosInstance;
  private phoneNumberId: string;
  private businessAccountId: string;

  constructor(
    accessToken: string,
    phoneNumberId: string,
    businessAccountId: string
  ) {
    this.phoneNumberId = phoneNumberId;
    this.businessAccountId = businessAccountId;

    this.client = axios.create({
      baseURL: `https://graph.instagram.com/v18.0/${businessAccountId}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
  }

  async sendMessage(to: string, text: string): Promise<{ messageId: string }> {
    const dryRun = config.whatsapp.dryRun;

    if (dryRun) {
      logger.info(
        {
          to,
          messageLength: text.length,
          dryRun: true,
        },
        "WhatsApp message (DRY_RUN - not actually sent)"
      );
      return {
        messageId: "dry-run-" + Date.now(),
      };
    }

    try {
      const payload: WhatsAppMessage = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          body: text,
        },
      };

      const response = await this.client.post(`/messages`, payload);

      logger.info(
        {
          to,
          messageLength: text.length,
          messageId: response.data.messages?.[0]?.id,
        },
        "WhatsApp message sent"
      );

      return {
        messageId: response.data.messages?.[0]?.id || "unknown",
      };
    } catch (error) {
      logger.error({ error, to }, "Error sending WhatsApp message");
      throw error;
    }
  }

  async sendImage(
    to: string,
    imageUrl: string,
    caption?: string
  ): Promise<{ messageId: string }> {
    try {
      const payload: WhatsAppMessage = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "image",
        image: {
          link: imageUrl,
        },
        ...(caption && { caption }),
      };

      const response = await this.client.post(`/messages`, payload);

      logger.info({ to, imageUrl }, "WhatsApp image sent");

      return {
        messageId: response.data.messages?.[0]?.id || "unknown",
      };
    } catch (error) {
      logger.error({ error, to }, "Error sending WhatsApp image");
      throw error;
    }
  }

  async sendDocument(
    to: string,
    documentUrl: string,
    filename?: string
  ): Promise<{ messageId: string }> {
    try {
      const payload: WhatsAppMessage = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "document",
        document: {
          link: documentUrl,
        },
      };

      const response = await this.client.post(`/messages`, payload);

      logger.info({ to, documentUrl }, "WhatsApp document sent");

      return {
        messageId: response.data.messages?.[0]?.id || "unknown",
      };
    } catch (error) {
      logger.error({ error, to }, "Error sending WhatsApp document");
      throw error;
    }
  }

  async markAsRead(messageId: string): Promise<void> {
    try {
      await this.client.post(`/messages`, {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      });

      logger.info({ messageId }, "Message marked as read");
    } catch (error) {
      logger.error({ error, messageId }, "Error marking message as read");
      throw error;
    }
  }
}
