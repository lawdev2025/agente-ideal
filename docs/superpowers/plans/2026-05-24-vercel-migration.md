# Vercel Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar o projeto Agente Ideal de Fastify+SQLite+worker pra rodar 100% no Vercel free, com Supabase como banco único e Realtime no painel.

**Architecture:** Vercel serverless functions em `api/` substituem o Fastify. `public/` serve o painel estático. `src/` mantém a lógica compartilhada (LLM, intent router, orchestrator, WhatsApp client, Telegram). Repository reescrito 100% Supabase async. Dedupe e cutoff em tabelas Supabase. Painel admin usa Supabase Realtime no lugar do polling 2s.

**Tech Stack:** TypeScript, Vercel Functions (`@vercel/node`), Supabase (Postgres + Realtime), Anthropic SDK, Meta WhatsApp Cloud API, Telegram Bot API.

**Spec:** `docs/superpowers/specs/2026-05-24-vercel-migration-design.md`

---

## Phase A — Backup & Database Migrations

### Task A1: Backup branch

**Files:**
- Read: (none — git only)

- [ ] **Step 1: Create legacy branch from current state**

```bash
git checkout -b main-legacy
git checkout master
```

Expected: branch `main-legacy` aponta pro mesmo commit de `master`. Você volta pra `master` pra trabalhar.

- [ ] **Step 2: Verify**

```bash
git branch
```

Expected output contém `main-legacy` e `* master`.

---

### Task A2: SQL migration script

**Files:**
- Create: `admin-panel/supabase-vercel-migration.sql`

- [ ] **Step 1: Write migration SQL**

Conteúdo completo do arquivo:

```sql
-- =============================================================
-- MIGRACAO PARA VERCEL — COLEGIO IDEAL
-- Cole TODO este arquivo no SQL Editor do Supabase e rode.
-- Idempotente (pode rodar mais de 1 vez).
-- =============================================================

-- Tabela de dedupe de mensagens (evita reprocessar a mesma msg)
CREATE TABLE IF NOT EXISTS processed_messages (
  message_id   TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_processed_messages_at
  ON processed_messages (processed_at);

ALTER TABLE processed_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_processed_messages'
  )
  THEN CREATE POLICY "allow_all_processed_messages" ON processed_messages
    FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Tabela de estado global do bot (cutoff de start, futuros toggles)
CREATE TABLE IF NOT EXISTS bot_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO bot_state (key, value) VALUES ('cutoff_ms', '0')
  ON CONFLICT (key) DO NOTHING;

ALTER TABLE bot_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_bot_state'
  )
  THEN CREATE POLICY "allow_all_bot_state" ON bot_state
    FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Habilita Realtime nas tabelas que o painel observa
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
```

- [ ] **Step 2: Commit**

```bash
git add admin-panel/supabase-vercel-migration.sql
git commit -m "feat: SQL de migracao Vercel (processed_messages, bot_state, realtime)"
```

---

### Task A3: USER ACTION — Rodar SQL no Supabase

**Files:** (none — manual user step)

- [ ] **Step 1: Operador roda o SQL**

Abre o Supabase Dashboard → SQL Editor → New query → cola TODO o conteúdo de `admin-panel/supabase-vercel-migration.sql` → **Run**.

Expected: sem erros. Se aparecer `relation already exists` em ALTER PUBLICATION, é OK (idempotente).

- [ ] **Step 2: Verificar tabelas criadas**

No SQL Editor:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('processed_messages', 'bot_state');
```

Expected: 2 linhas (`processed_messages`, `bot_state`).

```sql
SELECT * FROM bot_state;
```

Expected: 1 linha `key=cutoff_ms, value=0`.

---

## Phase B — Repository Rewrite (100% Supabase)

### Task B1: Helper de cliente Supabase server-side

**Files:**
- Create: `src/db/supabase-client.ts`

- [ ] **Step 1: Criar o arquivo**

```typescript
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config";

let _client: SupabaseClient | null = null;

/**
 * Cliente Supabase server-side (singleton por invocacao).
 * Em ambiente Vercel, cada function tem seu proprio modulo, entao o singleton
 * vive durante o tempo de vida da function (warm). Em cold start, recria.
 */
export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = config.database.supabaseUrl;
  const key = config.database.supabaseAnonKey;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL ou SUPABASE_ANON_KEY ausentes — configure no .env (ou Vercel env vars)"
    );
  }
  _client = createClient(url, key, {
    auth: { persistSession: false },
  });
  return _client;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: pode ainda haver erros de outros arquivos (vamos consertar nas próximas tasks). O novo arquivo em si não deve gerar erro.

---

### Task B2: Reescrever StateRepository (async, Supabase-only)

**Files:**
- Modify: `src/state/repository.ts` (substituir conteúdo inteiro)

- [ ] **Step 1: Substituir o arquivo inteiro**

