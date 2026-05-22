import crypto from 'crypto';
import { logger } from '../src/logger';
import config from '../src/config/env';
import { validateSignature } from '../src/webhook/signature';

async function smokeTest() {
  logger.info('🚀 Starting smoke test...');

  // Test 1: HMAC signature validation
  const payload = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: '5511999999999',
                  id: 'wamid.test123',
                  type: 'text',
                  text: { body: 'Olá! Quanto custa a mensalidade do 5o ano?' },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  const hash = crypto
    .createHmac('sha256', config.WHATSAPP_APP_SECRET)
    .update(payload)
    .digest('hex');
  const signature = `sha256=${hash}`;

  const isValid = validateSignature(payload, signature, config.WHATSAPP_APP_SECRET);
  logger.info({ isValid }, '✓ HMAC signature validation test passed');

  // Test 2: Config loads correctly
  logger.info({ port: config.PORT, env: config.NODE_ENV }, '✓ Config loaded successfully');

  logger.info('✅ Smoke test passed!');
}

smokeTest().catch(error => {
  logger.error({ error }, '❌ Smoke test failed');
  process.exit(1);
});
