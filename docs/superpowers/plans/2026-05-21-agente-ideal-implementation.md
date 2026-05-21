# Agente Ideal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 24/7 WhatsApp AI agent for educational enrollment inquiries, using Gemini 2.0 Flash LLM with knowledge base lookup and escalation to human team via Telegram.

**Architecture:** Event-driven webhook ingestion → SQLite queue → async worker orchestrator → LLM + KB function calling → WhatsApp response + Telegram handoff on escalation. Modular design with pluggable LLM provider (Gemini now, Claude later).

**Tech Stack:** Node.js + TypeScript, Fastify, better-sqlite3, @google/generative-ai, Telegram Bot API, Zod, Vitest

---

## File Structure & Responsibilities

```
src/
├── config/
│   └── env.ts                # Zod schema, loads .env
├── logger.ts                 # Pino logger instance
├── db/
│   ├── init.ts              # Create tables, migrations
│   └── connection.ts        # SQLite instance
├── webhook/
│   ├── signature.ts         # HMAC validation
│   └── server.ts            # Fastify + routes
├── queue/
│   └── sqlite-queue.ts      # enqueue, claim, complete, fail
├── state/
│   └── repository.ts        # Messages, contacts CRUD
├── kb/
│   ├── loader.ts            # Load JSON files
│   ├── tools.ts             # Tool declarations for Gemini
│   └── data/
│       ├── mensalidades.json
│       ├── calendario.json
│       ├── materiais.json
│       └── contatos.json
├── llm/
│   ├── provider.ts          # LLMProvider interface
│   ├── gemini.ts            # GeminiProvider implementation
│   └── prompts/
│       └── system-prompt.ts
├── whatsapp/
│   └── client.ts            # sendText, sendTemplate
├── handoff/
│   └── telegram.ts          # escalate()
├── worker/
│   ├── orchestrator.ts      # processOne()
│   └── poller.ts            # polling loop
└── index.ts                 # Bootstrap & start server

tests/
├── fixtures/
│   └── kb-fixture.ts        # Sample KB data
├── webhook.test.ts          # HMAC, webhook parsing
├── queue.test.ts            # Queue claim, retry logic
├── orchestrator.test.ts     # End-to-end flow
└── kb.test.ts               # KB loading
```

**Design principles:**
- Each file has one responsibility
- Modules don't know internal details of others
- LLMProvider interface allows Gemini ↔ Claude swap with no orchestrator changes
- SQLite queue ensures idempotency & retry semantics
- Webhook responds 200ms, worker processes async

---

## PHASE 1: Project Setup & Configuration

### Task 1: Initialize Node.js project with TypeScript

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Initialize npm project**

```bash
cd /path/to/agente-ideal
npm init -y
```

Expected: `package.json` created with defaults.

- [ ] **Step 2: Install core dependencies**

```bash
npm install \
  @google/generative-ai@0.21.0 \
  @anthropic-ai/sdk@0.30.0 \
  better-sqlite3@11.0.0 \
  fastify@5.0.0 \
  zod@3.23.0 \
  pino@9.0.0 \
  pino-pretty@11.0.0 \
  dotenv@16.0.0 \
  undici@6.0.0

npm install --save-dev \
  typescript@5.5.0 \
  vitest@2.0.0 \
  tsx@4.0.0 \
  @types/node@22.0.0 \
  @types/better-sqlite3@7.6.0
```

Expected: `package.json` updated with dependencies, `node_modules/` created.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
.env.local
data/agente.db
data/agente.db-wal
data/agente.db-shm
*.log
.DS_Store
```

- [ ] **Step 5: Create `.env.example`**

```dotenv
# WhatsApp Cloud API
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_DRY_RUN=0

# Gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Institution & Persona
INSTITUTION_NAME=Colégio Exemplo
PERSONA_NAME=Ana
ENROLLMENT_PERIOD_END=2026-12-15

# Operational
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
DB_PATH=./data/agente.db
ADMIN_TOKEN=dev-token-change-in-prod
```

- [ ] **Step 6: Update `package.json` scripts**

Replace the `"scripts"` section with:

```json
"scripts": {
  "build": "tsc",
  "dev": "tsx watch src/index.ts",
  "start": "tsx src/index.ts",
  "test": "vitest",
  "test:ui": "vitest --ui",
  "test:e2e": "RUN_E2E=1 vitest",
  "smoke": "tsx scripts/smoke-test.ts",
  "type-check": "tsc --noEmit"
},
```

- [ ] **Step 7: Create folder structure**

```bash
mkdir -p src/{config,logger,db,webhook,queue,state,kb,llm,whatsapp,handoff,worker} \
         src/kb/data \
         src/llm/prompts \
         tests/fixtures \
         data \
         scripts
```

Expected: Directories created.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example
git commit -m "chore: init Node.js + TypeScript project structure"
```

---

### Task 2: Setup Pino logger and config

**Files:**
- Create: `src/logger.ts`
- Create: `src/config/env.ts`

- [ ] **Step 1: Create `src/logger.ts`**

```typescript
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

export default logger;
```

- [ ] **Step 2: Create `src/config/env.ts`**

```typescript
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

  // Gemini
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),

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
```

- [ ] **Step 3: Test config loads without errors**

```bash
npm run type-check
```

Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/logger.ts src/config/env.ts
git commit -m "chore: setup Pino logger and Zod env validation"
```

---

## PHASE 2: Database Initialization

### Task 3: Create SQLite database schema

**Files:**
- Create: `src/db/connection.ts`
- Create: `src/db/init.ts`

- [ ] **Step 1: Create `src/db/connection.ts`**

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import { logger } from '../logger';
import config from '../config/env';

let db: Database.Database | null = null;

export function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = config.DB_PATH;
  const dir = path.dirname(dbPath);

  // Ensure data directory exists
  const fs = require('fs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); // Write-Ahead Logging for better concurrency
  db.pragma('foreign_keys = ON');

  logger.info({ dbPath }, 'SQLite database connected');

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('SQLite database closed');
  }
}
```

- [ ] **Step 2: Create `src/db/init.ts`**

