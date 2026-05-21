import { createQueueDb } from "../queue/db";
import { MessageOrchestrator } from "./orchestrator";
import { logger } from "../logger";

export class MessagePoller {
  private isRunning = false;
  private pollingInterval: NodeJS.Timeout | null = null;

  constructor(
    private orchestrator: MessageOrchestrator,
    private pollIntervalMs: number = 5000
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Poller is already running");
      return;
    }

    this.isRunning = true;
    logger.info({ pollIntervalMs: this.pollIntervalMs }, "Starting message poller");

    // Initial poll
    await this.poll();

    // Schedule periodic polling
    this.pollingInterval = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn("Poller is not running");
      return;
    }

    this.isRunning = false;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    logger.info("Message poller stopped");
  }

  private async poll(): Promise<void> {
    try {
      const queueDb = await createQueueDb();

      // Claim messages for processing
      const messages = await queueDb.claimMessages(10, 30000);

      if (messages.length === 0) {
        return;
      }

      logger.info({ messageCount: messages.length }, "Processing claimed messages");

      for (const message of messages) {
        try {
          // Process message
          await this.orchestrator.processMessage(
            message.senderId,
            message.text,
            message.senderId
          );

          // Mark as completed
          await queueDb.completeMessage(message.id);

          logger.info({ messageId: message.id }, "Message processing completed");
        } catch (error) {
          logger.error(
            { error, messageId: message.id },
            "Error processing message, will retry"
          );

          // Release claim for retry (with exponential backoff)
          await queueDb.releaseClaim(message.id);
        }
      }
    } catch (error) {
      logger.error({ error }, "Error in polling cycle");
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }
}