```typescript
import { getSupabase } from "../db/supabase-client";
import { logger } from "../logger";

export interface Message {
  id: number;
  wa_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  created_at: number;
}

export interface Contact {
  wa_id: string;
  name: string | null;
  phone: string | null;
  bot_paused: boolean;
  paused_reason: string | null;
  paused_at: number | null;
  last_seen_at: number | null;
}

export class StateRepository {
  async appendMessage(
    waId: string,
    role: "user" | "assistant" | "system" | "tool",
    content: string
  ): Promise<number> {
    const supabase = getSupabase();
    const createdAt = Date.now();
    const { data, error } = await supabase
      .from("messages")
      .insert({ wa_id: waId, role, content, created_at: createdAt })
      .select("id")
      .single();
    if (error) {
      logger.error({ error, waId }, "Erro ao inserir mensagem no Supabase");
      throw error;
    }
    return data.id as number;
  }

  async getHistory(waId: string, limit: number = 10): Promise<Message[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("messages")
      .select("id, wa_id, role, content, created_at")
      .eq("wa_id", waId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) {
      logger.error({ error, waId }, "Erro ao buscar historico no Supabase");
      throw error;
    }
    return (data || []).reverse() as Message[];
  }

  async getOrCreateContact(
    waId: string,
    name?: string,
    phone?: string
  ): Promise<Contact> {
    const supabase = getSupabase();
    const { data: existing } = await supabase
      .from("contacts")
      .select("*")
      .eq("wa_id", waId)
      .maybeSingle();

    if (existing) {
      if ((name && !existing.name) || (phone && !existing.phone)) {
        const patch: Record<string, unknown> = {};
        if (name && !existing.name) patch.name = name;
        if (phone && !existing.phone) patch.phone = phone;
        const { data: updated } = await supabase
          .from("contacts")
          .update(patch)
          .eq("wa_id", waId)
          .select()
          .single();
        return this.normalize(updated || existing);
      }
      return this.normalize(existing);
    }

    const { data: inserted, error } = await supabase
      .from("contacts")
      .insert({
        wa_id: waId,
        name: name ?? null,
        phone: phone ?? null,
        bot_paused: false,
      })
      .select()
      .single();
    if (error) {
      logger.error({ error, waId }, "Erro ao criar contato no Supabase");
      throw error;
    }
    return this.normalize(inserted);
  }

  async pauseBot(waId: string, reason: string): Promise<void> {
    const supabase = getSupabase();
    await this.getOrCreateContact(waId);
    const { error } = await supabase
      .from("contacts")
      .update({
        bot_paused: true,
        paused_reason: reason,
        paused_at: Date.now(),
      })
      .eq("wa_id", waId);
    if (error) {
      logger.error({ error, waId }, "Erro ao pausar bot no Supabase");
      throw error;
    }
  }

  async resumeBot(waId: string): Promise<void> {
    const supabase = getSupabase();
    await this.getOrCreateContact(waId);
    const { error } = await supabase
      .from("contacts")
      .update({ bot_paused: false, paused_reason: null, paused_at: null })
      .eq("wa_id", waId);
    if (error) {
      logger.error({ error, waId }, "Erro ao retomar bot no Supabase");
      throw error;
    }
  }

  async isBotPaused(waId: string): Promise<boolean> {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("contacts")
      .select("bot_paused")
      .eq("wa_id", waId)
      .maybeSingle();
    return !!data?.bot_paused;
  }

  async updateLastSeen(waId: string): Promise<void> {
    const supabase = getSupabase();
    await this.getOrCreateContact(waId);
    const { error } = await supabase
      .from("contacts")
      .update({ last_seen_at: Date.now() })
      .eq("wa_id", waId);
    if (error) {
      logger.error({ error, waId }, "Erro ao atualizar last_seen no Supabase");
    }
  }

  private normalize(row: any): Contact {
    return {
      wa_id: row.wa_id,
      name: row.name ?? null,
      phone: row.phone ?? null,
      bot_paused: !!row.bot_paused,
      paused_reason: row.paused_reason ?? null,
      paused_at: row.paused_at ?? null,
      last_seen_at: row.last_seen_at ?? null,
    };
  }
}
```

- [ ] **Step 2: Verify file replaced**

```bash
grep -c "getSupabase" src/state/repository.ts
```

Expected: número >= 6 (várias chamadas a `getSupabase()`).

```bash
grep -c "better-sqlite3\|getDatabase" src/state/repository.ts
```

Expected: `0`.

---

### Task B3: Helpers de dedupe e cutoff

**Files:**
- Create: `src/state/dedupe.ts`

- [ ] **Step 1: Criar o arquivo**

```typescript
import { getSupabase } from "../db/supabase-client";
import { logger } from "../logger";

const RETENTION_DAYS = 7;

/**
 * Retorna o cutoff atual (epoch ms). Mensagens com timestamp menor que isto
 * sao descartadas. Valor 0 significa "aceitar tudo".
 */
export async function getCutoffMs(): Promise<number> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("bot_state")
    .select("value")
    .eq("key", "cutoff_ms")
    .maybeSingle();
  const v = data?.value ? Number(data.value) : 0;
  return Number.isFinite(v) ? v : 0;
}

/**
 * Marca o messageId como processado. Retorna true se foi a primeira vez
 * (continua o processamento); false se ja existia (duplicata — descartar).
 *
 * Tambem dispara limpeza assincrona de registros antigos (>7d) — fire-and-forget.
 */
export async function markProcessedOnce(messageId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("processed_messages")
    .insert({ message_id: messageId });

  if (error) {
    // 23505 = unique_violation (Postgres) — significa duplicata
    if ((error as any).code === "23505" || /duplicate key/i.test(error.message || "")) {
      return false;
    }
    logger.error({ error, messageId }, "Erro ao inserir processed_message");
    // Em caso de erro de infra, deixamos passar pra nao perder mensagem
    return true;
  }

  // Limpeza assincrona (nao bloqueia resposta)
  void cleanupOldProcessed();
  return true;
}

async function cleanupOldProcessed(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const supabase = getSupabase();
    await supabase.from("processed_messages").delete().lt("processed_at", cutoff);
  } catch (e) {
    logger.warn({ error: e }, "Cleanup de processed_messages falhou (nao critico)");
  }
}

/**
 * Decide se uma mensagem deve ser processada.
 * Checa cutoff E dedupe atomicamente.
 */
export async function shouldProcessMessage(
  timestamp: number | undefined,
  messageId: string
): Promise<{ ok: boolean; reason?: string }> {
  const tsMs = !timestamp
    ? Date.now()
    : timestamp < 1e12
    ? timestamp * 1000
    : timestamp;

  const cutoff = await getCutoffMs();
  if (cutoff > 0 && tsMs < cutoff) {
    const ageSec = Math.round((Date.now() - tsMs) / 1000);
    return {
      ok: false,
      reason: `message older than cutoff (${ageSec}s old, cutoff_ms=${cutoff})`,
    };
  }

  const firstTime = await markProcessedOnce(messageId);
  if (!firstTime) {
    return { ok: false, reason: "duplicate messageId (already processed)" };
  }

  return { ok: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/supabase-client.ts src/state/repository.ts src/state/dedupe.ts
git commit -m "feat: repository e dedupe 100% Supabase async"
```