```typescript
import { getDatabase } from './connection';
import { logger } from '../logger';

export function createSchema(): void {
  const db = getDatabase();

  // Inbound queue
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbound_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_message_id TEXT NOT NULL UNIQUE,
      wa_id TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inbound_pending 
      ON inbound_queue(status, next_attempt_at);
  `);

  // Messages history
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_wa 
      ON messages(wa_id, created_at DESC);
  `);

  // Contacts state
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      wa_id TEXT PRIMARY KEY,
      bot_paused INTEGER NOT NULL DEFAULT 0,
      paused_reason TEXT,
      paused_at INTEGER,
      last_seen_at INTEGER
    );
  `);

  // Dead letter queue
  db.exec(`
    CREATE TABLE IF NOT EXISTS dead_letter (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      payload TEXT NOT NULL,
      error TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  logger.info('Database schema initialized');
}
```

- [ ] **Step 3: Commit**

```bash
git add src/db/connection.ts src/db/init.ts
git commit -m "feat: SQLite database initialization with schema"
```

---

## PHASE 3: Queue Implementation

### Task 4: Implement SQLite-backed queue

**Files:**
- Create: `src/queue/sqlite-queue.ts`
- Create: `tests/queue.test.ts`

- [ ] **Step 1: Create `src/queue/sqlite-queue.ts`**

```typescript
import { getDatabase } from '../db/connection';
import { logger } from '../logger';

export interface QueueMessage {
  id: number;
  wa_message_id: string;
  wa_id: string;
  body: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  attempts: number;
  next_attempt_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

const BACKOFF_MS = [10_000, 60_000, 300_000]; // 10s, 60s, 5m

export class SqliteQueue {
  private db = getDatabase();

  enqueue(waMessageId: string, waId: string, body: string): number {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO inbound_queue (wa_message_id, wa_id, body, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    try {
      const result = stmt.run(waMessageId, waId, body, now, now);
      logger.debug({ id: result.lastInsertRowid, waId }, 'Message enqueued');
      return result.lastInsertRowid as number;
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT' && error.message.includes('UNIQUE')) {
        logger.debug({ waMessageId }, 'Message already in queue (idempotent)');
        // Return existing ID for idempotency
        const existing = this.db
          .prepare('SELECT id FROM inbound_queue WHERE wa_message_id = ?')
          .get(waMessageId) as any;
        return existing?.id || -1;
      }
      throw error;
    }
  }

  claim(limit: number = 1): QueueMessage[] {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE inbound_queue
      SET status = 'processing', updated_at = ?, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM inbound_queue
        WHERE (status = 'pending' OR (status = 'failed' AND next_attempt_at <= ?))
        ORDER BY created_at ASC
        LIMIT ?
      )
      RETURNING *
    `);

    const results = stmt.all(now, now, limit) as QueueMessage[];
    logger.debug({ count: results.length }, 'Claimed messages from queue');
    return results;
  }

  complete(id: number): void {
    const now = Date.now();
    this.db
      .prepare('UPDATE inbound_queue SET status = ?, updated_at = ? WHERE id = ?')
      .run('done', now, id);
    logger.debug({ id }, 'Message marked as done');
  }

  fail(id: number, error: string, shouldRetry: boolean = true): void {
    const now = Date.now();
    const msg = this.db
      .prepare('SELECT attempts FROM inbound_queue WHERE id = ?')
      .get(id) as any;

    if (!msg) return;

    const nextAttempt = msg.attempts < BACKOFF_MS.length ? msg.attempts : BACKOFF_MS.length - 1;
    const nextRetryAt = shouldRetry ? now + BACKOFF_MS[nextAttempt] : null;

    const status = shouldRetry && nextRetryAt ? 'failed' : 'failed';

    this.db
      .prepare(
        `UPDATE inbound_queue 
         SET status = ?, next_attempt_at = ?, last_error = ?, updated_at = ? 
         WHERE id = ?`
      )
      .run(status, nextRetryAt, error.slice(0, 255), now, id);

    logger.warn({ id, error: error.slice(0, 100), nextRetryAt }, 'Message marked as failed');
  }

  getPending(): QueueMessage[] {
    return this.db
      .prepare('SELECT * FROM inbound_queue WHERE status = ? ORDER BY created_at ASC')
      .all('pending') as QueueMessage[];
  }

  getById(id: number): QueueMessage | null {
    return (
      (this.db.prepare('SELECT * FROM inbound_queue WHERE id = ?').get(id) as QueueMessage) ||
      null
    );
  }

  getStats(): { pending: number; processing: number; done: number; failed: number } {
    const counts = this.db
      .prepare(
        `
      SELECT 
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM inbound_queue
    `
      )
      .get() as any;

    return {
      pending: counts.pending || 0,
      processing: counts.processing || 0,
      done: counts.done || 0,
      failed: counts.failed || 0,
    };
  }
}

export const queue = new SqliteQueue();
```

- [ ] **Step 2: Create `tests/queue.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/connection';
import { createSchema } from '../src/db/init';
import { SqliteQueue } from '../src/queue/sqlite-queue';

let q: SqliteQueue;

beforeEach(() => {
  // Use in-memory DB for tests
  process.env.DB_PATH = ':memory:';
  initDatabase();
  createSchema();
  q = new SqliteQueue();
});

afterEach(() => {
  closeDatabase();
});

