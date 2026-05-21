import { config } from "./config";
import { logger } from "./logger";
import { createStateDb } from "./state/db";
import { createQueueDb } from "./queue/db";
import { StateRepository } from "./state/repository";
import { GeminiProvider } from "./llm/gemini";
import { WhatsAppClient } from "./whatsapp/client";
import { EscalationHandler } from "./handoff/telegram";
import { MessageOrchestrator } from "./worker/orchestrator";
import { MessagePoller } from "./worker/poller";
import { startWebhookServer } from "./webhook/server";

async function bootstrap() {
  try {
    logger.info(
      {
        environment: config.nodeEnv,
        port: config.port,
        institution: config.institution.name,
      },
      "Initializing application"
    );

    // Initialize databases
    logger.info("Initializing databases");
    const stateDb = await createStateDb();
    const queueDb = await createQueueDb();

    // Create repositories
    const stateRepository = stateDb;

    // Initialize LLM provider
    logger.info("Initializing Gemini LLM provider");
    const llmProvider = new GeminiProvider(
      config.gemini.apiKey,
      config.gemini.model
    );

    // Initialize messaging clients
    logger.info("Initializing WhatsApp client");
    const whatsappClient = new WhatsAppClient(
      config.whatsapp.accessToken,
      config.whatsapp.phoneNumberId,
      config.whatsapp.businessAccountId
    );

    logger.info("Initializing Telegram escalation handler");
    const escalationHandler = new EscalationHandler(
      config.telegram.botToken,
      config.telegram.chatId
    );

    // Create orchestrator
    const orchestrator = new MessageOrchestrator(
      llmProvider,
      stateRepository,
      whatsappClient,
      escalationHandler
    );

    // Create and start message poller
    const poller = new MessagePoller(orchestrator, 5000);

    // Start webhook server
    logger.info({ port: config.port }, "Starting webhook server");
    const webhookServer = await startWebhookServer(stateRepository);

    // Start message poller
    logger.info("Starting message poller");
    await poller.start();

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      logger.info("SIGTERM received, shutting down gracefully");

      await poller.stop();
      await webhookServer.close();

      process.exit(0);
    });

    process.on("SIGINT", async () => {
      logger.info("SIGINT received, shutting down gracefully");

      await poller.stop();
      await webhookServer.close();

      process.exit(0);
    });

    logger.info("Application initialized successfully");
  } catch (error) {
    logger.error({ error }, "Failed to initialize application");
    process.exit(1);
  }
}

// Start application
bootstrap();