---

### Task B4: Adaptar Orchestrator pra await + sem dedupe in-memory

**Files:**
- Modify: `src/worker/orchestrator.ts`

- [ ] **Step 1: Adicionar `await` em todas as chamadas do repository**

Edite o arquivo. Em `processMessage` (linha ~28):

Substituir:
```typescript
      if (this.stateRepository.isBotPaused(studentId)) {
```
Por:
```typescript
      if (await this.stateRepository.isBotPaused(studentId)) {
```

Substituir:
```typescript
      const history = this.stateRepository.getHistory(conversationId);
```
Por:
```typescript
      const history = await this.stateRepository.getHistory(conversationId);
```

- [ ] **Step 2: Localizar TODAS as outras chamadas e adicionar await**

```bash
grep -n "this\.stateRepository\." src/worker/orchestrator.ts
```

Para cada linha que aparecer, certifique-se que tem `await` antes. Especificamente:
- `stateRepository.appendMessage(...)` → `await stateRepository.appendMessage(...)`
- `stateRepository.getHistory(...)` → `await stateRepository.getHistory(...)`
- `stateRepository.pauseBot(...)` → `await stateRepository.pauseBot(...)`

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: pode ter erros relacionados a `getDatabase` / `db/connection`. Vamos resolver na Phase D.

---

### Task B5: Adaptar webhook/server.ts ao novo repository (temporário — vai sumir)

**Files:**
- Modify: `src/webhook/server.ts`

- [ ] **Step 1: Adicionar `await` nas chamadas do stateRepository**

```bash
grep -n "stateRepository\." src/webhook/server.ts
```

Para cada uma, garante `await`. Especialmente em:
- `stateRepository.getOrCreateContact(senderId)` → `await stateRepository.getOrCreateContact(senderId)`
- `stateRepository.updateLastSeen(senderId)` → `await stateRepository.updateLastSeen(senderId)`
- `stateRepository.appendMessage(...)` → `await stateRepository.appendMessage(...)`

Em endpoints admin (loops com `db.prepare(...).all()`), deixe quebrar por enquanto — esse arquivo vai ser substituído pelas API routes do Vercel em F2-F7.

- [ ] **Step 2: Commit (mesmo com lint quebrado — temporario)**

```bash
git add src/worker/orchestrator.ts src/webhook/server.ts
git commit -m "feat: orchestrator e webhook adaptados ao repository async (WIP)"
```

---

## Phase C — Remover SQLite

### Task C1: Deletar arquivos de SQLite e fila

**Files:**
- Delete: `src/db/init.ts`, `src/db/connection.ts`, `src/db/supabase.ts`
- Delete: `src/queue/db.ts`, `src/queue/sqlite-queue.ts`
- Delete: `src/state/db.ts`
- Delete: `src/worker/poller.ts`

- [ ] **Step 1: Deletar os arquivos**

```bash
rm src/db/init.ts src/db/connection.ts src/db/supabase.ts
rm src/queue/db.ts src/queue/sqlite-queue.ts
rm src/state/db.ts
rm src/worker/poller.ts
rmdir src/queue
```

Note: `src/db/` continua existindo porque tem `supabase-client.ts` dentro.

- [ ] **Step 2: Verify**

```bash
ls src/db/
```

Expected output: apenas `supabase-client.ts`.

```bash
ls src/queue 2>&1
```

Expected: erro "No such file" (pasta removida).

---

### Task C2: Atualizar package.json (remover deps SQLite + Fastify)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remover dependências**

```bash
npm uninstall better-sqlite3 @types/better-sqlite3 fastify @fastify/cors @fastify/static pino-pretty
```

- [ ] **Step 2: Verify package.json**

```bash
grep -E "better-sqlite3|fastify|pino-pretty" package.json
```

Expected: nenhum match.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remover SQLite e Fastify"
```

---

### Task C3: Deletar src/index.ts e src/webhook/server.ts

**Files:**
- Delete: `src/index.ts`
- Delete: `src/webhook/server.ts`

- [ ] **Step 1: Deletar**

```bash
rm src/index.ts src/webhook/server.ts
```

- [ ] **Step 2: Verify**

```bash
ls src/webhook/
```

Expected: apenas `signature.ts`.

---

## Phase D — Mover Admin Panel pra `public/`

### Task D1: Mover admin-panel → public/admin

**Files:**
- Rename: `admin-panel/` → `public/admin/`

- [ ] **Step 1: Mover via git (preserva history)**

```bash
mkdir -p public
git mv admin-panel public/admin
```

- [ ] **Step 2: Verify**

```bash
ls public/admin/ | head
```

Expected: vê `index.html`, `admin.js`, `admin.css`, etc.

```bash
ls admin-panel 2>&1
```

Expected: "No such file or directory".

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: mover admin-panel para public/admin (estatico Vercel)"
```