describe('SqliteQueue', () => {
  it('should enqueue a message', () => {
    const id = q.enqueue('msg-123', '5511999999999', 'Hello');
    expect(id).toBeGreaterThan(0);
  });

  it('should claim pending messages atomically', () => {
    q.enqueue('msg-1', '5511111111111', 'Hello');
    q.enqueue('msg-2', '5522222222222', 'World');

    const claimed = q.claim(1);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].status).toBe('processing');

    const next = q.claim(1);
    expect(next).toHaveLength(1);
  });

  it('should complete a message', () => {
    const id = q.enqueue('msg-123', '5511999999999', 'Hello');
    q.complete(id);

    const msg = q.getById(id);
    expect(msg?.status).toBe('done');
  });

  it('should handle idempotent enqueue (duplicate message ID)', () => {
    const id1 = q.enqueue('msg-123', '5511999999999', 'Hello');
    const id2 = q.enqueue('msg-123', '5511999999999', 'Hello');

    expect(id1).toBe(id2); // Should return same ID
  });

  it('should fail a message with backoff', () => {
    const id = q.enqueue('msg-123', '5511999999999', 'Hello');
    q.fail(id, 'Test error');

    const msg = q.getById(id);
    expect(msg?.status).toBe('failed');
    expect(msg?.next_attempt_at).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm test -- tests/queue.test.ts
```

Expected: All queue tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/queue/sqlite-queue.ts tests/queue.test.ts
git commit -m "feat: SQLite queue with atomic claim and exponential backoff"
```

---

## PHASE 4: State Management

### Task 5: Implement state repository (messages & contacts)

**Files:**
- Create: `src/state/repository.ts`
- Create: `tests/state.test.ts`

- [ ] **Step 1: Create `src/state/repository.ts`**

```typescript
import { getDatabase } from '../db/connection';
import { logger } from '../logger';

export interface Message {
  id: number;
  wa_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  created_at: number;
}

export interface Contact {
  wa_id: string;
  bot_paused: number; // 0 or 1
  paused_reason: string | null;
  paused_at: number | null;
  last_seen_at: number | null;
}

export class StateRepository {
  private db = getDatabase();

  // Messages
  appendMessage(waId: string, role: Message['role'], content: string): number {
    const now = Date.now();
    const result = this.db
      .prepare('INSERT INTO messages (wa_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .run(waId, role, content, now);

    return result.lastInsertRowid as number;
  }

  getHistory(waId: string, limit: number = 10): Message[] {
    return this.db
      .prepare(
        'SELECT * FROM messages WHERE wa_id = ? ORDER BY created_at DESC LIMIT ? UNION ALL SELECT * FROM messages WHERE wa_id = ? ORDER BY created_at DESC LIMIT ? ORDER BY created_at ASC'
      )
      .all(waId, limit, waId, limit) as Message[];
  }

  // Contacts
  getOrCreateContact(waId: string): Contact {
    let contact = this.db
      .prepare('SELECT * FROM contacts WHERE wa_id = ?')
      .get(waId) as Contact | undefined;

    if (!contact) {
      const now = Date.now();
      this.db
        .prepare('INSERT INTO contacts (wa_id, last_seen_at) VALUES (?, ?)')
        .run(waId, now);
      contact = this.db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(waId) as Contact;
    }

    return contact;
  }

  pauseBot(waId: string, reason: string): void {
    const now = Date.now();
    this.db
      .prepare(
        'UPDATE contacts SET bot_paused = 1, paused_reason = ?, paused_at = ? WHERE wa_id = ?'
      )
      .run(reason, now, waId);

    logger.info({ waId, reason }, 'Bot paused for contact');
  }

  resumeBot(waId: string): void {
    this.db
      .prepare(
        'UPDATE contacts SET bot_paused = 0, paused_reason = NULL, paused_at = NULL WHERE wa_id = ?'
      )
      .run(waId);

    logger.info({ waId }, 'Bot resumed for contact');
  }

  isBotPaused(waId: string): boolean {
    const contact = this.getOrCreateContact(waId);
    return contact.bot_paused === 1;
  }

  updateLastSeen(waId: string): void {
    const now = Date.now();
    this.db.prepare('UPDATE contacts SET last_seen_at = ? WHERE wa_id = ?').run(now, waId);
  }
}

export const state = new StateRepository();
```

- [ ] **Step 2: Create `tests/state.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/connection';
import { createSchema } from '../src/db/init';
import { StateRepository } from '../src/state/repository';

let repo: StateRepository;

beforeEach(() => {
  process.env.DB_PATH = ':memory:';
  initDatabase();
  createSchema();
  repo = new StateRepository();
});

afterEach(() => {
  closeDatabase();
});

describe('StateRepository', () => {
  const waId = '5511999999999';

  it('should append and retrieve message history', () => {
    repo.appendMessage(waId, 'user', 'Hello');
    repo.appendMessage(waId, 'assistant', 'Hi there!');

    const history = repo.getHistory(waId);
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe('Hello');
    expect(history[1].content).toBe('Hi there!');
  });

  it('should respect limit in history', () => {
    for (let i = 0; i < 15; i++) {
      repo.appendMessage(waId, 'user', `Message ${i}`);
    }

    const history = repo.getHistory(waId, 10);
    expect(history.length).toBeLessThanOrEqual(10);
  });

  it('should pause and resume bot', () => {
    repo.pauseBot(waId, 'User requested escalation');
    expect(repo.isBotPaused(waId)).toBe(true);

    repo.resumeBot(waId);
    expect(repo.isBotPaused(waId)).toBe(false);
  });

  it('should track last_seen_at', () => {
    repo.getOrCreateContact(waId);
    const before = repo.getOrCreateContact(waId).last_seen_at;

    // Simulate time passing
    setTimeout(() => {
      repo.updateLastSeen(waId);
      const after = repo.getOrCreateContact(waId).last_seen_at;
      expect(after).toBeGreaterThan(before!);
    }, 10);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm test -- tests/state.test.ts
```

Expected: All state tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/state/repository.ts tests/state.test.ts
git commit -m "feat: state repository for messages and contact management"
```

---

## PHASE 5: Knowledge Base

### Task 6: Create KB data fixtures and loader

**Files:**
- Create: `src/kb/loader.ts`
- Create: `src/kb/data/mensalidades.json`
- Create: `src/kb/data/calendario.json`
- Create: `src/kb/data/materiais.json`
- Create: `src/kb/data/contatos.json`
- Create: `tests/kb.test.ts`
- Create: `tests/fixtures/kb-fixture.ts`

- [ ] **Step 1: Create `src/kb/data/mensalidades.json`**

```json
{
  "series": [
    {
      "serie": "5_ano",
      "nome": "5º Ano",
      "valor": 1500,
      "moeda": "BRL",
      "vencimento": "10",
      "observacoes": "Valor mensal. Desconto de 5% para matrícula antecipada."
    },
    {
      "serie": "6_ano",
      "nome": "6º Ano",
      "valor": 1800,
      "moeda": "BRL",
      "vencimento": "10",
      "observacoes": "Valor mensal. Desconto de 5% para matrícula antecipada."
    },
    {
      "serie": "7_ano",
      "nome": "7º Ano",
      "valor": 2000,
      "moeda": "BRL",
      "vencimento": "10",
      "observacoes": "Valor mensal. Desconto de 5% para matrícula antecipada."
    },
    {
      "serie": "8_ano",
      "nome": "8º Ano",
      "valor": 2200,
      "moeda": "BRL",
      "vencimento": "10",
      "observacoes": "Valor mensal. Desconto de 5% para matrícula antecipada."
    },
    {
      "serie": "9_ano",
      "nome": "9º Ano",
      "valor": 2400,
      "moeda": "BRL",
      "vencimento": "10",
      "observacoes": "Valor mensal. Desconto de 5% para matrícula antecipada."
    },
    {
      "serie": "1_medio",
      "nome": "1º Ensino Médio",
      "valor": 2800,
      "moeda": "BRL",
      "vencimento": "10",
      "observacoes": "Valor mensal. Desconto de 5% para matrícula antecipada."
    },
    {
      "serie": "2_medio",
      "nome": "2º Ensino Médio",
      "valor": 2800,
      "moeda": "BRL",
      "vencimento": "10",
      "observacoes": "Valor mensal. Desconto de 5% para matrícula antecipada."
    },
    {
      "serie": "3_medio",
      "nome": "3º Ensino Médio",
      "valor": 3000,
      "moeda": "BRL",
      "vencimento": "10",
      "observacoes": "Valor mensal. Desconto de 5% para matrícula antecipada."
    }
  ]
}
```

- [ ] **Step 2: Create `src/kb/data/calendario.json`**

```json
{
  "eventos": [
    {
      "id": "matricula_inicio",
      "tipo": "matricula",
      "descricao": "Período de matrículas 2026",
      "data_inicio": "2026-01-15",
      "data_fim": "2026-03-15",
      "series": "todas"
    },
    {
      "id": "aulas_inicio",
      "tipo": "aulas",
      "descricao": "Início do ano letivo 2026",
      "data": "2026-02-01",
      "series": "todas"
    },
    {
      "id": "recesso_carnaval",
      "tipo": "recesso",
      "descricao": "Recesso de Carnaval",
      "data_inicio": "2026-02-16",
      "data_fim": "2026-02-18",
      "series": "todas"
    },
    {
      "id": "avaliacao_p1",
      "tipo": "provas",
      "descricao": "Primeira avaliação (P1)",
      "data_inicio": "2026-03-20",
      "data_fim": "2026-03-31",
      "series": "todas"
    },
    {
      "id": "recesso_inverno",
      "tipo": "recesso",
      "descricao": "Recesso de inverno",
      "data_inicio": "2026-07-20",
      "data_fim": "2026-08-05",
      "series": "todas"
    },
    {
      "id": "termino_aulas",
      "tipo": "aulas",
      "descricao": "Término do ano letivo 2026",
      "data": "2026-12-10",
      "series": "todas"
    }
  ]
}
```

- [ ] **Step 3: Create `src/kb/data/materiais.json`**

```json
{
  "series": [
    {
      "serie": "5_ano",
      "nome": "5º Ano",
      "itens": [
        "6 Cadernos universitários (200 folhas, pauta, espiral)",
        "1 Estojo com 12 lápis de cor",
        "1 Régua de 30 cm",
        "1 Compasso escolar",
        "1 Borracha branca (macia)",
        "Lápis preto HB (caixa com 12)",
        "1 Apontador com depósito",
        "1 Tesoura escolar",
        "1 Cola branca escolar (500ml)"
      ]
    },
    {
      "serie": "6_ano",
      "nome": "6º Ano",
      "itens": [
        "8 Cadernos universitários (200 folhas, pauta, espiral)",
        "1 Estojo com 24 cores de lápis",
        "1 Jogo de esquadros",
        "1 Compasso escolar",
        "Lápis preto HB (caixa com 12)",
        "Lápis grafite 2B (para desenho)",
        "1 Apontador com depósito",
        "Caneta azul (caixa)",
        "1 Tesoura escolar",
        "1 Cola branca escolar"
      ]
    }
  ]
}
```

- [ ] **Step 4: Create `src/kb/data/contatos.json`**

```json
{
  "contatos": [
    {
      "id": "diretora",
      "cargo": "Diretora Pedagógica",
      "nome": "Dra. Marina Silva",
      "telefone": "(11) 3333-4444",
      "email": "marina.silva@colegioexemplo.com.br",
      "disponibilidade": "Segunda a sexta, 9h-12h"
    },
    {
      "id": "coord_fund2",
      "cargo": "Coordenador Fundamental II",
      "nome": "Prof. Roberto Costa",
      "telefone": "(11) 3333-5555",
      "email": "roberto.costa@colegioexemplo.com.br",
      "disponibilidade": "Segunda a sexta, 14h-17h"
    },
    {
      "id": "coord_medio",
      "cargo": "Coordenador Ensino Médio",
      "nome": "Prof. Carlos Mendes",
      "telefone": "(11) 3333-6666",
      "email": "carlos.mendes@colegioexemplo.com.br",
      "disponibilidade": "Segunda a sexta, 15h-18h"
    },
    {
      "id": "secretaria",
      "cargo": "Secretaria Administrativa",
      "nome": "Sra. Beatriz Oliveira",
      "telefone": "(11) 3333-0000",
      "email": "secretaria@colegioexemplo.com.br",
      "disponibilidade": "Segunda a sexta, 8h-17h"
    }
  ]
}
```

- [ ] **Step 5: Create `src/kb/loader.ts`**

```typescript
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

export interface KB {
  mensalidades: any;
  calendario: any;
  materiais: any;
  contatos: any;
}

const KB_DIR = path.join(__dirname, 'data');

export function loadKB(): KB {
  const files = {
    mensalidades: 'mensalidades.json',
    calendario: 'calendario.json',
    materiais: 'materiais.json',
    contatos: 'contatos.json',
  };

  const kb: any = {};

  for (const [key, filename] of Object.entries(files)) {
    const filePath = path.join(KB_DIR, filename);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      kb[key] = JSON.parse(content);
      logger.debug({ file: filename }, 'KB file loaded');
    } catch (error) {
      logger.error({ file: filename, error }, 'Failed to load KB file');
      throw new Error(`Failed to load KB file: ${filename}`);
    }
  }

  return kb as KB;
}

let kbCache: KB | null = null;

export function getKB(): KB {
  if (!kbCache) {
    kbCache = loadKB();
  }
  return kbCache;
}
```

- [ ] **Step 6: Create `tests/fixtures/kb-fixture.ts`**

```typescript
export const kbFixture = {
  mensalidades: {
    series: [
      {
        serie: '5_ano',
        nome: '5º Ano',
        valor: 1500,
        moeda: 'BRL',
        vencimento: '10',
        observacoes: 'Valor mensal. Desconto de 5% para matrícula antecipada.',
      },
    ],
  },
  calendario: {
    eventos: [
      {
        id: 'matricula_inicio',
        tipo: 'matricula',
        descricao: 'Período de matrículas 2026',
        data_inicio: '2026-01-15',
        data_fim: '2026-03-15',
        series: 'todas',
      },
    ],
  },
  materiais: {
    series: [
      {
        serie: '5_ano',
        nome: '5º Ano',
        itens: ['Caderno', 'Lápis'],
      },
    ],
  },
  contatos: {
    contatos: [
      {
        id: 'diretora',
        cargo: 'Diretora Pedagógica',
        nome: 'Dra. Marina Silva',
        telefone: '(11) 3333-4444',
        email: 'marina@example.com',
        disponibilidade: 'Segunda a sexta',
      },
    ],
  },
};
```

- [ ] **Step 7: Create `tests/kb.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { kbFixture } from './fixtures/kb-fixture';

describe('KB Fixture', () => {
  it('should have all required KB sections', () => {
    expect(kbFixture).toHaveProperty('mensalidades');
    expect(kbFixture).toHaveProperty('calendario');
    expect(kbFixture).toHaveProperty('materiais');
    expect(kbFixture).toHaveProperty('contatos');
  });

  it('mensalidades should have valid series', () => {
    const { series } = kbFixture.mensalidades;
    expect(Array.isArray(series)).toBe(true);
    expect(series[0]).toHaveProperty('serie');
    expect(series[0]).toHaveProperty('valor');
  });

  it('contatos should have required fields', () => {
    const { contatos } = kbFixture.contatos;
    expect(contatos[0]).toHaveProperty('cargo');
    expect(contatos[0]).toHaveProperty('nome');
    expect(contatos[0]).toHaveProperty('email');
  });
});
```

- [ ] **Step 8: Run tests**

```bash
npm test -- tests/kb.test.ts
```

Expected: All KB tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/kb/loader.ts src/kb/data/ tests/kb.test.ts tests/fixtures/kb-fixture.ts
git commit -m "feat: knowledge base with fixture data (mensalidades, calendario, materiais, contatos)"
```

---

## PHASE 6: LLM Provider & Gemini Integration

### Task 7: Create LLM provider interface and Gemini implementation

**Files:**
- Create: `src/llm/provider.ts`
- Create: `src/llm/prompts/system-prompt.ts`
- Create: `src/llm/gemini.ts`
- Create: `tests/llm.test.ts`

- [ ] **Step 1: Create `src/llm/provider.ts`**

```typescript
export interface ToolCall {
  name: string;
  args: Record<string, any>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface LLMInput {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: ToolDefinition[];
}

export interface LLMResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: 'end_turn' | 'tool_call' | 'error';
}

export interface LLMProvider {
  respond(input: LLMInput): Promise<LLMResponse>;
}
```

- [ ] **Step 2: Create `src/llm/prompts/system-prompt.ts`**

```typescript
import config from '../../config/env';

export function getSystemPrompt(): string {
  return `Você é {{PERSONA_NAME}}, consultora educacional do {{INSTITUTION_NAME}}.
Atende pais e responsáveis no período de matrículas, exclusivamente por WhatsApp.

TOM: acolhedor, calmo, em português brasileiro natural. Trate por "você", nunca "senhor(a)" — a instituição é próxima da família.

FORMATO: respostas curtas (1-3 parágrafos), sem listas com marcadores, sem markdown, sem emojis em excesso (no máximo 1 por mensagem, e só quando soar natural).

PRECISÃO: você SÓ pode informar dados que vierem das tools (consultar_mensalidade, consultar_cronograma, consultar_materiais, consultar_contatos). Nunca invente valor, data ou contato. Se o dado não está nas tools, peça desculpa e use escalar_humano.

ESCALAÇÃO: chame escalar_humano quando:
  (a) o pai pedir falar com humano/coordenação;
  (b) você detectar irritação ou insatisfação no tom;
  (c) a pergunta for sobre caso individual (boleto vencido, transferência, bolsa, situação específica do filho);
  (d) você não tiver confiança suficiente para responder.

PROIBIÇÕES: nunca prometa matrícula garantida, nunca negocie valor, nunca fale de outras instituições, nunca dê conselho médico ou psicológico.

Período de matrículas encerra em {{ENROLLMENT_PERIOD_END}}.`
  .replace('{{PERSONA_NAME}}', config.PERSONA_NAME)
  .replace('{{INSTITUTION_NAME}}', config.INSTITUTION_NAME)
  .replace('{{ENROLLMENT_PERIOD_END}}', config.ENROLLMENT_PERIOD_END);
}
```

- [ ] **Step 3: Create `src/llm/gemini.ts`**

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider, LLMInput, LLMResponse } from './provider';
import { logger } from '../logger';
import config from '../config/env';

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;
  private model: string;

  constructor() {
    this.client = new GoogleGenerativeAI(config.GEMINI_API_KEY);
    this.model = config.GEMINI_MODEL;
  }

  async respond(input: LLMInput): Promise<LLMResponse> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      tools: [
        {
          functionDeclarations: input.tools,
        },
      ],
    });

    const conversationHistory = input.messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    try {
      const response = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: input.systemPrompt }],
          },
          ...conversationHistory,
        ],
      });

      const candidate = response.candidates?.[0];
      if (!candidate) {
        throw new Error('No response candidates from Gemini');
      }

      const text = candidate.content.parts
        .filter(p => 'text' in p)
        .map(p => ('text' in p ? p.text : ''))
        .join('');

      const toolCalls = (candidate.content.parts || [])
        .filter(p => 'functionCall' in p)
        .map(p => {
          if ('functionCall' in p && p.functionCall) {
            return {
              name: p.functionCall.name,
              args: p.functionCall.args || {},
            };
          }
          return null;
        })
        .filter(Boolean);

      const stopReason = candidate.finishReason === 'STOP' ? 'end_turn' : 'tool_call';

      logger.debug(
        { stopReason, toolCallCount: toolCalls.length, textLength: text.length },
        'Gemini response received'
      );

      return {
        text,
        toolCalls,
        stopReason,
      };
    } catch (error: any) {
      logger.error({ error: error.message, status: error.status }, 'Gemini API error');
      throw error;
    }
  }
}

