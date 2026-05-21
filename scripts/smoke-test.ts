import { config } from "../src/config";
import { logger } from "../src/logger";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function logTest(name: string, passed: boolean, error?: string) {
  results.push({ name, passed, error });
  const status = passed ? "✓" : "✗";
  const message = passed ? `${status} ${name}` : `${status} ${name}: ${error}`;
  console.log(message);
}

async function runSmokeTests() {
  console.log("\n🧪 Running Smoke Tests...\n");

  // Test 1: Config validation
  try {
    const requiredEnvVars = [
      "WHATSAPP_ACCESS_TOKEN",
      "GEMINI_API_KEY",
      "TELEGRAM_BOT_TOKEN",
    ];

    const missingVars = requiredEnvVars.filter(
      (varName) => !process.env[varName] || process.env[varName] === ""
    );

    if (missingVars.length === 0) {
      logTest("Config validation", true);
    } else {
      logTest(
        "Config validation",
        false,
        `Missing: ${missingVars.join(", ")}`
      );
    }
  } catch (error) {
    logTest(
      "Config validation",
      false,
      error instanceof Error ? error.message : String(error)
    );
  }

  // Test 2: Application config loaded correctly
  try {
    if (
      config.port &&
      config.nodeEnv &&
      config.institution.name &&
      config.whatsapp.phoneNumberId
    ) {
      logTest("Application config", true);
    } else {
      logTest("Application config", false, "Missing required config values");
    }
  } catch (error) {
    logTest(
      "Application config",
      false,
      error instanceof Error ? error.message : String(error)
    );
  }

  // Test 3: Database paths configured
  try {
    if (config.database.path && config.database.path.includes(".db")) {
      logTest("Database configuration", true);
    } else {
      logTest("Database configuration", false, "Invalid database path");
    }
  } catch (error) {
    logTest(
      "Database configuration",
      false,
      error instanceof Error ? error.message : String(error)
    );
  }

  // Test 4: Webhook verification token configured
  try {
    if (config.webhook.verifyToken) {
      logTest("Webhook verification token", true);
    } else {
      logTest("Webhook verification token", false, "Token not set");
    }
  } catch (error) {
    logTest(
      "Webhook verification token",
      false,
      error instanceof Error ? error.message : String(error)
    );
  }

  // Test 5: LLM configuration
  try {
    if (
      config.gemini.apiKey &&
      config.gemini.apiKey !== "test_gemini_key" &&
      config.gemini.model
    ) {
      logTest("LLM configuration (production)", true);
    } else if (config.gemini.apiKey && config.gemini.model) {
      logTest("LLM configuration (development/test)", true);
    } else {
      logTest("LLM configuration", false, "Missing Gemini config");
    }
  } catch (error) {
    logTest(
      "LLM configuration",
      false,
      error instanceof Error ? error.message : String(error)
    );
  }

  // Test 6: Escalation handler configuration
  try {
    if (config.telegram.botToken && config.telegram.chatId) {
      logTest("Escalation handler configuration", true);
    } else {
      logTest(
        "Escalation handler configuration",
        false,
        "Missing Telegram config"
      );
    }
  } catch (error) {
    logTest(
      "Escalation handler configuration",
      false,
      error instanceof Error ? error.message : String(error)
    );
  }

  // Test 7: Institution configuration
  try {
    if (
      config.institution.name &&
      config.institution.personaName &&
      config.institution.enrollmentPeriodEnd
    ) {
      logTest("Institution configuration", true);
    } else {
      logTest("Institution configuration", false, "Missing institution data");
    }
  } catch (error) {
    logTest(
      "Institution configuration",
      false,
      error instanceof Error ? error.message : String(error)
    );
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  const percentage = Math.round((passedCount / totalCount) * 100);

  console.log(`\n✓ Passed: ${passedCount}/${totalCount} (${percentage}%)\n`);

  if (passedCount < totalCount) {
    console.log("Failed tests:");
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    console.log();
    process.exit(1);
  } else {
    console.log("🎉 All smoke tests passed!\n");
    process.exit(0);
  }
}

runSmokeTests().catch((error) => {
  logger.error({ error }, "Smoke test failed");
  process.exit(1);
});