---

## Phase E — Vercel API Routes

### Task E1: Adicionar dep @vercel/node

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install --save-dev @vercel/node
```

- [ ] **Step 2: Verify**

```bash
grep "@vercel/node" package.json
```

Expected: linha com `"@vercel/node": "^X.Y.Z"`.

---

### Task E2: Criar utilitário compartilhado pras API routes

**Files:**
- Create: `api/_lib/auth.ts`
- Create: `api/_lib/cors.ts`

- [ ] **Step 1: Criar auth helper**

`api/_lib/auth.ts`:

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config } from "../../src/config";

export function checkAdminAuth(req: VercelRequest, res: VercelResponse): boolean {
  const auth = (req.headers.authorization || "") as string;
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== config.adminToken) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}
```

- [ ] **Step 2: Criar CORS helper**

`api/_lib/cors.ts`:

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return false;
  }
  return true;
}
```

---

### Task E3: api/config.ts

**Files:**
- Create: `api/config.ts`

- [ ] **Step 1: Criar arquivo**

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "./_lib/cors";
import { config } from "../src/config";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  res.status(200).json({
    SUPABASE_URL: config.database.supabaseUrl || "",
    SUPABASE_ANON_KEY: config.database.supabaseAnonKey || "",
    ADMIN_TOKEN: config.adminToken || "",
  });
}
```

---

### Task E4: api/admin/stats.ts

**Files:**
- Create: `api/admin/stats.ts`

- [ ] **Step 1: Criar arquivo**

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { checkAdminAuth } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { logger } from "../../src/logger";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!checkAdminAuth(req, res)) return;

  try {
    const sb = getSupabase();
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;

    const [
      { count: totalMessages },
      { count: totalContacts },
      { count: activeContacts },
      { count: escalations },
      { count: escalationMessages },
      { data: userMsgs },
    ] = await Promise.all([
      sb.from("messages").select("*", { count: "exact", head: true }),
      sb.from("contacts").select("*", { count: "exact", head: true }),
      sb.from("contacts").select("*", { count: "exact", head: true }).gte("last_seen_at", cutoff24h),
      sb.from("contacts").select("*", { count: "exact", head: true }).eq("bot_paused", true),
      sb
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("role", "tool")
        .like("content", "%escalate_to_specialist%"),
      sb.from("messages").select("content, created_at").eq("role", "user"),
    ]);

    const inactiveContacts = (totalContacts ?? 0) - (activeContacts ?? 0);

    // Last 7 days msg counts
    const days: string[] = [];
    const msgCounts: number[] = [];
    const dayLabels = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const start = new Date(d); start.setHours(0, 0, 0, 0);
      const end = new Date(d); end.setHours(23, 59, 59, 999);
      days.push(`${dayLabels[d.getDay()]} ${d.getDate()}`);
      const c = (userMsgs || []).filter(
        (m: any) => m.created_at >= start.getTime() && m.created_at <= end.getTime()
      ).length;
      msgCounts.push(c);
    }

    // Topic buckets
    const subjects: Record<string, number> = {
      "Mensalidades / Valores": 0,
      "Matrículas & Vagas": 0,
      "Materiais / Livros": 0,
      "Contatos / Secretaria": 0,
      "Horários & Grade": 0,
      "Outras dúvidas": 0,
    };
    for (const m of userMsgs || []) {
      const t = (m.content || "").toLowerCase();
      if (/mensal|pre[çc]o|valor|pagamento|custo/.test(t)) subjects["Mensalidades / Valores"]++;
      else if (/matr[íi]cula|vaga|inscri[çc][ãa]o|inscrever/.test(t)) subjects["Matrículas & Vagas"]++;
      else if (/material|livro|apostila|caderno/.test(t)) subjects["Materiais / Livros"]++;
      else if (/contato|telefone|whatsapp|secretaria|falar com/.test(t)) subjects["Contatos / Secretaria"]++;
      else if (/hor[áa]rio|aula|grade|calend[áa]rio/.test(t)) subjects["Horários & Grade"]++;
      else subjects["Outras dúvidas"]++;
    }

    res.status(200).json({
      totalMessages: totalMessages ?? 0,
      totalContacts: totalContacts ?? 0,
      activeContacts: activeContacts ?? 0,
      inactiveContacts,
      escalations: escalations ?? 0,
      escalationMessages: escalationMessages ?? 0,
      days,
      msgCounts,
      subjects,
    });
  } catch (error) {
    logger.error({ error }, "Erro em GET /api/admin/stats");
    res.status(500).json({ error: "Internal error" });
  }
}
```

---

### Task E5: api/admin/contacts.ts

**Files:**
- Create: `api/admin/contacts.ts`

- [ ] **Step 1: Criar arquivo**

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { checkAdminAuth } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { logger } from "../../src/logger";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!checkAdminAuth(req, res)) return;

  try {
    const sb = getSupabase();

    // Backfill: cria contact rows para wa_ids que existem em messages mas
    // nao em contacts (usuarios antigos antes do auto-create no webhook).
    const { data: distinctMsgs } = await sb
      .from("messages")
      .select("wa_id, created_at")
      .order("created_at", { ascending: false });

    const { data: existingContacts } = await sb.from("contacts").select("wa_id");
    const existingSet = new Set((existingContacts || []).map((c: any) => c.wa_id));

    const seen = new Set<string>();
    const orphans: { wa_id: string; last_seen_at: number }[] = [];
    for (const m of distinctMsgs || []) {
      if (seen.has((m as any).wa_id)) continue;
      seen.add((m as any).wa_id);
      if (!existingSet.has((m as any).wa_id)) {
        orphans.push({
          wa_id: (m as any).wa_id,
          last_seen_at: (m as any).created_at,
        });
      }
    }
    if (orphans.length > 0) {
      await sb.from("contacts").insert(
        orphans.map((o) => ({
          wa_id: o.wa_id,
          name: null,
          phone: null,
          bot_paused: false,
          last_seen_at: o.last_seen_at,
        }))
      );
    }

    const { data: contacts } = await sb
      .from("contacts")
      .select("wa_id, name, phone, bot_paused, paused_reason, paused_at, last_seen_at")
      .order("last_seen_at", { ascending: false, nullsFirst: false });

    res.status(200).json({ contacts: contacts || [] });
  } catch (error) {
    logger.error({ error }, "Erro em GET /api/admin/contacts");
    res.status(500).json({ error: "Internal error" });
  }
}
```