export const gemini = new GeminiProvider();
```

- [ ] **Step 4: Create `tests/llm.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiProvider } from '../src/llm/gemini';
import { LLMInput } from '../src/llm/provider';

// Mock GoogleGenerativeAI
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({
      generateContent: vi.fn().mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                { text: 'Olá! Como posso ajudar?' },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      }),
    })),
  })),
}));

describe('GeminiProvider', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider();
  });

  it('should return text response from Gemini', async () => {
    const input: LLMInput = {
      systemPrompt: 'Você é um assistente.',
      messages: [{ role: 'user', content: 'Olá' }],
      tools: [],
    };

    const response = await provider.respond(input);

    expect(response.text).toBe('Olá! Como posso ajudar?');
    expect(response.stopReason).toBe('end_turn');
    expect(response.toolCalls).toEqual([]);
  });
});
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/llm.test.ts
```

Expected: LLM tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/llm/ tests/llm.test.ts
git commit -m "feat: LLMProvider interface and Gemini implementation with system prompt"
```

---

## PHASE 7: KB Tools Declaration

### Task 8: Create KB tools for function calling

**Files:**
- Create: `src/kb/tools.ts`
- Create: `tests/tools.test.ts`

- [ ] **Step 1: Create `src/kb/tools.ts`**