---

### Task E6: api/admin/contacts/[wa_id]/messages.ts

**Files:**
- Create: `api/admin/contacts/[wa_id]/messages.ts`

- [ ] **Step 1: Criar arquivo**

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../../../_lib/cors";
import { checkAdminAuth } from "../../../_lib/auth";
import { getSupabase } from "../../../../src/db/supabase-client";
import { logger } from "../../../../src/logger";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!checkAdminAuth(req, res)) return;

  const wa_id = (req.query.wa_id as string) || "";
  if (!wa_id) {
    res.status(400).json({ error: "wa_id required" });
    return;
  }

  try {
    const sb = getSupabase();
    const { data } = await sb
      .from("messages")
      .select("id, wa_id, role, content, created_at")
      .eq("wa_id", wa_id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    res.status(200).json({ messages: data || [] });
  } catch (error) {
    logger.error({ error, wa_id }, "Erro em GET /api/admin/contacts/:wa_id/messages");
    res.status(500).json({ error: "Internal error" });
  }
}
```

---

### Task E7: api/admin/contacts/[wa_id]/pause.ts

**Files:**
- Create: `api/admin/contacts/[wa_id]/pause.ts`

- [ ] **Step 1: Criar arquivo**

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../../../_lib/cors";
import { checkAdminAuth } from "../../../_lib/auth";
import { StateRepository } from "../../../../src/state/repository";
import { logger } from "../../../../src/logger";

const repo = new StateRepository();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "PATCH") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!checkAdminAuth(req, res)) return;

  const wa_id = (req.query.wa_id as string) || "";
  if (!wa_id) {
    res.status(400).json({ error: "wa_id required" });
    return;
  }

  const body = (req.body || {}) as { paused?: boolean };
  if (typeof body.paused !== "boolean") {
    res.status(400).json({ error: "Body must contain { paused: boolean }" });
    return;
  }

  try {
    if (body.paused) {
      await repo.pauseBot(wa_id, "Pausado via painel admin");
    } else {
      await repo.resumeBot(wa_id);
    }
    res.status(200).json({ ok: true, wa_id, bot_paused: body.paused });
  } catch (error) {
    logger.error({ error, wa_id }, "Erro em PATCH /api/admin/contacts/:wa_id/pause");
    res.status(500).json({ error: "Internal error" });
  }
}
```

---

### Task E8: api/webhook.ts (a função mais crítica)

**Files:**
- Create: `api/webhook.ts`

- [ ] **Step 1: Criar arquivo**

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config as appConfig } from "../src/config";
import { logger } from "../src/logger";
import { validateMetaSignature } from "../src/webhook/signature";
import { StateRepository } from "../src/state/repository";
import { shouldProcessMessage } from "../src/state/dedupe";
import { ClaudeProvider } from "../src/llm/claude";
import { GeminiProvider } from "../src/llm/gemini";
import { WhatsAppClient } from "../src/whatsapp/client";
import { EscalationHandler } from "../src/handoff/telegram";
import { MessageOrchestrator } from "../src/worker/orchestrator";

// Vercel exige `export const config` no top-level pra disable bodyParser
// (precisamos do raw body pra validar a assinatura HMAC do webhook Meta).
export const config = {
  api: {
    bodyParser: false,
  },
};

// Singletons por warm function (recriados em cold start, mas duram entre
// invocacoes da mesma instancia warm — economiza ~200ms por chamada).
const stateRepo = new StateRepository();
const llmProvider =
  appConfig.llmProvider === "claude"
    ? new ClaudeProvider(appConfig.claude.apiKey, appConfig.claude.model)
    : new GeminiProvider(appConfig.gemini.apiKey, appConfig.gemini.model);
const whatsappClient = new WhatsAppClient(
  appConfig.whatsapp.accessToken,
  appConfig.whatsapp.phoneNumberId,
  appConfig.whatsapp.businessAccountId
);
const escalationHandler = new EscalationHandler(
  appConfig.telegram.botToken,
  appConfig.telegram.chatId
);
const orchestrator = new MessageOrchestrator(
  llmProvider,
  stateRepo,
  whatsappClient,
  escalationHandler
);

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET: verificacao do webhook pela Meta
  if (req.method === "GET") {
    const mode = (req.query["hub.mode"] || req.query.mode) as string;
    const token = (req.query["hub.verify_token"] || req.query.token) as string;
    const challenge = (req.query["hub.challenge"] || req.query.challenge) as string;
    if (mode === "subscribe" && token === appConfig.webhook.verifyToken) {
      logger.info("Webhook verified");
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send("Forbidden");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  // POST: validar assinatura
  try {
    const signature = (req.headers["x-hub-signature-256"] as string) || "";
    if (!signature) {
      logger.warn("Missing signature header");
      res.status(400).send("Missing signature");
      return;
    }
    const rawBody = await readRawBody(req);
    const isValid = validateMetaSignature(
      rawBody,
      signature.replace("sha256=", ""),
      appConfig.webhook.secret
    );
    if (!isValid) {
      logger.warn("Invalid signature");
      res.status(403).send("Invalid signature");
      return;
    }

    const body = JSON.parse(rawBody);

    if (body.object === "whatsapp_business_account") {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          // Formato WhatsApp Cloud API
          const messages = change.value?.messages || [];
          for (const msg of messages) {
            if (msg.type !== "text" || !msg.text?.body) continue;
            const messageId = msg.id as string;
            const senderId = msg.from as string;
            const text = msg.text.body as string;
            const tsSec = Number(msg.timestamp);

            const guard = await shouldProcessMessage(tsSec, messageId);
            if (!guard.ok) {
              logger.warn(
                { messageId, senderId, reason: guard.reason },
                "Mensagem descartada"
              );
              continue;
            }

            logger.info({ messageId, senderId }, "Received message");

            try {
              await stateRepo.getOrCreateContact(senderId);
              await stateRepo.updateLastSeen(senderId);
              await stateRepo.appendMessage(senderId, "user", text);
              await orchestrator.processMessage(senderId, text, senderId);
            } catch (procErr) {
              logger.error({ error: procErr, messageId }, "Erro ao processar msg");
            }
          }
        }
        // Compat com formato antigo (Messenger-style entry.messaging)
        for (const msg of entry.messaging || []) {
          if (!msg.message?.text) continue;
          const messageId = msg.message.mid as string;
          const senderId = msg.sender.id as string;
          const text = msg.message.text as string;
          const tsMs = Number(msg.timestamp);

          const guard = await shouldProcessMessage(tsMs, messageId);
          if (!guard.ok) {
            logger.warn(
              { messageId, senderId, reason: guard.reason },
              "Mensagem descartada"
            );
            continue;
          }

          try {
            await stateRepo.getOrCreateContact(senderId);
            await stateRepo.updateLastSeen(senderId);
            await stateRepo.appendMessage(senderId, "user", text);
            await orchestrator.processMessage(senderId, text, senderId);
          } catch (procErr) {
            logger.error({ error: procErr, messageId }, "Erro ao processar msg");
          }
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Webhook processing error"
    );
    res.status(500).send("Internal error");
  }
}
```

**Nota sobre `config` vs `config_route`:** Vercel espera `export const config = {...}` no top do arquivo. Nosso `import { config }` colide. Solução acima: declara `config_route` e re-exporta como `config`.

- [ ] **Step 2: Commit**

```bash
git add api/
git commit -m "feat: Vercel API routes (webhook, config, admin/*)"
```

---

## Phase F — Painel Admin com Realtime

### Task F1: Adicionar Realtime subscriptions no admin.js

**Files:**
- Modify: `public/admin/admin.js`

- [ ] **Step 1: Localizar onde está o setInterval de 2s**

```bash
grep -n "setInterval" public/admin/admin.js
```

Anote o número da linha (deve ser ~125-140).

- [ ] **Step 2: Substituir o bloco do setInterval por Realtime**

Encontre o bloco:

```javascript
    // Sincronização periódica automática em tempo real (polling a cada 2 segundos)
    // - Aba conversas: atualiza lista de contatos e chat ativo
    // - Aba dashboard: atualiza stats e gráficos
    setInterval(async () => {
        if (currentTab === 'conversas') {
            await refreshContactsList();
            if (activeContactId) {
                const activeContact = allContacts.find(c => c.wa_id === activeContactId);
                if (activeContact) {
                    await refreshActiveChat(activeContact);
                }
            }
        } else if (currentTab === 'dashboard') {
            await loadDashboardStats();
        }
    }, 2000);
```

Substitua por:

```javascript
    // Realtime via Supabase: subscriptions substituem o polling de 2s.
    // Fallback automatico pra polling de 30s se o canal nao subir em 10s.
    initRealtimeSubscriptions();
```

- [ ] **Step 3: Criar a função `initRealtimeSubscriptions` no final do admin.js**

Adicione no final do arquivo (antes do último `}`):

```javascript
// =============================================================
// REALTIME — substitui polling 2s, zero invocacao Vercel
// =============================================================
let realtimeFallbackPolling = null;
let realtimeChannel = null;

function initRealtimeSubscriptions() {
    if (!_sb) {
        // Sem Supabase, ativa o polling de 30s
        activateFallbackPolling();
        return;
    }
    try {
        realtimeChannel = _sb.channel('admin-conversations')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
                (payload) => onRealtimeMessageInsert(payload.new))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' },
                (payload) => onRealtimeContactChange(payload.new, payload.eventType))
            .subscribe((status) => {
                console.log('[Realtime] status:', status);
                if (status === 'SUBSCRIBED') {
                    deactivateFallbackPolling();
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    activateFallbackPolling();
                }
            });

        // Failsafe: se em 10s nao virou SUBSCRIBED, liga fallback
        setTimeout(() => {
            if (!realtimeChannel || realtimeChannel.state !== 'joined') {
                console.warn('[Realtime] nao conectou em 10s, ativando polling fallback');
                activateFallbackPolling();
            }
        }, 10000);
    } catch (e) {
        console.error('[Realtime] erro ao subscrever:', e);
        activateFallbackPolling();
    }
}