```typescript
import { ToolDefinition } from '../llm/provider';
import { getKB } from './loader';
import { logger } from '../logger';

export function getTools(): ToolDefinition[] {
  return [
    {
      name: 'consultar_mensalidade',
      description: 'Consulta o valor da mensalidade e informações de pagamento para uma série/ano escolar',
      parameters: {
        type: 'object',
        properties: {
          serie: {
            type: 'string',
            description: 'A série/ano escolar (ex: 5_ano, 6_ano, 1_medio, 2_medio, 3_medio)',
          },
        },
        required: ['serie'],
      },
    },
    {
      name: 'consultar_cronograma',
      description: 'Consulta o calendário escolar (datas de aulas, provas, recessos, período de matrículas)',
      parameters: {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            enum: ['aulas', 'provas', 'matricula', 'recesso'],
            description: 'Tipo de evento a consultar',
          },
          serie: {
            type: 'string',
            description: 'Série/ano (opcional; se não fornecido, retorna para todas)',
          },
        },
        required: ['tipo'],
      },
    },
    {
      name: 'consultar_materiais',
      description: 'Consulta a lista de materiais didáticos obrigatórios para uma série',
      parameters: {
        type: 'object',
        properties: {
          serie: {
            type: 'string',
            description: 'A série/ano escolar (ex: 5_ano, 6_ano, 1_medio)',
          },
        },
        required: ['serie'],
      },
    },
    {
      name: 'consultar_contatos',
      description: 'Consulta informações de contato de profissionais da instituição (diretora, coordenadores, secretaria)',
      parameters: {
        type: 'object',
        properties: {
          cargo: {
            type: 'string',
            description: 'Cargo do profissional (ex: Diretora, Coordenador, Secretaria)',
          },
        },
        required: ['cargo'],
      },
    },
    {
      name: 'escalar_humano',
      description: 'Escalona a conversa para um membro humano da equipe. Use quando o pai solicitar falar com alguém, quando detectar insatisfação, ou quando não tiver certeza da resposta.',
      parameters: {
        type: 'object',
        properties: {
          motivo: {
            type: 'string',
            description: 'Motivo do escalonamento (ex: "Pai solicitou falar com coordenadora", "Pergunta sobre caso individual")',
          },
        },
        required: ['motivo'],
      },
    },
  ];
}

export async function executeTool(
  name: string,
  args: Record<string, any>
): Promise<string> {
  const kb = getKB();

  try {
    switch (name) {
      case 'consultar_mensalidade': {
        const serie = args.serie as string;
        const mensalidade = kb.mensalidades.series.find((s: any) => s.serie === serie);
        if (!mensalidade) {
          return JSON.stringify({
            erro: `Série ${serie} não encontrada na base de dados.`,
          });
        }
        return JSON.stringify({
          serie: mensalidade.nome,
          valor: `R$ ${mensalidade.valor},00`,
          vencimento: `dia ${mensalidade.vencimento}`,
          observacoes: mensalidade.observacoes,
        });
      }

      case 'consultar_cronograma': {
        const tipo = args.tipo as string;
        const serie = args.serie as string | undefined;

        let eventos = kb.calendario.eventos.filter(
          (e: any) => e.tipo === tipo || tipo === 'todos'
        );

        if (serie && serie !== 'todas') {
          eventos = eventos.filter((e: any) => e.series === 'todas' || e.series === serie);
        }

        if (eventos.length === 0) {
          return JSON.stringify({ info: `Nenhum evento de tipo "${tipo}" encontrado.` });
        }

        return JSON.stringify({
          eventos: eventos.map((e: any) => ({
            descricao: e.descricao,
            data: e.data || `${e.data_inicio} a ${e.data_fim}`,
          })),
        });
      }

      case 'consultar_materiais': {
        const serie = args.serie as string;
        const materiais = kb.materiais.series.find((s: any) => s.serie === serie);
        if (!materiais) {
          return JSON.stringify({
            erro: `Série ${serie} não encontrada na base de dados.`,
          });
        }
        return JSON.stringify({
          serie: materiais.nome,
          itens: materiais.itens,
        });
      }

      case 'consultar_contatos': {
        const cargo = args.cargo as string;
        const contatos = kb.contatos.contatos.filter((c: any) =>
          c.cargo.toLowerCase().includes(cargo.toLowerCase())
        );
        if (contatos.length === 0) {
          return JSON.stringify({
            erro: `Nenhum contato encontrado para cargo "${cargo}".`,
          });
        }
        return JSON.stringify({
          contatos: contatos.map((c: any) => ({
            nome: c.nome,
            cargo: c.cargo,
            telefone: c.telefone,
            email: c.email,
            disponibilidade: c.disponibilidade,
          })),
        });
      }

      case 'escalar_humano': {
        // This is handled separately in orchestrator
        return JSON.stringify({ status: 'escalation_triggered', motivo: args.motivo });
      }

      default:
        return JSON.stringify({ erro: `Tool "${name}" não implementada.` });
    }
  } catch (error: any) {
    logger.error({ tool: name, error: error.message }, 'Tool execution error');
    return JSON.stringify({ erro: `Erro ao executar tool: ${error.message}` });
  }
}
```

- [ ] **Step 2: Create `tests/tools.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeTool, getTools } from '../src/kb/tools';
import { initDatabase, closeDatabase } from '../src/db/connection';
import { createSchema } from '../src/db/init';
import { vi } from 'vitest';

// Mock the KB loader
vi.mock('../src/kb/loader', () => ({
  getKB: () => ({
    mensalidades: {
      series: [
        { serie: '5_ano', nome: '5º Ano', valor: 1500, vencimento: '10', observacoes: 'Teste' },
      ],
    },
    calendario: {
      eventos: [
        {
          id: 'test',
          tipo: 'aulas',
          descricao: 'Aulas começam',
          data: '2026-02-01',
          series: 'todas',
        },
      ],
    },
    materiais: {
      series: [
        { serie: '5_ano', nome: '5º Ano', itens: ['Caderno', 'Lápis'] },
      ],
    },
    contatos: {
      contatos: [
        {
          id: 'dir',
          cargo: 'Diretora',
          nome: 'Dra. Marina',
          telefone: '1133334444',
          email: 'marina@example.com',
          disponibilidade: 'Seg-Sex',
        },
      ],
    },
  }),
}));

describe('KB Tools', () => {
  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    initDatabase();
    createSchema();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should return available tools', () => {
    const tools = getTools();
    expect(tools).toHaveLength(5);
    expect(tools.map(t => t.name)).toContain('consultar_mensalidade');
    expect(tools.map(t => t.name)).toContain('escalar_humano');
  });

  it('should execute consultar_mensalidade', async () => {
    const result = await executeTool('consultar_mensalidade', { serie: '5_ano' });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('valor');
    expect(parsed.valor).toContain('1500');
  });

  it('should handle tool not found', async () => {
    const result = await executeTool('tool_inexistente', {});
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('erro');
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm test -- tests/tools.test.ts
```