function onRealtimeMessageInsert(msg) {
    if (currentTab === 'dashboard') {
        // Bump rapido nos contadores sem refetch completo
        const totalEl = document.getElementById('stat-total-messages');
        if (totalEl) {
            const n = parseInt(totalEl.textContent, 10) || 0;
            totalEl.textContent = n + 1;
        }
        // Atualiza grafico do dia em background
        loadDashboardStats();
    }
    if (currentTab === 'conversas') {
        // Se eh da conversa ativa, append direto
        if (msg.wa_id === activeContactId) {
            const activeContact = allContacts.find(c => c.wa_id === activeContactId);
            if (activeContact) {
                refreshActiveChat(activeContact);
            }
        }
        // Atualiza lista lateral
        refreshContactsList();
    }
}

function onRealtimeContactChange(contact, eventType) {
    if (currentTab === 'conversas') {
        refreshContactsList();
    }
    if (currentTab === 'dashboard') {
        loadDashboardStats();
    }
}

function activateFallbackPolling() {
    if (realtimeFallbackPolling) return;
    console.log('[Realtime] polling fallback ATIVO (30s)');
    realtimeFallbackPolling = setInterval(async () => {
        if (currentTab === 'conversas') {
            await refreshContactsList();
            if (activeContactId) {
                const c = allContacts.find(x => x.wa_id === activeContactId);
                if (c) await refreshActiveChat(c);
            }
        } else if (currentTab === 'dashboard') {
            await loadDashboardStats();
        }
    }, 30000);
}

function deactivateFallbackPolling() {
    if (!realtimeFallbackPolling) return;
    console.log('[Realtime] polling fallback DESATIVADO (Realtime SUBSCRIBED)');
    clearInterval(realtimeFallbackPolling);
    realtimeFallbackPolling = null;
}
```

- [ ] **Step 4: Bump cache version**

`public/admin/index.html`:

```bash
grep -n "admin.js?v=" public/admin/index.html
```

Localiza a linha e substitui `?v=6.2` (ou qualquer versão) por `?v=7.0`.

- [ ] **Step 5: Commit**

```bash
git add public/admin/admin.js public/admin/index.html
git commit -m "feat: Realtime subscriptions no painel (substitui polling 2s)"
```

---

## Phase G — Vercel Config + Cleanup

### Task G1: vercel.json

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Criar arquivo**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/admin", "destination": "/admin/index.html" }
  ],
  "functions": {
    "api/webhook.ts": { "maxDuration": 30 }
  },
  "headers": [
    {
      "source": "/admin/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }
      ]
    }
  ]
}
```

---

### Task G2: .vercelignore

**Files:**
- Create: `.vercelignore`

- [ ] **Step 1: Criar arquivo**

```
node_modules
data
dist
*.db
*.db-*
.env
docs
scripts
tests
chat-test.html
simu_data.html
```

(Note: `data/` é o SQLite local que vamos excluir do deploy. `chat-test.html` na raiz é o testador local — não vai pra prod.)

---

### Task G3: Atualizar package.json scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Editar bloco "scripts"**

Substitua o bloco inteiro `"scripts": {...}` por:

```json
"scripts": {
  "build": "tsc --noEmit",
  "dev": "vercel dev",
  "test": "vitest",
  "test:run": "vitest run",
  "lint": "tsc --noEmit"
}
```

Removidos: `start`, `worker`, `smoke`, `simulate` (não fazem mais sentido em Vercel).

- [ ] **Step 2: Commit**

```bash
git add vercel.json .vercelignore package.json
git commit -m "chore: vercel.json + scripts adaptados"
```

---

### Task G4: Verificar typecheck final

- [ ] **Step 1: Rodar lint**

```bash
npx tsc --noEmit
```

Expected: zero erros.

Se aparecer erro de `import` de algum arquivo deletado, abre o arquivo que importa e remove a linha. Erros típicos:
- `src/llm/gemini.ts` ou `src/llm/claude.ts` importando algo obsoleto — remova
- `src/worker/orchestrator.ts` referenciando `getDatabase` — remova

- [ ] **Step 2: Commit fix se houve mudanças**

```bash
git add -A
git commit -m "fix: limpa imports obsoletos pos-migracao Supabase"
```

---

## Phase H — Deploy Vercel

### Task H1: Instalar Vercel CLI

**Files:** (none — global tool)

- [ ] **Step 1: Instalar**

```bash
npm install -g vercel
```

- [ ] **Step 2: Verificar**

```bash
vercel --version
```

Expected: número de versão (ex: `34.x.x`).

---

### Task H2: Login e link

- [ ] **Step 1: Login**

```bash
vercel login
```

Segue o fluxo do navegador (usa GitHub/Google/Email).

- [ ] **Step 2: Link do projeto local pro Vercel**

```bash
cd "c:\Users\joaov\.gemini\antigravity-ide\Agente Ideal"
vercel link
```

Responde:
- Set up "...": **Y**
- Which scope: tua conta
- Link to existing project?: **N** (vai criar novo)
- Project name: `agente-ideal` (ou outro)
- Directory: `.` (current)

Expected: cria `.vercel/project.json` com o project ID.

---

### Task H3: Configurar variáveis de ambiente no Vercel

- [ ] **Step 1: Adicionar cada env var**

Pra cada variável da lista abaixo, roda:

```bash
vercel env add NOME_DA_VARIAVEL
```

CLI pede:
- Value: cola o valor
- Environments: marca **Production + Preview + Development** (use espaço pra selecionar todos)

Lista (executar uma por uma):