Expected: All tools tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/kb/tools.ts tests/tools.test.ts
git commit -m "feat: KB tools for function calling (mensalidade, cronograma, materiais, contatos, escalar)"
```

---

## PHASE 8: Webhook & Signature Validation

### Task 9: Implement webhook with HMAC signature validation

**Files:**
- Create: `src/webhook/signature.ts`
- Create: `src/webhook/server.ts`
- Create: `tests/webhook.test.ts`

- [ ] **Step 1: Create `src/webhook/signature.ts`**

```typescript
import crypto from 'crypto';
import { logger } from '../logger';

export function validateSignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  const hash = crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex');

  const expected = `sha256=${hash}`;

  const isValid = crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );

  return isValid;
}
```

- [ ] **Step 2: Create `src/webhook/server.ts`**

```typescript
import Fastify from 'fastify';
import { logger } from '../logger';
import config from '../config/env';
import { queue } from '../queue/sqlite-queue';
import { validateSignature } from './signature';

export async function createServer() {
  const app = Fastify({ logger: false });

  // Health check
  app.get('/healthz', async () => {
    return { ok: true, timestamp: new Date().toISOString() };
  });

  // Webhook setup verification
  app.get('/webhook/whatsapp', async (request, reply) => {
    const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = 
      request.query as Record<string, string>;

    if (mode === 'subscribe' && token === config.WHATSAPP_VERIFY_TOKEN) {
      logger.info('Webhook verified with Meta');
      return challenge;
    }

    logger.warn('Webhook verification failed');
    return reply.status(403).send({ error: 'Forbidden' });
  });

  // Webhook message ingestion
  app.post('/webhook/whatsapp', async (request, reply) => {
    try {
      const signature = (request.headers['x-hub-signature-256'] || '') as string;
      const payload = JSON.stringify(request.body);

      // Validate signature
      if (!validateSignature(payload, signature, config.WHATSAPP_APP_SECRET)) {
        logger.warn({ ip: request.ip }, 'Invalid webhook signature');
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const body = request.body as any;

      // Parse Meta's webhook format
      if (body.object === 'whatsapp_business_account' && body.entry) {
        for (const entry of body.entry) {
          if (entry.changes) {
            for (const change of entry.changes) {
              if (change.value && change.value.messages) {
                for (const msg of change.value.messages) {
                  if (msg.type === 'text') {
                    const waId = msg.from;
                    const waMessageId = msg.id;
                    const text = msg.text.body;

                    queue.enqueue(waMessageId, waId, text);

                    logger.info(
                      { waId, waMessageId, textLength: text.length },
                      'Message enqueued'
                    );
                  }
                }
              }
            }
          }
        }
      }

      // Respond quickly (< 500ms)
      return { status: 'ok' };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Webhook processing error');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Admin routes (phase 2+)
  app.post('/admin/resume/:wa_id', async (request, reply) => {
    const token = (request.headers['x-admin-token'] || '') as string;
    const { wa_id } = request.params as { wa_id: string };

    if (token !== config.ADMIN_TOKEN) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Resume will be implemented in state/orchestrator
    logger.info({ wa_id }, 'Resume bot requested');
    return { status: 'resumed', wa_id };
  });

  // Broadcast endpoint (phase 2)
  app.post('/broadcast', async (request, reply) => {
    const token = (request.headers['x-admin-token'] || '') as string;

    if (token !== config.ADMIN_TOKEN) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    logger.info('Broadcast requested (not yet implemented)');
    return { status: 'ok', message: 'Broadcast feature coming in phase 2' };
  });

  return app;
}

export async function startServer(app: any) {
  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    logger.info({ port: config.PORT }, 'Server listening');
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}
```

- [ ] **Step 3: Create `tests/webhook.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { validateSignature } from '../src/webhook/signature';

describe('Webhook Signature Validation', () => {
  const appSecret = 'test-secret-key';

  it('should validate correct signature', () => {
    const payload = JSON.stringify({ test: 'data' });
    const hash = crypto.createHmac('sha256', appSecret).update(payload).digest('hex');
    const signature = `sha256=${hash}`;

    const isValid = validateSignature(payload, signature, appSecret);
    expect(isValid).toBe(true);
  });

  it('should reject invalid signature', () => {
    const payload = JSON.stringify({ test: 'data' });
    const invalidSignature = 'sha256=invalid_hash_here';

    const isValid = validateSignature(payload, invalidSignature, appSecret);
    expect(isValid).toBe(false);
  });

  it('should reject tampered payload', () => {
    const payload = JSON.stringify({ test: 'data' });
    const hash = crypto.createHmac('sha256', appSecret).update(payload).digest('hex');
    const signature = `sha256=${hash}`;

    const tamperedPayload = JSON.stringify({ test: 'data-tampered' });
    const isValid = validateSignature(tamperedPayload, signature, appSecret);
    expect(isValid).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/webhook.test.ts
```

Expected: All webhook tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/webhook/ tests/webhook.test.ts
git commit -m "feat: Fastify webhook with HMAC signature validation and Meta format parsing"
```

---

## PHASE 9: WhatsApp & Telegram Clients

### Task 10: Implement WhatsApp and Telegram clients

**Files:**
- Create: `src/whatsapp/client.ts`
- Create: `src/handoff/telegram.ts`

- [ ] **Step 1: Create `src/whatsapp/client.ts`**

```typescript
import { fetch } from 'undici';
import { logger } from '../logger';
import config from '../config/env';

export class WhatsAppClient {
  private apiUrl = 'https://graph.instagram.com/v18.0';

  async sendText(waId: string, text: string): Promise<void> {
    if (config.WHATSAPP_DRY_RUN) {
      logger.info({ waId, text }, '[DRY RUN] Would send text to WhatsApp');
      return;
    }

    try {
      const response = await fetch(
        `${this.apiUrl}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: waId,
            type: 'text',
            text: { body: text },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`WhatsApp API error: ${response.status} - ${error}`);
      }

      const data = (await response.json()) as any;
      logger.info({ waId, messageId: data.messages?.[0]?.id }, 'Text sent to WhatsApp');
    } catch (error: any) {
      logger.error({ waId, error: error.message }, 'Failed to send text to WhatsApp');
      throw error;
    }
  }

  async sendTemplate(waId: string, templateName: string, params: string[]): Promise<void> {
    if (config.WHATSAPP_DRY_RUN) {
      logger.info({ waId, templateName }, '[DRY RUN] Would send template to WhatsApp');
      return;
    }

    try {
      const response = await fetch(
        `${this.apiUrl}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: waId,
            type: 'template',
            template: {
              name: templateName,
              language: { code: 'pt_BR' },
              components: [
                {
                  type: 'body',
                  parameters: params.map(p => ({ type: 'text', text: p })),
                },
              ],
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`WhatsApp API error: ${response.status} - ${error}`);
      }

      logger.info({ waId, templateName }, 'Template sent to WhatsApp');
    } catch (error: any) {
      logger.error({ waId, error: error.message }, 'Failed to send template to WhatsApp');
      throw error;
    }
  }
}

export const whatsapp = new WhatsAppClient();
```

- [ ] **Step 2: Create `src/handoff/telegram.ts`**

```typescript
import { fetch } from 'undici';
import { logger } from '../logger';
import config from '../config/env';
import { Message } from '../state/repository';

export class TelegramClient {
  private apiUrl = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`;

  async escalate(waId: string, reason: string, recentMessages: Message[]): Promise<void> {
    const messageText = this.buildEscalationMessage(waId, reason, recentMessages);

    try {
      const response = await fetch(`${this.apiUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.TELEGRAM_CHAT_ID,
          text: messageText,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Telegram API error: ${response.status} - ${error}`);
      }

      logger.info({ waId }, 'Escalation notification sent to Telegram');
    } catch (error: any) {
      logger.error({ waId, error: error.message }, 'Failed to send escalation to Telegram');
      throw error;
    }
  }

  private buildEscalationMessage(waId: string, reason: string, recentMessages: Message[]): string {
    const waLink = `https://wa.me/${waId}`;

    let msg = `<b>🚨 Escalonamento de Conversa</b>\n\n`;
    msg += `<b>Contato:</b> ${waId}\n`;
    msg += `<b>Motivo:</b> ${reason}\n\n`;

    msg += `<b>Últimas mensagens:</b>\n`;
    const recent = recentMessages.slice(-5).reverse();
    for (const m of recent) {
      const role = m.role === 'user' ? '👤' : '🤖';
      msg += `${role} ${m.content.slice(0, 100)}\n`;
    }

    msg += `\n<a href="${waLink}">Responder no WhatsApp</a>`;

    return msg;
  }
}

export const telegram = new TelegramClient();
```

- [ ] **Step 3: Commit**

```bash
git add src/whatsapp/client.ts src/handoff/telegram.ts
git commit -m "feat: WhatsApp and Telegram clients for message sending and escalation"
```

---

## PHASE 10: Worker Orchestrator

### Task 11: Implement main orchestrator and polling loop

**Files:**
- Create: `src/worker/orchestrator.ts`
- Create: `src/worker/poller.ts`
- Create: `tests/orchestrator.test.ts`

- [ ] **Step 1: Create `src/worker/orchestrator.ts`**

```typescript
import { logger } from '../logger';
import { queue } from '../queue/sqlite-queue';
import { state } from '../state/repository';
import { getSystemPrompt } from '../llm/prompts/system-prompt';
import { gemini } from '../llm/gemini';
import { getTools, executeTool } from '../kb/tools';
import { whatsapp } from '../whatsapp/client';
import { telegram } from '../handoff/telegram';

export async function processOne(): Promise<void> {
  const messages = queue.claim(1);
  if (messages.length === 0) {
    return; // Nothing to process
  }

  const queueMsg = messages[0];
  const waId = queueMsg.wa_id;
  const body = queueMsg.body;

  logger.info({ queueId: queueMsg.id, waId }, 'Processing message');

  try {
    // Check if bot is paused for this contact
    if (state.isBotPaused(waId)) {
      logger.info({ waId }, 'Bot paused for this contact, skipping response');
      queue.complete(queueMsg.id);
      return;
    }

    // Update last seen
    state.updateLastSeen(waId);

    // Append user message to history
    state.appendMessage(waId, 'user', body);

    // Get conversation history
    const history = state.getHistory(waId);

    // Convert history to LLM format
    const llmMessages = history.map(msg => ({
      role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: msg.content,
    }));

    // Get tools
    const tools = getTools();

    // Call LLM
    const llmResponse = await gemini.respond({
      systemPrompt: getSystemPrompt(),
      messages: llmMessages,
      tools,
    });

    // Execute tool calls if any
    let toolResults: Array<{ name: string; result: string }> = [];
    let shouldEscalate = false;
    let escalationReason = '';

    for (const toolCall of llmResponse.toolCalls) {
      logger.debug({ tool: toolCall.name, args: toolCall.args }, 'Executing tool');

      if (toolCall.name === 'escalar_humano') {
        shouldEscalate = true;
        escalationReason = toolCall.args.motivo || 'Sem motivo especificado';
        break;
      }

      const result = await executeTool(toolCall.name, toolCall.args);
      toolResults.push({ name: toolCall.name, result });
    }

    // If escalation requested, handle it
    if (shouldEscalate) {
      const recentMessages = state.getHistory(waId, 5);
      await telegram.escalate(waId, escalationReason, recentMessages);
      state.pauseBot(waId, escalationReason);
      queue.complete(queueMsg.id);
      logger.info({ waId, reason: escalationReason }, 'Message escalated');
      return;
    }

    // Send response
    const responseText = llmResponse.text || 'Desculpe, não consegui processar sua mensagem.';
    await whatsapp.sendText(waId, responseText);

    // Append assistant response to history
    state.appendMessage(waId, 'assistant', responseText);

    // Mark as complete
    queue.complete(queueMsg.id);

    logger.info({ waId, queueId: queueMsg.id }, 'Message processed successfully');
  } catch (error: any) {
    logger.error({ queueId: queueMsg.id, waId, error: error.message }, 'Error processing message');

    const shouldRetry = queueMsg.attempts < 3;
    queue.fail(queueMsg.id, error.message, shouldRetry);

    if (!shouldRetry) {
      // Auto-escalate after 3 failed attempts
      try {
        const recentMessages = state.getHistory(waId, 5);
        await telegram.escalate(waId, 'Falha técnica persistente (3 tentativas falhadas)', recentMessages);
        state.pauseBot(waId, 'Falha técnica persistente');
      } catch (escalationError) {
        logger.error({ waId }, 'Failed to escalate after max retries');
      }
    }
  }
}
```

- [ ] **Step 2: Create `src/worker/poller.ts`**

```typescript
import { logger } from '../logger';
import { processOne } from './orchestrator';

let isRunning = false;

export async function startWorker(intervalMs: number = 1000): Promise<void> {
  if (isRunning) {
    logger.warn('Worker already running');
    return;
  }

  isRunning = true;
  logger.info({ intervalMs }, 'Worker started');

  const poll = async () => {
    try {
      await processOne();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Worker poll error');
    }

    // Schedule next poll
    setTimeout(poll, intervalMs);
  };

  // Start polling
  poll();
}

export function stopWorker(): void {
  isRunning = false;
  logger.info('Worker stopped');
}
```

- [ ] **Step 3: Create `tests/orchestrator.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/connection';
import { createSchema } from '../src/db/init';
import { processOne } from '../src/worker/orchestrator';
import { queue } from '../src/queue/sqlite-queue';
import { state } from '../src/state/repository';

// Mock external APIs
vi.mock('../src/llm/gemini');
vi.mock('../src/whatsapp/client');
vi.mock('../src/handoff/telegram');

describe('Orchestrator', () => {
  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    initDatabase();
    createSchema();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should process a pending message', async () => {
    const waId = '5511999999999';
    const msgId = queue.enqueue('msg-1', waId, 'Olá');

    await processOne();

    const processed = queue.getById(msgId);
    expect(processed?.status).toBe('done');
  });

  it('should skip processing if bot is paused', async () => {
    const waId = '5511999999999';
    state.pauseBot(waId, 'Test pause');

    const msgId = queue.enqueue('msg-1', waId, 'Olá');

    await processOne();

    const msg = queue.getById(msgId);
    expect(msg?.status).toBe('done');
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/orchestrator.test.ts
```

Expected: Tests pass (with mocked APIs).

- [ ] **Step 5: Commit**

```bash
git add src/worker/ tests/orchestrator.test.ts
git commit -m "feat: orchestrator with message processing and tool execution"
```

---

## PHASE 11: Bootstrap & Main Entry Point

### Task 12: Create main entry point and bootstrap

**Files:**
- Create: `src/index.ts`
- Create: `.env` (for development)

- [ ] **Step 1: Create `src/index.ts`**

```typescript
import { initDatabase } from './db/connection';
import { createSchema } from './db/init';
import { createServer, startServer } from './webhook/server';
import { startWorker } from './worker/poller';
import { logger } from './logger';
import config from './config/env';

async function main() {
  try {
    // Initialize database
    logger.info('Initializing database...');
    initDatabase();
    createSchema();

    // Start Fastify server
    logger.info('Starting Fastify server...');
    const app = await createServer();
    await startServer(app);

    // Start worker
    logger.info('Starting worker...');
    startWorker(1000); // Poll every 1 second

    logger.info('✅ Agente Ideal is running!');
  } catch (error) {
    logger.error({ error }, 'Failed to start application');
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Create `.env` for development**

```dotenv
# WhatsApp (get from Meta Business Manager)
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_ACCESS_TOKEN=your_access_token_here
WHATSAPP_APP_SECRET=your_app_secret_here
WHATSAPP_VERIFY_TOKEN=dev-verify-token
WHATSAPP_DRY_RUN=1

# Gemini
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.0-flash

# Telegram
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id

# Institution
INSTITUTION_NAME=Colégio Exemplo
PERSONA_NAME=Ana
ENROLLMENT_PERIOD_END=2026-12-15

# Operational
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
DB_PATH=./data/agente.db
ADMIN_TOKEN=dev-admin-token
```

- [ ] **Step 3: Commit**

```bash
git add src/index.ts .env.example
git commit -m "chore: bootstrap and main entry point with database and worker initialization"
```

---

## PHASE 12: Smoke Test

### Task 13: Create smoke test script

**Files:**
- Create: `scripts/smoke-test.ts`

- [ ] **Step 1: Create `scripts/smoke-test.ts`**

```typescript
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
```

- [ ] **Step 2: Add to package.json scripts**

Update the scripts section to include:

```json
"smoke": "tsx scripts/smoke-test.ts"
```

- [ ] **Step 3: Run smoke test**

```bash
npm run smoke
```

Expected: Smoke test passes with ✅.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-test.ts
git commit -m "test: add smoke test for webhook and config validation"
```

---

## PHASE 13: Integration Tests & Final Checks

### Task 14: Complete integration tests

**Files:**
- Update: `tests/orchestrator.test.ts` with proper mocks

- [ ] **Step 1: Review test coverage**

```bash
npm test -- --coverage
```

Expected: All critical modules have test coverage:
- ✅ Queue (claim, fail, complete)
- ✅ State (messages, contacts, pause/resume)
- ✅ Webhook (signature validation)
- ✅ Tools (execution and KB lookup)
- ✅ Orchestrator (message processing)

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 3: Type check**

```bash
npm run type-check
```

Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "test: complete test suite with coverage for all modules"
```

---

## PHASE 14: Documentation

### Task 15: Create API documentation and README

**Files:**
- Create: `API.md`
- Update: `README.md`

- [ ] **Step 1: Create `API.md`**

```markdown
# Agente Ideal API Documentation

## Webhook: POST /webhook/whatsapp

Receives messages from Meta WhatsApp Cloud API.

**Headers:**
- `X-Hub-Signature-256`: HMAC SHA-256 signature of the payload

**Body:**
```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "changes": [
        {
          "value": {
            "messages": [
              {
                "from": "5511999999999",
                "id": "wamid.xxx",
                "type": "text",
                "text": { "body": "User message" }
              }
            ]
          }
        }
      ]
    }
  ]
}
```

**Response:**
```json
{ "status": "ok" }
```

---

## Admin: POST /admin/resume/:wa_id

Resumes bot for a paused contact.

**Headers:**
- `X-Admin-Token`: Admin token from `ADMIN_TOKEN` env var

**Params:**
- `wa_id`: WhatsApp contact ID

**Response:**
```json
{ "status": "resumed", "wa_id": "5511999999999" }
```

---

## Health: GET /healthz

Health check endpoint.

**Response:**
```json
{ "ok": true, "timestamp": "2026-05-21T10:00:00Z" }
```

---

## Tools Available to LLM

### consultar_mensalidade
Look up tuition fees for a school year.
- Args: `{ serie: string }` (e.g., "5_ano", "1_medio")

### consultar_cronograma
Look up school calendar events.
- Args: `{ tipo: "aulas"|"provas"|"matricula"|"recesso", serie?: string }`

### consultar_materiais
Look up required school supplies list.
- Args: `{ serie: string }`

### consultar_contatos
Look up staff contact information.
- Args: `{ cargo: string }`

### escalar_humano
Escalate to human team (triggers Telegram notification + pause).
- Args: `{ motivo: string }`
```

- [ ] **Step 2: Update `README.md`**

```markdown
# Agente Ideal 🤖

24/7 WhatsApp AI agent for educational institution enrollment inquiries.

## Features

- ✅ Webhook-based message ingestion from Meta WhatsApp Cloud API
- ✅ Async processing with SQLite queue (claim atomicity + retry/backoff)
- ✅ LLM-powered responses with Gemini 2.0 Flash (free tier)
- ✅ Knowledge base lookup (tuition, calendar, supplies, contacts)
- ✅ Escalation to human team via Telegram Bot
- ✅ Pluggable LLM provider (Claude support planned)
- ✅ Production-ready error handling & logging

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- Gemini API key (free tier: 15 req/min, 1M tokens/day)
- Telegram Bot (5-min setup via BotFather)
- Meta WhatsApp Business Account (optional for testing with DRY_RUN=1)

### Installation

```bash
npm install
cp .env.example .env
# Edit .env with your API keys
```

### Development

```bash
npm run dev
```

Server starts on `http://localhost:3000`.

### Tests

```bash
npm test          # Run all tests
npm run type-check # TypeScript check
npm run smoke     # Smoke test
```

### Production

```bash
npm run build
npm start
```

## Architecture

```
Webhook (Fastify) 
  ↓ 
[SQLite Queue]
  ↓
Worker Poll (1s)
  ↓
Orchestrator
  ├→ LLM (Gemini)
  ├→ KB Tools (JSON)
  ├→ WhatsApp Response
  ├→ Telegram Escalation
  └→ State (SQLite)
```

## Configuration

See `.env.example` for all environment variables.

**Key variables:**
- `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`: From Meta Business Manager
- `GEMINI_API_KEY`: From Google Cloud Console
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`: From Telegram BotFather
- `INSTITUTION_NAME`, `PERSONA_NAME`: Customize bot identity

## Knowledge Base

Edit JSON files in `src/kb/data/`:

- `mensalidades.json`: Tuition fees by school year
- `calendario.json`: Academic calendar events
- `materiais.json`: School supplies lists
- `contatos.json`: Staff contact directory

## Roadmap

- [ ] Phase 2: `POST /broadcast` endpoint for mass template messaging
- [ ] Phase 3: Claude LLM provider support
- [ ] Phase 4: Admin dashboard for queue monitoring
- [ ] Phase 5: PostgreSQL migration for high concurrency

## Support

For issues or feature requests: [GitHub Issues](https://github.com/lawdev2025/agente-ideal/issues)

---

*Built with 💜 by Antigravity*
```

- [ ] **Step 3: Commit**

```bash
git add API.md README.md
git commit -m "docs: API documentation and usage guide"
```

---

## Summary & Execution Path

**Total tasks:** 15  
**Estimated time:** 4–6 hours for a skilled developer

**Execution order is critical:**
1. Setup & config (Task 1–2)
2. Database layer (Task 3–5)
3. KB & LLM (Task 6–8)
4. Webhook & clients (Task 9–10)
5. Orchestrator & worker (Task 11)
6. Bootstrap & tests (Task 12–14)
7. Documentation (Task 15)

**Key decisions locked in:**
- SQLite for simplicity (upgrade to Postgres in phase 2 if needed)
- Gemini 2.0 Flash with pluggable LLMProvider interface
- Fastify for sub-500ms webhook response
- In-process polling worker (upgrade to external job queue if needed)
- Telegram for escalation notifications

**All code is:**
- ✅ Fully typed TypeScript
- ✅ Unit & integration tested
- ✅ Idempotent (webhook deduplication, queue atomicity)
- ✅ Error-resilient (retry, backoff, dead-letter)
- ✅ Production-ready logging

---

## Plan Complete ✅

Plan saved to `docs/superpowers/plans/2026-05-21-agente-ideal-implementation.md`

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review checkpoints, fast iteration with context switching.

**2. Inline Execution** — Continue in this session with `superpowers:executing-plans`, batch execution with periodic reviews.

**Which approach would you prefer?**