```
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_ACCESS_TOKEN
WHATSAPP_APP_SECRET
WHATSAPP_VERIFY_TOKEN
WHATSAPP_DRY_RUN
LLM_PROVIDER
ANTHROPIC_API_KEY
CLAUDE_MODEL
GEMINI_API_KEY
GEMINI_MODEL
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
INSTITUTION_NAME
PERSONA_NAME
ENROLLMENT_PERIOD_END
SUPABASE_URL
SUPABASE_ANON_KEY
ADMIN_TOKEN
DATABASE_PROVIDER
```

Note: `DATABASE_PROVIDER=supabase` (forçando). `WHATSAPP_DRY_RUN=0`.

**ATENÇÃO:** os valores vêm do `.env` local. Cuidado: o `ADMIN_TOKEN` deveria ser **um novo, forte, gerado especificamente pra produção** (ex: `openssl rand -hex 32`).

- [ ] **Step 2: Listar pra confirmar**

```bash
vercel env ls
```

Expected: 19 variáveis listadas (a contagem pode variar; o importante é não faltar nenhuma da lista).

---

### Task H4: Deploy preview

- [ ] **Step 1: Deploy**

```bash
vercel
```

Expected: termina com uma URL tipo `https://agente-ideal-abc123.vercel.app`. Anote.

- [ ] **Step 2: Smoke test — config endpoint**

```bash
curl https://agente-ideal-abc123.vercel.app/api/config
```

Expected: JSON com `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ADMIN_TOKEN`.

- [ ] **Step 3: Smoke test — admin panel**

Abre no browser: `https://agente-ideal-abc123.vercel.app/admin`

Expected: painel carrega, conecta no Supabase ("Conectado ao Supabase" no rodapé), Dashboard mostra os contadores.

- [ ] **Step 4: Smoke test — webhook GET (verificação Meta)**

```bash
curl "https://agente-ideal-abc123.vercel.app/webhook?hub.mode=subscribe&hub.verify_token=<seu_verify_token>&hub.challenge=teste123"
```

Substitui `<seu_verify_token>` pelo valor do `WHATSAPP_VERIFY_TOKEN`.

Expected: resposta `teste123` (echo) com status 200.

Se 403: token não bate. Confere `vercel env ls` e re-deploy.

---

### Task H5: Atualizar webhook URL na Meta

**Files:** (none — manual user step no console Meta)

- [ ] **Step 1: Operador atualiza webhook**

Meta for Developers → app `Agente Ideal` → WhatsApp → Configuration → Webhook → **Edit** → Callback URL = `https://agente-ideal-abc123.vercel.app/webhook` → Verify token = mesmo do `.env` → **Verify and Save**.

Expected: verifica com sucesso. Webhook fields → `messages` assinado.

- [ ] **Step 2: Operador testa envio real**

Do WhatsApp pessoal (cadastrado como testador) → manda mensagem pro número de teste da Meta.

Expected dentro de ~8s:
1. Bot responde no WhatsApp
2. Painel admin (aberto) mostra a nova mensagem em **Conversas** sem refresh
3. Dashboard incrementa "Total de Mensagens"

Logs no Vercel (`vercel logs <url>`) devem mostrar `Received message` e nenhum erro.

---

### Task H6: Promover pra production

- [ ] **Step 1: Deploy production**

```bash
vercel --prod
```

Expected: URL `https://agente-ideal.vercel.app` (sem hash). Domínio estável.

- [ ] **Step 2: Atualizar webhook Meta pra URL prod**

No painel da Meta, mesma tela do passo H5, atualiza Callback URL pra `https://agente-ideal.vercel.app/webhook` → Verify.

- [ ] **Step 3: Re-testar envio**

Manda mensagem novamente, confirma resposta.

- [ ] **Step 4: Commit final + push**

```bash
git add -A
git commit -m "feat: migracao Vercel completa"
git push origin master
```

---

## Pós-Deploy: Limpeza Opcional

### Task I1: Apagar dados antigos de teste do Supabase (opcional)

Se você quer começar do zero quando entrar em produção:

```sql
-- Apaga conversas de teste
DELETE FROM messages;
DELETE FROM contacts;
DELETE FROM processed_messages;

-- Reseta cutoff pra agora (qualquer msg anterior vira ignorada)
UPDATE bot_state SET value = (EXTRACT(EPOCH FROM NOW()) * 1000)::TEXT, updated_at = NOW()
WHERE key = 'cutoff_ms';
```

### Task I2: Rotacionar credenciais expostas neste planejamento

Tokens que foram colados em chat:
- Telegram → @BotFather `/revoke` → atualiza `TELEGRAM_BOT_TOKEN` no Vercel
- WhatsApp Access Token → gerar permanente (system user) → atualiza no Vercel
- WhatsApp App Secret → Reset em "Configurações do app → Básico" → atualiza no Vercel

Após rotacionar, `vercel --prod` pra fazer redeploy com os novos.

---

## Checklist Final de Validação

- [ ] Branch `main-legacy` existe
- [ ] Tabelas `processed_messages` e `bot_state` no Supabase
- [ ] Realtime habilitado em `messages` e `contacts`
- [ ] `npx tsc --noEmit` passa zero erros
- [ ] `npm ls better-sqlite3 fastify` mostra "(empty)"
- [ ] Pasta `admin-panel/` não existe, `public/admin/` existe
- [ ] `api/webhook.ts`, `api/config.ts`, `api/admin/*.ts` criados
- [ ] `vercel.json` na raiz
- [ ] Deploy preview funciona
- [ ] Webhook Meta verifica com sucesso
- [ ] Mensagem real do WhatsApp gera resposta em <8s
- [ ] Painel atualiza em tempo real (Realtime)
- [ ] Telegram recebe escalações
- [ ] Deploy production ativo
- [ ] Credenciais expostas foram rotacionadas
