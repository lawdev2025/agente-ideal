# Sistema de Login Multi-usuário — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o token único compartilhado por autenticação multi-usuário real (admin + 3 atendentes de unidade), com escopo por unidade no chat e no dashboard, menu de usuários para o admin, troca forçada de senha no primeiro acesso e registro de quem responde.

**Architecture:** Usuários ficam no Supabase (`app_users`). Backend valida senha com `scrypt` nativo e emite token assinado (HMAC, stateless) salvo no dispositivo. Endpoints da API ganham guardas `requireUser`/`requireAdmin` e aplicam escopo por unidade. Frontends (`/admin` e `/app`) trocam o auto-login por um formulário de login real.

**Tech Stack:** TypeScript, Vercel serverless functions (`@vercel/node`), Supabase JS, `node:crypto` (scrypt/hmac), Vitest, HTML/CSS/JS puro nos frontends.

## Global Constraints

- **Sem novas dependências de runtime.** Hash e token usam `node:crypto` (já disponível).
- **`password_hash` nunca volta ao navegador.** Nenhum endpoint devolve o hash; nenhum frontend faz `select` direto em `app_users`.
- **Compatibilidade:** o `ADMIN_TOKEN` legado continua aceito como admin (não quebrar bot/ferramentas).
- **Login do admin é `admin`** (não e-mail); atendentes entram pelo e-mail. Login é **case-insensitive**.
- **Migrations Supabase são idempotentes** e ficam em `public/admin/*.sql`, no padrão das existentes.
- **Unidades:** `AM` (Augusto Montenegro), `BC` (Batista Campos), `CN` (Cidade Nova).
- **Idioma:** comentários e textos de UI em português, como o resto do código.

---

### Task 1: Utilitário de hash de senha (scrypt)

**Files:**
- Create: `src/auth/password.ts`
- Test: `tests/auth-password.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(plain: string): string` → string no formato `"<saltHex>:<hashHex>"`.
  - `verifyPassword(plain: string, stored: string): boolean` → comparação em tempo constante; `false` se o formato for inválido.

- [ ] **Step 1: Write the failing test**

```ts
// tests/auth-password.test.ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password";

describe("password hashing", () => {
  it("verifica a senha correta", () => {
    const stored = hashPassword("Ideal@2090");
    expect(verifyPassword("Ideal@2090", stored)).toBe(true);
  });
  it("rejeita senha errada", () => {
    const stored = hashPassword("Ideal@2090");
    expect(verifyPassword("errada", stored)).toBe(false);
  });
  it("gera hashes diferentes (salt aleatório) pra mesma senha", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });
  it("rejeita formato inválido sem lançar", () => {
    expect(verifyPassword("x", "lixo-sem-dois-pontos")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth-password.test.ts`
Expected: FAIL — não encontra `../src/auth/password`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/auth/password.ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [saltHex, hashHex] = (stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(plain, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auth-password.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/auth/password.ts tests/auth-password.test.ts
git commit -m "feat(auth): util de hash de senha com scrypt"
```

---

### Task 2: Token de sessão assinado (HMAC, stateless)

**Files:**
- Create: `src/auth/token.ts`
- Test: `tests/auth-token.test.ts`

**Interfaces:**
- Consumes: `config.adminToken` (de `src/config`) como fallback de segredo.
- Produces:
  - `type TokenPayload = { uid: string; role: "admin" | "unit"; unit: string | null; name: string; iat: number; exp: number }`
  - `signToken(data: { uid: string; role: "admin" | "unit"; unit: string | null; name: string }, ttlMs?: number): string`
  - `verifyToken(token: string): TokenPayload | null` (null se assinatura inválida ou expirado).

- [ ] **Step 1: Write the failing test**

```ts
// tests/auth-token.test.ts
import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "../src/auth/token";

const base = { uid: "u1", role: "unit" as const, unit: "AM", name: "Elizangela" };

describe("session token", () => {
  it("assina e valida um token", () => {
    const t = signToken(base);
    const p = verifyToken(t);
    expect(p?.uid).toBe("u1");
    expect(p?.role).toBe("unit");
    expect(p?.unit).toBe("AM");
    expect(p?.name).toBe("Elizangela");
  });
  it("rejeita token adulterado", () => {
    const t = signToken(base);
    expect(verifyToken(t + "x")).toBeNull();
  });
  it("rejeita token expirado", () => {
    const t = signToken(base, -1000); // já expirado
    expect(verifyToken(t)).toBeNull();
  });
  it("rejeita lixo", () => {
    expect(verifyToken("nada")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth-token.test.ts`
Expected: FAIL — não encontra `../src/auth/token`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/auth/token.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

export type TokenPayload = {
  uid: string;
  role: "admin" | "unit";
  unit: string | null;
  name: string;
  iat: number;
  exp: number;
};

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function secret(): string {
  return process.env.AUTH_SECRET || config.adminToken || "dev-insecure-secret";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(data: string): string {
  return b64url(createHmac("sha256", secret()).update(data).digest());
}

export function signToken(
  data: { uid: string; role: "admin" | "unit"; unit: string | null; name: string },
  ttlMs: number = DEFAULT_TTL_MS
): string {
  const now = Date.now();
  const payload: TokenPayload = { ...data, iat: now, exp: now + ttlMs };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as TokenPayload;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auth-token.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/auth/token.ts tests/auth-token.test.ts
git commit -m "feat(auth): token de sessão assinado (HMAC, stateless)"
```

---

### Task 2.1: `AUTH_SECRET` no schema de env

**Files:**
- Modify: `src/config/env.ts` (zod schema — adicionar campo opcional)
- Modify: `.env.example`

**Interfaces:**
- Produces: `AUTH_SECRET` opcional no env (usado por `src/auth/token.ts`).

- [ ] **Step 1: Adicionar ao schema zod**

Em `src/config/env.ts`, localize a linha `ADMIN_TOKEN: z.string().min(1),` e adicione logo abaixo:

```ts
  AUTH_SECRET: z.string().optional().default(""),
```

> Não é obrigatório expor em `config` nested — `token.ts` lê `process.env.AUTH_SECRET` direto. O schema só evita o zod reclamar de chave desconhecida caso `.strict()` esteja em uso. Se o schema não for `.strict()`, este passo de env.ts é opcional, mas mantenha a doc.

- [ ] **Step 2: Documentar no .env.example**

Adicione ao final de `.env.example`:

```
# Segredo para assinar tokens de sessão do login multi-usuário.
# Opcional: se ausente, usa ADMIN_TOKEN como fallback.
AUTH_SECRET=
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: sem erros de tipo.

- [ ] **Step 4: Commit**

```bash
git add src/config/env.ts .env.example
git commit -m "chore(auth): env AUTH_SECRET opcional"
```

---

### Task 3: Migration Supabase + script de seed dos usuários

**Files:**
- Create: `public/admin/supabase-app-users.sql`
- Create: `scripts/seed-users.ts`

**Interfaces:**
- Produces: tabela `app_users`, coluna `messages.agent_name`, e os 4 usuários iniciais com hashes gerados pelo Node.

- [ ] **Step 1: Escrever a migration SQL**

```sql
-- public/admin/supabase-app-users.sql
-- =====================================================================
-- Usuários do sistema (login multi-usuário) + coluna de "quem respondeu".
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente.
-- O SEED dos usuários NÃO é feito aqui (os hashes de senha precisam ser
-- gerados pelo Node/scrypt) — rode `npx tsx scripts/seed-users.ts` depois.
-- =====================================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent_name TEXT;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'unit',
  unit TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_users_login ON app_users(login);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_users' AND policyname='allow_all_app_users')
  THEN CREATE POLICY "allow_all_app_users" ON app_users FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;
```

- [ ] **Step 2: Escrever o script de seed (idempotente)**

```ts
// scripts/seed-users.ts
// Cria/atualiza os 4 usuários iniciais. Idempotente: usa upsert por `login`.
// Rode: npx tsx scripts/seed-users.ts
import "dotenv/config";
import { getSupabase } from "../src/db/supabase-client";
import { hashPassword } from "../src/auth/password";

type Seed = { name: string; login: string; email: string | null; role: "admin" | "unit"; unit: string | null; password: string; must: boolean };

const SEEDS: Seed[] = [
  { name: "Admin", login: "admin", email: null, role: "admin", unit: null, password: "Ideal@2090", must: false },
  { name: "Elizangela", login: "elizangela.cruz@grupoideal.com.br", email: "elizangela.cruz@grupoideal.com.br", role: "unit", unit: "AM", password: "senha123", must: true },
  { name: "Ivane", login: "ivane.furtado@grupoideal.com.br", email: "ivane.furtado@grupoideal.com.br", role: "unit", unit: "BC", password: "senha123", must: true },
  { name: "Adriane", login: "adriane.fernandes@grupoideal.com.br", email: "adriane.fernandes@grupoideal.com.br", role: "unit", unit: "CN", password: "senha123", must: true },
];

async function main() {
  const sb = getSupabase();
  for (const s of SEEDS) {
    const now = Date.now();
    const { data: existing } = await sb.from("app_users").select("id").eq("login", s.login).maybeSingle();
    if (existing) {
      console.log(`= já existe: ${s.login} (não sobrescreve senha)`);
      continue;
    }
    const { error } = await sb.from("app_users").insert({
      name: s.name, login: s.login.toLowerCase(), email: s.email,
      password_hash: hashPassword(s.password), role: s.role, unit: s.unit,
      must_change_password: s.must, active: true, created_at: now, updated_at: now,
    });
    if (error) { console.error(`x falha ${s.login}:`, error.message); process.exit(1); }
    console.log(`+ criado: ${s.login} (${s.role}${s.unit ? "/" + s.unit : ""})`);
  }
  console.log("Seed concluído.");
}
main();
```

- [ ] **Step 3: Rodar a migration no Supabase**

Abra o SQL Editor do Supabase e cole/execute `public/admin/supabase-app-users.sql`.
Expected: `app_users` criada e `messages.agent_name` adicionada, sem erro.

- [ ] **Step 4: Rodar o seed**

Run: `npx tsx scripts/seed-users.ts`
Expected: imprime `+ criado: admin ...` e os 3 e-mails; termina com "Seed concluído.".

- [ ] **Step 5: Commit**

```bash
git add public/admin/supabase-app-users.sql scripts/seed-users.ts
git commit -m "feat(auth): migration app_users + agent_name e script de seed"
```

---

### Task 4: Guardas de autorização (`requireUser` / `requireAdmin`)

**Files:**
- Modify: `api/_lib/auth.ts`
- Test: `tests/auth-guards.test.ts`

**Interfaces:**
- Consumes: `verifyToken` (Task 2), `config.adminToken`.
- Produces:
  - `type AuthUser = { uid: string; role: "admin" | "unit"; unit: string | null; name: string }`
  - `getAuthUser(req): AuthUser | null` — aceita token assinado OU o `ADMIN_TOKEN` legado (→ admin sintético).
  - `requireUser(req, res): AuthUser | null` — responde 401 e retorna null se não autenticado.
  - `requireAdmin(req, res): AuthUser | null` — responde 401/403; retorna o user só se admin.
  - `checkAdminAuth(req, res): boolean` — mantida; agora `true` se houver qualquer usuário válido (compat).

- [ ] **Step 1: Write the failing test**

```ts
// tests/auth-guards.test.ts
import { describe, it, expect, vi } from "vitest";
vi.mock("../src/config", () => ({ config: { adminToken: "LEGACY" } }));
import { getAuthUser } from "../api/_lib/auth";
import { signToken } from "../src/auth/token";

function reqWith(auth?: string): any { return { headers: auth ? { authorization: auth } : {} }; }

describe("getAuthUser", () => {
  it("aceita token assinado de unit", () => {
    const t = signToken({ uid: "u1", role: "unit", unit: "AM", name: "Eli" });
    const u = getAuthUser(reqWith("Bearer " + t));
    expect(u?.role).toBe("unit");
    expect(u?.unit).toBe("AM");
  });
  it("aceita ADMIN_TOKEN legado como admin", () => {
    const u = getAuthUser(reqWith("Bearer LEGACY"));
    expect(u?.role).toBe("admin");
  });
  it("rejeita sem header", () => {
    expect(getAuthUser(reqWith())).toBeNull();
  });
  it("rejeita token inválido", () => {
    expect(getAuthUser(reqWith("Bearer xxx"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth-guards.test.ts`
Expected: FAIL — `getAuthUser` não existe.

- [ ] **Step 3: Reescrever `api/_lib/auth.ts`**

```ts
// api/_lib/auth.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config } from "../../src/config";
import { verifyToken } from "../../src/auth/token";

export type AuthUser = {
  uid: string;
  role: "admin" | "unit";
  unit: string | null;
  name: string;
};

function bearer(req: VercelRequest): string {
  const auth = (req.headers.authorization || "") as string;
  return auth.replace(/^Bearer\s+/i, "").trim();
}

export function getAuthUser(req: VercelRequest): AuthUser | null {
  const token = bearer(req);
  if (!token) return null;
  // ADMIN_TOKEN legado → admin sintético (mantém bot/ferramentas e emergência).
  if (config.adminToken && token === config.adminToken) {
    return { uid: "legacy-admin", role: "admin", unit: null, name: "Admin" };
  }
  const p = verifyToken(token);
  if (!p) return null;
  return { uid: p.uid, role: p.role, unit: p.unit, name: p.name };
}

export function requireUser(req: VercelRequest, res: VercelResponse): AuthUser | null {
  const u = getAuthUser(req);
  if (!u) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return u;
}

export function requireAdmin(req: VercelRequest, res: VercelResponse): AuthUser | null {
  const u = getAuthUser(req);
  if (!u) { res.status(401).json({ error: "Unauthorized" }); return null; }
  if (u.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return null; }
  return u;
}

// Compat: handlers antigos chamam checkAdminAuth e seguem se true.
export function checkAdminAuth(req: VercelRequest, res: VercelResponse): boolean {
  return requireUser(req, res) !== null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auth-guards.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add api/_lib/auth.ts tests/auth-guards.test.ts
git commit -m "feat(auth): guardas requireUser/requireAdmin + getAuthUser"
```

---

### Task 5: Endpoint de login (`POST /api/auth/login`)

**Files:**
- Create: `api/auth/login.ts`
- Test: `tests/auth-login.test.ts`

**Interfaces:**
- Consumes: `getSupabase`, `verifyPassword` (Task 1), `signToken` (Task 2), `applyCors`.
- Produces: `POST /api/auth/login` `{ login, password }` → `200 { token, user: { id, name, role, unit, must_change_password } }` ou `401`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/auth-login.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashPassword } from "../src/auth/password";

let ROW: any = null;
vi.mock("../src/db/supabase-client", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ROW }) }) }) }),
    }),
  }),
}));
vi.mock("../api/_lib/cors", () => ({ applyCors: () => true }));

import handler from "../api/auth/login";

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}

describe("POST /api/auth/login", () => {
  beforeEach(() => { ROW = null; });
  it("loga com senha correta", async () => {
    ROW = { id: "1", name: "Admin", login: "admin", role: "admin", unit: null, must_change_password: false, active: true, password_hash: hashPassword("Ideal@2090") };
    const res = mockRes();
    await handler({ method: "POST", body: { login: "admin", password: "Ideal@2090" }, headers: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe("admin");
    expect(res.body.user.password_hash).toBeUndefined();
  });
  it("recusa senha errada", async () => {
    ROW = { id: "1", name: "Admin", login: "admin", role: "admin", unit: null, must_change_password: false, active: true, password_hash: hashPassword("Ideal@2090") };
    const res = mockRes();
    await handler({ method: "POST", body: { login: "admin", password: "x" }, headers: {} } as any, res);
    expect(res.statusCode).toBe(401);
  });
  it("recusa usuário inexistente", async () => {
    const res = mockRes();
    await handler({ method: "POST", body: { login: "nao", password: "x" }, headers: {} } as any, res);
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth-login.test.ts`
Expected: FAIL — não encontra `../api/auth/login`.

- [ ] **Step 3: Write the implementation**

```ts
// api/auth/login.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { getSupabase } from "../../src/db/supabase-client";
import { verifyPassword } from "../../src/auth/password";
import { signToken } from "../../src/auth/token";
import { logger } from "../../src/logger";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const { login, password } = (req.body || {}) as { login?: string; password?: string };
  const id = (login || "").trim().toLowerCase();
  if (!id || !password) { res.status(400).json({ error: "login e password obrigatórios" }); return; }

  try {
    const sb = getSupabase();
    const { data: user } = await sb
      .from("app_users")
      .select("*")
      .eq("login", id)
      .eq("active", true)
      .maybeSingle();

    if (!user || !verifyPassword(password, (user as any).password_hash)) {
      res.status(401).json({ error: "Login ou senha inválidos" });
      return;
    }

    const u = user as any;
    const token = signToken({ uid: u.id, role: u.role, unit: u.unit, name: u.name });
    res.status(200).json({
      token,
      user: { id: u.id, name: u.name, role: u.role, unit: u.unit, must_change_password: u.must_change_password },
    });
  } catch (error) {
    logger.error({ error }, "Erro em POST /api/auth/login");
    res.status(500).json({ error: "Internal error" });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auth-login.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add api/auth/login.ts tests/auth-login.test.ts
git commit -m "feat(auth): endpoint POST /api/auth/login"
```

---

### Task 6: Endpoint `GET /api/auth/me`

**Files:**
- Create: `api/auth/me.ts`

**Interfaces:**
- Consumes: `getAuthUser` (Task 4), `getSupabase`, `applyCors`.
- Produces: `GET /api/auth/me` → `200 { user: { id, name, role, unit, must_change_password } }` revalidado contra o banco; `401` se token inválido; `403` se inativo.

> Sem teste unitário dedicado (é orquestração fina sobre peças já testadas); validado manualmente na Task 12.

- [ ] **Step 1: Write the implementation**

```ts
// api/auth/me.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { getAuthUser } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { logger } from "../../src/logger";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  const auth = getAuthUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }

  // ADMIN_TOKEN legado não tem linha no banco: devolve o admin sintético.
  if (auth.uid === "legacy-admin") {
    res.status(200).json({ user: { id: "legacy-admin", name: "Admin", role: "admin", unit: null, must_change_password: false } });
    return;
  }

  try {
    const sb = getSupabase();
    const { data: user } = await sb.from("app_users").select("id, name, role, unit, must_change_password, active").eq("id", auth.uid).maybeSingle();
    if (!user || !(user as any).active) { res.status(403).json({ error: "Usuário inativo" }); return; }
    const u = user as any;
    res.status(200).json({ user: { id: u.id, name: u.name, role: u.role, unit: u.unit, must_change_password: u.must_change_password } });
  } catch (error) {
    logger.error({ error }, "Erro em GET /api/auth/me");
    res.status(500).json({ error: "Internal error" });
  }
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: sem erros de tipo.

- [ ] **Step 3: Commit**

```bash
git add api/auth/me.ts
git commit -m "feat(auth): endpoint GET /api/auth/me"
```

---

### Task 7: Trocar senha (`POST /api/auth/change-password`)

**Files:**
- Create: `api/auth/change-password.ts`
- Test: `tests/auth-change-password.test.ts`

**Interfaces:**
- Consumes: `getAuthUser` (Task 4), `getSupabase`, `verifyPassword`/`hashPassword` (Task 1).
- Produces: `POST /api/auth/change-password` `{ currentPassword, newPassword }` (Bearer) → `200 { ok: true }`. Regra: `newPassword` ≥ 6 chars e ≠ atual. Zera `must_change_password`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/auth-change-password.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashPassword } from "../src/auth/password";
import { signToken } from "../src/auth/token";

let ROW: any = null;
let UPDATED: any = null;
vi.mock("../src/db/supabase-client", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ROW }) }) }),
      update: (vals: any) => ({ eq: async () => { UPDATED = vals; return { error: null }; } }),
    }),
  }),
}));
vi.mock("../api/_lib/cors", () => ({ applyCors: () => true }));
vi.mock("../src/config", () => ({ config: { adminToken: "LEGACY" } }));

import handler from "../api/auth/change-password";

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}
const token = signToken({ uid: "u1", role: "unit", unit: "AM", name: "Eli" });

describe("POST /api/auth/change-password", () => {
  beforeEach(() => { ROW = { id: "u1", password_hash: hashPassword("senha123") }; UPDATED = null; });
  it("troca a senha com a atual correta", async () => {
    const res = mockRes();
    await handler({ method: "POST", headers: { authorization: "Bearer " + token }, body: { currentPassword: "senha123", newPassword: "novaSenha9" } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(UPDATED.must_change_password).toBe(false);
    expect(typeof UPDATED.password_hash).toBe("string");
  });
  it("recusa senha atual errada", async () => {
    const res = mockRes();
    await handler({ method: "POST", headers: { authorization: "Bearer " + token }, body: { currentPassword: "errada", newPassword: "novaSenha9" } } as any, res);
    expect(res.statusCode).toBe(400);
  });
  it("recusa nova senha curta", async () => {
    const res = mockRes();
    await handler({ method: "POST", headers: { authorization: "Bearer " + token }, body: { currentPassword: "senha123", newPassword: "123" } } as any, res);
    expect(res.statusCode).toBe(400);
  });
  it("recusa sem token", async () => {
    const res = mockRes();
    await handler({ method: "POST", headers: {}, body: { currentPassword: "senha123", newPassword: "novaSenha9" } } as any, res);
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth-change-password.test.ts`
Expected: FAIL — não encontra o handler.

- [ ] **Step 3: Write the implementation**

```ts
// api/auth/change-password.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { getAuthUser } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { hashPassword, verifyPassword } from "../../src/auth/password";
import { logger } from "../../src/logger";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const auth = getAuthUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (auth.uid === "legacy-admin") { res.status(400).json({ error: "Admin legado não troca senha por aqui" }); return; }

  const { currentPassword, newPassword } = (req.body || {}) as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) { res.status(400).json({ error: "Campos obrigatórios" }); return; }
  if (newPassword.length < 6) { res.status(400).json({ error: "A nova senha precisa ter ao menos 6 caracteres" }); return; }
  if (newPassword === currentPassword) { res.status(400).json({ error: "A nova senha deve ser diferente da atual" }); return; }

  try {
    const sb = getSupabase();
    const { data: user } = await sb.from("app_users").select("id, password_hash").eq("id", auth.uid).maybeSingle();
    if (!user || !verifyPassword(currentPassword, (user as any).password_hash)) {
      res.status(400).json({ error: "Senha atual incorreta" });
      return;
    }
    const { error } = await sb.from("app_users")
      .update({ password_hash: hashPassword(newPassword), must_change_password: false, updated_at: Date.now() })
      .eq("id", auth.uid);
    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error({ error }, "Erro em POST /api/auth/change-password");
    res.status(500).json({ error: "Internal error" });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auth-change-password.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add api/auth/change-password.ts tests/auth-change-password.test.ts
git commit -m "feat(auth): endpoint POST /api/auth/change-password"
```

---

### Task 8: CRUD de usuários (admin only)

**Files:**
- Create: `api/admin/users.ts` (GET list, POST create)
- Create: `api/admin/users/[id].ts` (PATCH edit/reset, DELETE soft)

**Interfaces:**
- Consumes: `requireAdmin` (Task 4), `getSupabase`, `hashPassword` (Task 1), `applyCors`.
- Produces:
  - `GET /api/admin/users` → `200 { users: [...] }` (sem `password_hash`).
  - `POST /api/admin/users` `{ name, login, email?, role, unit?, password }` → `201 { user }`.
  - `PATCH /api/admin/users/[id]` `{ name?, login?, email?, role?, unit?, active?, resetPassword? }` → `200 { ok }`. `resetPassword` (string) gera novo hash + `must_change_password=true`.
  - `DELETE /api/admin/users/[id]` → `200 { ok }` (soft delete: `active=false`). Recusa desativar o último admin ativo (`409`).

> Sem teste unitário dedicado (CRUD direto sobre o banco); validado manualmente na Task 14. Build deve passar.

- [ ] **Step 1: Implementar `api/admin/users.ts`**

```ts
// api/admin/users.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { requireAdmin } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { hashPassword } from "../../src/auth/password";
import { logger } from "../../src/logger";

const SAFE = "id, name, login, email, role, unit, must_change_password, active, created_at, updated_at";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (!requireAdmin(req, res)) return;
  const sb = getSupabase();

  if (req.method === "GET") {
    try {
      const { data } = await sb.from("app_users").select(SAFE).order("created_at", { ascending: true });
      res.status(200).json({ users: data || [] });
    } catch (error) { logger.error({ error }, "GET users"); res.status(500).json({ error: "Internal error" }); }
    return;
  }

  if (req.method === "POST") {
    const b = (req.body || {}) as any;
    const login = (b.login || "").trim().toLowerCase();
    if (!b.name || !login || !b.password || !b.role) { res.status(400).json({ error: "name, login, password e role obrigatórios" }); return; }
    if (b.role === "unit" && !b.unit) { res.status(400).json({ error: "unidade obrigatória para papel unit" }); return; }
    try {
      const now = Date.now();
      const { data, error } = await sb.from("app_users").insert({
        name: b.name, login, email: b.email || null, password_hash: hashPassword(b.password),
        role: b.role, unit: b.role === "unit" ? b.unit : null, must_change_password: true,
        active: true, created_at: now, updated_at: now,
      }).select(SAFE).single();
      if (error) { res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "Login já existe" : "Erro ao criar" }); return; }
      res.status(201).json({ user: data });
    } catch (error) { logger.error({ error }, "POST users"); res.status(500).json({ error: "Internal error" }); }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
```

- [ ] **Step 2: Implementar `api/admin/users/[id].ts`**

```ts
// api/admin/users/[id].ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../../_lib/cors";
import { requireAdmin } from "../../_lib/auth";
import { getSupabase } from "../../../src/db/supabase-client";
import { hashPassword } from "../../../src/auth/password";
import { logger } from "../../../src/logger";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (!requireAdmin(req, res)) return;
  const id = (req.query.id as string) || "";
  if (!id) { res.status(400).json({ error: "id required" }); return; }
  const sb = getSupabase();

  if (req.method === "PATCH") {
    const b = (req.body || {}) as any;
    const patch: any = { updated_at: Date.now() };
    if (typeof b.name === "string") patch.name = b.name;
    if (typeof b.login === "string") patch.login = b.login.trim().toLowerCase();
    if (typeof b.email === "string") patch.email = b.email || null;
    if (b.role === "admin" || b.role === "unit") patch.role = b.role;
    if (typeof b.unit === "string" || b.unit === null) patch.unit = b.unit;
    if (typeof b.active === "boolean") patch.active = b.active;
    if (typeof b.resetPassword === "string" && b.resetPassword.length >= 6) {
      patch.password_hash = hashPassword(b.resetPassword);
      patch.must_change_password = true;
    }
    try {
      const { error } = await sb.from("app_users").update(patch).eq("id", id);
      if (error) { res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "Login já existe" : "Erro ao editar" }); return; }
      res.status(200).json({ ok: true });
    } catch (error) { logger.error({ error }, "PATCH user"); res.status(500).json({ error: "Internal error" }); }
    return;
  }

  if (req.method === "DELETE") {
    try {
      // Não desativa o último admin ativo.
      const { data: target } = await sb.from("app_users").select("role").eq("id", id).maybeSingle();
      if ((target as any)?.role === "admin") {
        const { count } = await sb.from("app_users").select("*", { count: "exact", head: true }).eq("role", "admin").eq("active", true);
        if ((count ?? 0) <= 1) { res.status(409).json({ error: "Não dá pra remover o último admin" }); return; }
      }
      const { error } = await sb.from("app_users").update({ active: false, updated_at: Date.now() }).eq("id", id);
      if (error) throw error;
      res.status(200).json({ ok: true });
    } catch (error) { logger.error({ error }, "DELETE user"); res.status(500).json({ error: "Internal error" }); }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: sem erros de tipo.

- [ ] **Step 4: Commit**

```bash
git add api/admin/users.ts "api/admin/users/[id].ts"
git commit -m "feat(auth): CRUD de usuários (admin only)"
```

---

### Task 9: Escopo de unidade nos contatos (`contacts.ts`)

**Files:**
- Modify: `api/admin/contacts.ts`

**Interfaces:**
- Consumes: `requireUser` (Task 4).
- Produces: usuário `unit` recebe só contatos com `unit_tag === user.unit`. Admin recebe tudo.

> Validado manualmente (RPC real); build deve passar. A lógica de filtro é trivial e simétrica nos dois caminhos (RPC e fallback).

- [ ] **Step 1: Trocar a guarda e filtrar por unidade**

Em `api/admin/contacts.ts`:

1. Troque o import `import { checkAdminAuth } from "../_lib/auth";` por:
```ts
import { requireUser } from "../_lib/auth";
```
2. Troque `if (!checkAdminAuth(req, res)) return;` por:
```ts
const authUser = requireUser(req, res);
if (!authUser) return;
```
3. No caminho da RPC, antes de responder, filtre:
```ts
    const { data: rpcContacts, error: rpcErr } = await sb.rpc("get_contacts_inbox");
    if (!rpcErr) {
      const list = (rpcContacts || []) as any[];
      const scoped = authUser.role === "unit"
        ? list.filter((c) => c.unit_tag === authUser.unit)
        : list;
      res.status(200).json({ contacts: scoped });
      return;
    }
```
4. No fallback (`enriched`), aplique o mesmo filtro antes de responder:
```ts
    const scoped = authUser.role === "unit"
      ? enriched.filter((c: any) => c.unit_tag === authUser.unit)
      : enriched;
    res.status(200).json({ contacts: scoped });
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add api/admin/contacts.ts
git commit -m "feat(auth): escopo de unidade no inbox de contatos"
```

---

### Task 10: `agent_name` + escopo de unidade nas mensagens

**Files:**
- Modify: `src/state/repository.ts` (assinatura de `appendMessage`)
- Modify: `api/admin/contacts/[wa_id]/messages.ts` (guarda, escopo, gravar `agent_name`, devolver `agent_name` no GET)
- Modify: `public/admin/supabase-contacts-inbox-rpc.sql` (incluir `agent_name` no preview)

**Interfaces:**
- Consumes: `requireUser` (Task 4).
- Produces:
  - `appendMessage(waId, role, content, media?, agentName?)` — grava `agent_name` quando informado.
  - GET `messages` inclui `agent_name` em cada mensagem.
  - POST grava `agent_name = user.name`; bloqueia (403) se `unit` tentar contato de outra unidade.

- [ ] **Step 1: Estender `appendMessage`**

Em `src/state/repository.ts`, troque a assinatura/corpo de `appendMessage`:

```ts
  async appendMessage(
    waId: string,
    role: "user" | "assistant" | "system" | "tool",
    content: string,
    media?: MediaFields,
    agentName?: string
  ): Promise<number> {
    const supabase = getSupabase();
    const createdAt = Date.now();
    const { data, error } = await supabase
      .from("messages")
      .insert({ wa_id: waId, role, content, created_at: createdAt, ...(media ?? {}), ...(agentName ? { agent_name: agentName } : {}) })
      .select("id")
      .single();
    if (error) {
      logger.error({ error, waId }, "Erro ao inserir mensagem no Supabase");
      throw error;
    }
    return data.id as number;
  }
```

- [ ] **Step 2: Guarda + escopo + agent_name em `messages.ts`**

Em `api/admin/contacts/[wa_id]/messages.ts`:

1. Troque o import de auth:
```ts
import { requireUser } from "../../../_lib/auth";
```
2. Troque a checagem de auth e adicione escopo logo após validar `wa_id`:
```ts
  const authUser = requireUser(req, res);
  if (!authUser) return;

  const wa_id = (req.query.wa_id as string) || "";
  if (!wa_id) { res.status(400).json({ error: "wa_id required" }); return; }

  // Escopo de unidade: atendente só acessa contato da própria unidade.
  if (authUser.role === "unit") {
    const sbAuth = getSupabase();
    const { data: ct } = await sbAuth.from("contacts").select("unit_tag").eq("wa_id", wa_id).maybeSingle();
    if (!ct || (ct as any).unit_tag !== authUser.unit) {
      res.status(403).json({ error: "Sem acesso a este contato" });
      return;
    }
  }
```
3. No GET, inclua `agent_name` no `select`:
```ts
        .select("id, wa_id, role, content, created_at, media_type, media_url, media_mime, media_filename, agent_name")
```
4. No POST, passe `authUser.name` para as duas chamadas de `appendMessage`:
```ts
        await repo.appendMessage(wa_id, "assistant", content, {
          media_type: mediaType || "document",
          media_url: mediaUrl,
          media_filename: filename || undefined,
        }, authUser.name);
```
e
```ts
        await whatsapp.sendMessage(wa_id, text);
        await repo.appendMessage(wa_id, "assistant", text, undefined, authUser.name);
```

- [ ] **Step 3: Atualizar a RPC do inbox pra trazer `agent_name`**

Em `public/admin/supabase-contacts-inbox-rpc.sql`, no bloco `left join lateral`, troque o `select` interno e o `jsonb_build_object` para incluir `agent_name`:

```sql
  left join lateral (
    select m.role, m.content, m.created_at, m.agent_name
    from messages m
    where m.wa_id = c.wa_id
      and m.role not in ('tool', 'system')
    order by m.created_at desc
    limit 1
  ) lm on true
```
e no `jsonb_build_object` adicione:
```sql
         'last_message_agent', lm.agent_name,
```

Depois rode o arquivo atualizado no SQL Editor do Supabase (idempotente — `create or replace function`).

- [ ] **Step 4: Build + testes existentes**

Run: `npm run build && npx vitest run`
Expected: build sem erros; suíte existente passa (os testes de DRY_RUN podem falhar localmente — comportamento conhecido, ver memória `dryrun-test-failures`).

- [ ] **Step 5: Commit**

```bash
git add src/state/repository.ts "api/admin/contacts/[wa_id]/messages.ts" public/admin/supabase-contacts-inbox-rpc.sql
git commit -m "feat(chat): registra agent_name e escopo de unidade nas mensagens"
```

---

### Task 11: Escopo de unidade no dashboard (`stats.ts`)

**Files:**
- Modify: `api/admin/stats.ts`

**Interfaces:**
- Consumes: `requireUser` (Task 4).
- Produces: usuário `unit` recebe métricas restritas ao conjunto de `wa_id` com `unit_tag = user.unit`; admin mantém visão global. Cache passa a ter chave por escopo.

> Validado manualmente (depende de dados reais). Build deve passar.

- [ ] **Step 1: Trocar guarda e tornar o cache por-escopo**

Em `api/admin/stats.ts`:

1. Import:
```ts
import { requireUser } from "../_lib/auth";
```
2. Troque o cache singleton por um Map por escopo:
```ts
const STATS_TTL_MS = 30_000;
const statsCache = new Map<string, { at: number; payload: any }>();
```
3. Troque a checagem e o uso do cache:
```ts
  const authUser = requireUser(req, res);
  if (!authUser) return;
  const scopeKey = authUser.role === "unit" ? `unit:${authUser.unit}` : "admin";

  const cached = statsCache.get(scopeKey);
  if (cached && Date.now() - cached.at < STATS_TTL_MS) {
    res.setHeader("X-Cache", "HIT");
    res.status(200).json(cached.payload);
    return;
  }
```

- [ ] **Step 2: Restringir as métricas à unidade**

Logo após `const sb = getSupabase();`, derive o conjunto de `wa_id` da unidade (null = sem escopo/admin):

```ts
    // Escopo de unidade: lista de wa_ids dessa unidade (null → admin/global).
    let unitWaIds: string[] | null = null;
    if (authUser.role === "unit") {
      const { data: us } = await sb.from("contacts").select("wa_id").eq("unit_tag", authUser.unit);
      unitWaIds = (us || []).map((r: any) => r.wa_id);
      if (unitWaIds.length === 0) unitWaIds = ["__none__"]; // evita filtro vazio = tudo
    }
    const scopeMsgs = (q: any) => (unitWaIds ? q.in("wa_id", unitWaIds) : q);
    const scopeContacts = (q: any) => (unitWaIds ? q.eq("unit_tag", authUser.unit) : q);
```

Aplique nos counts: troque cada query do `Promise.all` para passar pelo helper adequado, por exemplo:

```ts
      scopeMsgs(sb.from("messages").select("*", { count: "exact", head: true })),
      scopeContacts(sb.from("contacts").select("*", { count: "exact", head: true })),
      scopeContacts(sb.from("contacts").select("*", { count: "exact", head: true }).gte("last_seen_at", cutoff24h)),
      scopeContacts(sb.from("contacts").select("*", { count: "exact", head: true }).eq("bot_paused", true)),
      scopeMsgs(sb.from("messages").select("*", { count: "exact", head: true }).eq("role", "tool").like("content", "%escalate_to_specialist%")),
```

> As RPCs `stats_unique_users_7d` e `stats_subjects` continuam globais. Para o usuário `unit`, **pule as RPCs** e use o caminho de fallback em JS já existente, que recomputa a partir de `messages` — mas envolva a query de `userMsgs` no helper de escopo:
```ts
      const { data: userMsgs } = await scopeMsgs(sb.from("messages").select("content, created_at, wa_id").eq("role", "user"));
```
Para forçar o fallback quando `unitWaIds` não é null, trate como se as RPCs tivessem erro (i.e., só use o caminho rápido das RPCs quando `unitWaIds === null`).

- [ ] **Step 3: Gravar no cache por escopo**

No final, troque `statsCache = { at: Date.now(), payload };` por:
```ts
    statsCache.set(scopeKey, { at: Date.now(), payload });
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add api/admin/stats.ts
git commit -m "feat(dashboard): métricas com escopo por unidade"
```

---

### Task 12: Login real + boot no `/admin`

**Files:**
- Modify: `public/admin/index.html` (tela de login + tela de troca forçada)
- Modify: `public/admin/admin.js` (fluxo de auth: login, me, persistência, logout)
- Modify: `public/admin/admin.css` (estilo mínimo das telas de auth)

**Interfaces:**
- Consumes: `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`.
- Produces: variável global `currentUser` (`{ id, name, role, unit }`) e `authToken` (localStorage `AUTH_TOKEN`); todas as chamadas autenticadas usam `Authorization: Bearer ${authToken}`.

> Frontend sem harness de teste — verificação é manual no navegador.

- [ ] **Step 1: Adicionar markup das telas de auth**

Em `public/admin/index.html`, logo após `<body>` (antes do container principal), adicione:

```html
<div id="auth-gate" class="auth-gate" style="display:none">
  <form id="login-form" class="auth-card">
    <h2>Entrar</h2>
    <input id="login-input" type="text" placeholder="Login ou e-mail" autocomplete="username" />
    <input id="password-input" type="password" placeholder="Senha" autocomplete="current-password" />
    <button type="submit">Entrar</button>
    <p id="login-error" class="auth-error"></p>
  </form>
  <form id="change-form" class="auth-card" style="display:none">
    <h2>Crie uma nova senha</h2>
    <input id="new-password" type="password" placeholder="Nova senha (mín. 6)" autocomplete="new-password" />
    <input id="confirm-password" type="password" placeholder="Confirme a nova senha" autocomplete="new-password" />
    <button type="submit">Salvar e entrar</button>
    <p id="change-error" class="auth-error"></p>
  </form>
</div>
```

- [ ] **Step 2: Estilo mínimo**

Em `public/admin/admin.css`, adicione ao final:

```css
.auth-gate{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:var(--bg,#0f1115);z-index:9999}
.auth-card{display:flex;flex-direction:column;gap:12px;width:min(360px,90vw);padding:28px;border-radius:14px;background:var(--card,#1b1f27);box-shadow:0 10px 40px rgba(0,0,0,.35)}
.auth-card h2{margin:0 0 6px;color:var(--text,#fff)}
.auth-card input{padding:12px 14px;border-radius:10px;border:1px solid #3a3f4b;background:#0f1115;color:#fff}
.auth-card button{padding:12px;border-radius:10px;border:0;background:#C8202E;color:#fff;font-weight:700;cursor:pointer}
.auth-error{min-height:18px;color:#ff6b6b;font-size:.9rem;margin:0}
```

- [ ] **Step 3: Fluxo de auth no `admin.js`**

No topo de `public/admin/admin.js`, substitua a inicialização do token. Onde hoje há `let adminToken = _injected.ADMIN_TOKEN || '';` (linha ~26), adicione abaixo:

```js
let authToken = localStorage.getItem('AUTH_TOKEN') || '';
let currentUser = null;
// Compat: o resto do código usa `adminToken` no header. Apontamos pro authToken.
function authHeader() { return { 'Authorization': 'Bearer ' + (authToken || adminToken) }; }
```

> **Importante:** ao longo do arquivo, as chamadas usam `` `Bearer ${adminToken}` ``. Para a transição, ao final do login bem-sucedido faça `adminToken = authToken;` para que todo o código existente continue funcionando sem reescrever cada fetch.

Adicione as funções de auth (perto do início, antes do boot):

```js
async function doLogin(login, password) {
  const r = await fetch(BACKEND_URL + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha no login');
  const data = await r.json();
  authToken = data.token; adminToken = data.token;
  localStorage.setItem('AUTH_TOKEN', authToken);
  currentUser = data.user;
  return data.user;
}

async function fetchMe() {
  if (!authToken) return null;
  const r = await fetch(BACKEND_URL + '/api/auth/me', { headers: authHeader() });
  if (!r.ok) return null;
  currentUser = (await r.json()).user;
  adminToken = authToken;
  return currentUser;
}

async function changePassword(currentPassword, newPassword) {
  const r = await fetch(BACKEND_URL + '/api/auth/change-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha ao trocar senha');
}

function logout() { localStorage.removeItem('AUTH_TOKEN'); authToken = ''; currentUser = null; location.reload(); }

function showAuthGate(mode) {
  document.getElementById('auth-gate').style.display = 'flex';
  document.getElementById('login-form').style.display = mode === 'login' ? 'flex' : 'none';
  document.getElementById('change-form').style.display = mode === 'change' ? 'flex' : 'none';
}
function hideAuthGate() { document.getElementById('auth-gate').style.display = 'none'; }
```

- [ ] **Step 4: Ligar os formulários e o boot**

Adicione os listeners e um `bootAuth()` chamado no início da inicialização (substituindo o auto-login por token embutido):

```js
let pendingChangeCurrentPassword = '';

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error'); errEl.textContent = '';
  const login = document.getElementById('login-input').value.trim();
  const password = document.getElementById('password-input').value;
  try {
    const user = await doLogin(login, password);
    if (user.must_change_password) { pendingChangeCurrentPassword = password; showAuthGate('change'); }
    else { hideAuthGate(); await afterAuth(); }
  } catch (err) { errEl.textContent = err.message; }
});

document.getElementById('change-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('change-error'); errEl.textContent = '';
  const np = document.getElementById('new-password').value;
  const cp = document.getElementById('confirm-password').value;
  if (np.length < 6) { errEl.textContent = 'Mínimo 6 caracteres.'; return; }
  if (np !== cp) { errEl.textContent = 'As senhas não conferem.'; return; }
  try {
    await changePassword(pendingChangeCurrentPassword, np);
    currentUser.must_change_password = false;
    hideAuthGate(); await afterAuth();
  } catch (err) { errEl.textContent = err.message; }
});

async function bootAuth() {
  const me = await fetchMe();
  if (!me) { showAuthGate('login'); return false; }
  if (me.must_change_password) { showAuthGate('change'); return false; }
  await afterAuth();
  return true;
}
```

`afterAuth()` é o gancho que aplica papel/menu e dispara o carregamento normal do painel. Defina-o assim (o corpo real do "ligar painel" é o que hoje roda após o config carregar):

```js
async function afterAuth() {
  applyRoleUI();        // Task 13
  await startPanel();   // renomeie o init existente do painel para startPanel() e chame aqui
}
```

> **Refator pontual:** encontre o ponto onde hoje o painel começa a carregar dados após obter config/token (o bloco que chama `loadConfig()`/`activateTab('dashboard')` no boot). Extraia esse bloco para uma função `startPanel()` e troque o disparo automático no boot por `bootAuth()`.

- [ ] **Step 5: Verificação manual**

Run: `npm run dev` (ou abra o painel apontando para o backend).
- Abra `/admin` sem token → deve aparecer a tela de login.
- Logue com `admin` / `Ideal@2090` → entra direto no painel.
- Logue com `elizangela.cruz@grupoideal.com.br` / `senha123` → aparece a tela "crie nova senha"; ao confirmar, entra.
- Recarregue a página → entra direto (sessão persistida).

- [ ] **Step 6: Commit**

```bash
git add public/admin/index.html public/admin/admin.js public/admin/admin.css
git commit -m "feat(admin): login real, troca forçada de senha e sessão persistida"
```

---

### Task 13: Menu por papel + dashboard travado por unidade no `/admin`

**Files:**
- Modify: `public/admin/admin.js` (função `applyRoleUI`, trava do filtro de unidade)
- Modify: `public/admin/index.html` (item de menu "Usuários")

**Interfaces:**
- Consumes: `currentUser` (Task 12).
- Produces: `applyRoleUI()` — esconde Banco/Config e o seletor de unidade livre para `unit`; mostra "Usuários" só para admin; trava `selectedUnitFilter`/donut na unidade do usuário.

- [ ] **Step 1: Adicionar o item de menu "Usuários"**

Em `public/admin/index.html`, na lista da sidebar (após o `<li data-tab="config">`), adicione:

```html
                    <li data-tab="usuarios" id="nav-usuarios" style="display:none">
                        <i class="fa-solid fa-users"></i> <span>Usuários</span>
                    </li>
```

E adicione a section correspondente (após `#tab-config`):

```html
                <section class="tab-content" id="tab-usuarios">
                  <div class="users-toolbar">
                    <button id="btn-new-user" class="btn">+ Novo usuário</button>
                    <button id="btn-my-password" class="btn">Trocar minha senha</button>
                  </div>
                  <table class="db-table" id="users-table">
                    <thead><tr><th>Nome</th><th>Login</th><th>Papel</th><th>Unidade</th><th>Status</th><th></th></tr></thead>
                    <tbody></tbody>
                  </table>
                </section>
```

- [ ] **Step 2: Implementar `applyRoleUI()`**

Em `public/admin/admin.js`, adicione:

```js
function applyRoleUI() {
  const isAdmin = currentUser && currentUser.role === 'admin';
  const setTab = (tab, show) => {
    const li = document.querySelector(`.sidebar-menu li[data-tab="${tab}"]`);
    if (li) li.style.display = show ? '' : 'none';
  };
  setTab('banco', isAdmin);
  setTab('config', isAdmin);
  setTab('usuarios', isAdmin);

  if (!isAdmin && currentUser) {
    // Trava o dashboard na unidade da atendente.
    selectedUnitFilter = currentUser.unit;
    window.LOCKED_UNIT = currentUser.unit;
    // Se a aba ativa for uma proibida, volta pro dashboard.
    const active = document.querySelector('.sidebar-menu li.active');
    const activeTab = active && active.getAttribute('data-tab');
    if (activeTab === 'banco' || activeTab === 'config' || activeTab === 'usuarios') {
      document.querySelector('.sidebar-menu li[data-tab="dashboard"]').click();
    }
  }
}
```

- [ ] **Step 3: Travar o filtro de unidade do donut**

Localize onde o donut de "unidades" permite clique/troca de filtro (perto de `DONUT_CONFIGS.unidades`, ~linha 601-614, e o `selectedUnitFilter`). Adicione, no ponto em que o filtro de unidade é aplicado/derivado, a trava:

```js
  // Atendente de unidade não muda o filtro: fica preso na unidade dela.
  if (window.LOCKED_UNIT) selectedUnitFilter = window.LOCKED_UNIT;
```

E no handler de clique das fatias do donut de unidades, no início:
```js
    if (window.LOCKED_UNIT) return; // unit user não alterna unidade
```

- [ ] **Step 4: Guardar acesso às abas proibidas no `activateTab`**

Localize `function activateTab(tab)` (~linha 230). No início dela, adicione:

```js
  if (currentUser && currentUser.role !== 'admin' && ['banco', 'config', 'usuarios'].includes(tab)) {
    tab = 'dashboard';
  }
```

- [ ] **Step 5: Verificação manual**

- Logue como `admin` → vê Dashboard, Conversas, Banco, Configurações, Usuários.
- Logue como atendente (já com senha trocada) → vê só Dashboard e Conversas; o dashboard mostra só a unidade dela; tentar abrir `#banco` na URL cai no Dashboard.

- [ ] **Step 6: Commit**

```bash
git add public/admin/index.html public/admin/admin.js
git commit -m "feat(admin): menu por papel e dashboard travado por unidade"
```

---

### Task 14: UI de Usuários (CRUD) + trocar minha senha no `/admin`

**Files:**
- Modify: `public/admin/admin.js` (render da tabela de usuários, criar/editar/excluir/resetar, modal "minha senha")

**Interfaces:**
- Consumes: `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/[id]`, `POST /api/auth/change-password`.
- Produces: aba "Usuários" funcional para o admin.

- [ ] **Step 1: Carregar e renderizar a tabela**

Adicione em `admin.js`:

```js
async function loadUsers() {
  const r = await fetch(BACKEND_URL + '/api/admin/users', { headers: authHeader() });
  if (!r.ok) return;
  const { users } = await r.json();
  const tb = document.querySelector('#users-table tbody');
  tb.innerHTML = (users || []).map(u => `
    <tr data-id="${u.id}">
      <td>${u.name}</td><td>${u.login}</td><td>${u.role}</td>
      <td>${u.unit || '-'}</td><td>${u.active ? 'ativo' : 'inativo'}</td>
      <td>
        <button class="btn btn-sm js-reset">Resetar senha</button>
        <button class="btn btn-sm js-del">Excluir</button>
      </td>
    </tr>`).join('');
}
```

Chame `loadUsers()` dentro de `activateTab` quando `tab === 'usuarios'`.

- [ ] **Step 2: Criar usuário (prompt simples) e ações**

```js
document.addEventListener('click', async (e) => {
  if (e.target.id === 'btn-new-user') {
    const name = prompt('Nome:'); if (!name) return;
    const login = prompt('Login (e-mail):'); if (!login) return;
    const role = prompt('Papel (admin/unit):', 'unit'); if (!role) return;
    const unit = role === 'unit' ? prompt('Unidade (AM/BC/CN):', 'AM') : null;
    const password = prompt('Senha inicial:'); if (!password) return;
    const r = await fetch(BACKEND_URL + '/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ name, login, email: login, role, unit, password }),
    });
    if (!r.ok) { alert((await r.json()).error || 'Erro'); return; }
    loadUsers();
  }
  const tr = e.target.closest('#users-table tr[data-id]');
  if (tr && e.target.classList.contains('js-reset')) {
    const np = prompt('Nova senha (mín. 6):'); if (!np || np.length < 6) return;
    const r = await fetch(BACKEND_URL + '/api/admin/users/' + tr.dataset.id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ resetPassword: np }),
    });
    if (!r.ok) { alert((await r.json()).error || 'Erro'); return; }
    alert('Senha resetada. O usuário troca no próximo login.');
  }
  if (tr && e.target.classList.contains('js-del')) {
    if (!confirm('Excluir (desativar) este usuário?')) return;
    const r = await fetch(BACKEND_URL + '/api/admin/users/' + tr.dataset.id, { method: 'DELETE', headers: authHeader() });
    if (!r.ok) { alert((await r.json()).error || 'Erro'); return; }
    loadUsers();
  }
});
```

- [ ] **Step 3: "Trocar minha senha"**

```js
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'btn-my-password') return;
  const cur = prompt('Senha atual:'); if (!cur) return;
  const np = prompt('Nova senha (mín. 6):'); if (!np || np.length < 6) return;
  try { await changePassword(cur, np); alert('Senha alterada.'); }
  catch (err) { alert(err.message); }
});
```

- [ ] **Step 4: Verificação manual**

- Como admin, abra "Usuários": vê os 4. Crie um teste, resete senha, exclua. "Trocar minha senha" funciona.

- [ ] **Step 5: Commit**

```bash
git add public/admin/admin.js
git commit -m "feat(admin): UI de usuários (CRUD) e trocar minha senha"
```

---

### Task 15: Remover "Não identificado" dos donuts + mostrar quem respondeu no chat (`/admin`)

**Files:**
- Modify: `public/admin/admin.js`

**Interfaces:**
- Consumes: `agent_name` (Task 10) nas mensagens.
- Produces: donuts sem a fatia "Não identificado"; mensagens de humano com o nome do atendente.

- [ ] **Step 1: Tirar "Não identificado" dos 3 donuts**

Em `public/admin/admin.js`, nos `DONUT_CONFIGS` (intencoes ~584, unidades ~601, segmento ~628):

1. Remova a chave `'Não identificado'` de `colors`, `labels` e do objeto `counts`.
2. Onde hoje contatos sem tag caem em `counts['Não identificado']++` (ex.: `const k = r.tag || 'Não identificado'; if (k in counts) counts[k]++; else counts['Não identificado']++;`), troque para **ignorar** os sem tag:
```js
            (data || []).forEach(r => { const k = r.tag; if (k && k in counts) counts[k]++; });
```
Faça o equivalente para `unidades` (`r.unit_tag`) e `segmento` (a cadeia de `else if` que terminava em `counts['Não identificado']++` deve simplesmente não contar — remova o `else counts['Não identificado']++;`).
3. Remova as guardas `if (... || label === 'Não identificado') return null;` (não há mais essa label).

- [ ] **Step 2: Mostrar o nome de quem respondeu**

Localize a função que renderiza uma mensagem na conversa (onde monta a bolha de `assistant`). Onde o texto/balão é construído, adicione o rótulo do atendente quando `msg.agent_name`:

```js
  // Em mensagens enviadas por humano (takeover), mostra quem respondeu.
  const agentLabel = msg.agent_name ? `<span class="msg-agent">— ${msg.agent_name}</span>` : '';
```
e inclua `agentLabel` no HTML da bolha do `assistant` (logo após o conteúdo/hora).

Adicione o estilo em `admin.css`:
```css
.msg-agent{display:block;margin-top:2px;font-size:.72rem;opacity:.7;font-style:italic}
```

- [ ] **Step 3: Verificação manual**

- Dashboard: os donuts não mostram mais a fatia cinza "Não identificado".
- Assuma um atendimento e responda; a mensagem aparece com "— <seu nome>".

- [ ] **Step 4: Commit**

```bash
git add public/admin/admin.js public/admin/admin.css
git commit -m "feat(dashboard): remove 'Não identificado' e mostra atendente no chat"
```

---

### Task 16: Login real + escopo + troca de senha no `/app` (PWA)

**Files:**
- Modify: `public/app/index.html` (tela de login: e-mail/senha; tela de troca de senha)
- Modify: `public/app/app.js` (fluxo de auth)

**Interfaces:**
- Consumes: `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`, e os endpoints de contatos/mensagens já com escopo (Tasks 9/10).
- Produces: login por e-mail/senha; sessão persistida; inbox já filtrado pelo backend; mensagens de humano com nome.

- [ ] **Step 1: Trocar a tela de login (token → e-mail/senha)**

Em `public/app/index.html`, na `<section id="screen-login">`, troque o campo de token por dois campos:

```html
        <input id="login-user" type="text" inputmode="email" placeholder="E-mail" autocomplete="username" />
        <input id="login-pass" type="password" placeholder="Senha" autocomplete="current-password" />
        <button id="login-btn">Entrar</button>
        <p id="login-error" class="login-error"></p>
```

Adicione uma tela de troca de senha (após a de login):

```html
  <section id="screen-change" class="screen">
    <div class="scr">
      <h2>Crie uma nova senha</h2>
      <input id="chg-new" type="password" placeholder="Nova senha (mín. 6)" autocomplete="new-password" />
      <input id="chg-confirm" type="password" placeholder="Confirme a senha" autocomplete="new-password" />
      <button id="chg-btn">Salvar e entrar</button>
      <p id="chg-error" class="login-error"></p>
    </div>
  </section>
```

- [ ] **Step 2: Reescrever o `doLogin` do app**

Em `public/app/app.js`, substitua o fluxo de token. Remova o `BAKED_TOKEN` como caminho de auto-login e troque `doLogin(tok)` por login com credenciais:

```js
  let token = localStorage.getItem("CRM_TOKEN") || "";
  let currentUser = null;
  let pendingPwd = "";

  async function doLogin(login, password) {
    $("login-error").textContent = "";
    try {
      const r = await fetch(API + "/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      if (!r.ok) { $("login-error").textContent = (await r.json().catch(()=>({}))).error || "Login inválido."; showScreen("login"); return; }
      const data = await r.json();
      token = data.token; localStorage.setItem("CRM_TOKEN", token);
      currentUser = data.user;
      if (data.user.must_change_password) { pendingPwd = password; showScreen("change"); return; }
      await startApp();
    } catch (e) { $("login-error").textContent = "Falha ao conectar."; showScreen("login"); }
  }

  async function changePassword(np) {
    const r = await fetch(API + "/api/auth/change-password", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ currentPassword: pendingPwd, newPassword: np }),
    });
    if (!r.ok) throw new Error((await r.json().catch(()=>({}))).error || "Falha ao trocar senha");
  }
```

> `API` é a base do backend já usada no app (mesma var que monta as URLs de fetch). `startApp()` é o que hoje roda após o login (renomeie o init pós-login para `startApp` se ainda não tiver esse nome).

- [ ] **Step 3: Ligar os botões e o boot**

```js
  $("login-btn").addEventListener("click", () => doLogin($("login-user").value.trim(), $("login-pass").value));
  $("chg-btn").addEventListener("click", async () => {
    $("chg-error").textContent = "";
    const np = $("chg-new").value, cf = $("chg-confirm").value;
    if (np.length < 6) { $("chg-error").textContent = "Mínimo 6 caracteres."; return; }
    if (np !== cf) { $("chg-error").textContent = "As senhas não conferem."; return; }
    try { await changePassword(np); currentUser.must_change_password = false; await startApp(); }
    catch (e) { $("chg-error").textContent = e.message; }
  });
```

No boot (onde hoje faz `doLogin(token).catch(...)`), troque para validar a sessão salva via `/api/auth/me`:

```js
  async function boot() {
    if (!token) { showScreen("login"); return; }
    const r = await fetch(API + "/api/auth/me", { headers: { Authorization: "Bearer " + token } }).catch(() => null);
    if (!r || !r.ok) { localStorage.removeItem("CRM_TOKEN"); showScreen("login"); return; }
    currentUser = (await r.json()).user;
    if (currentUser.must_change_password) { showScreen("change"); return; }
    await startApp();
  }
  // chamar boot() no lugar do antigo auto-login.
```

- [ ] **Step 4: Mostrar quem respondeu no app**

Onde o app renderiza uma mensagem `assistant`, inclua o nome quando `m.agent_name`:

```js
    const agent = m.agent_name ? `<small class="msg-agent">— ${m.agent_name}</small>` : "";
```
e injete `agent` no HTML da bolha. (O inbox e o escopo já vêm filtrados do backend — nada a fazer no cliente.)

- [ ] **Step 5: Verificação manual**

- Abra `/app` → tela de login por e-mail/senha.
- Logue como `ivane.furtado@grupoideal.com.br` / `senha123` → pede nova senha; após trocar, entra e vê só contatos da unidade BC.
- Reabra o app → entra direto (sessão persistida).
- Logue como `admin`/`Ideal@2090` → vê todos os contatos.

- [ ] **Step 6: Commit**

```bash
git add public/app/index.html public/app/app.js
git commit -m "feat(app): login por e-mail/senha, escopo por unidade e troca de senha"
```

---

### Task 17: Verificação fim-a-fim + documentação de deploy

**Files:**
- Modify: `README.md` (seção curta de "Login / usuários")

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Checagem completa**

Run: `npm run build && npx vitest run`
Expected: build limpo; testes novos (password, token, guards, login, change-password) passam. Os 2 testes de handoff podem falhar localmente por `WHATSAPP_DRY_RUN=1` (conhecido — memória `dryrun-test-failures`); confirme que são só esses.

- [ ] **Step 2: Roteiro manual de aceitação**

- Admin entra com `admin`/`Ideal@2090`, sem troca forçada, vê tudo + Usuários.
- Cada atendente entra pelo e-mail/`senha123`, é forçada a trocar a senha, e depois vê só sua unidade (chat + dashboard).
- Após trocar, `senha123` não funciona mais; a nova funciona.
- Sessão persiste no dispositivo (recarregar não pede login de novo).
- Mensagem enviada por humano mostra o nome no painel do admin.
- Dashboard sem a fatia "Não identificado".

- [ ] **Step 3: Documentar no README**

Adicione uma seção curta:

```markdown
## Login / usuários

Usuários ficam na tabela `app_users` (Supabase). Para inicializar:
1. Rode `public/admin/supabase-app-users.sql` no SQL Editor.
2. Rode `npx tsx scripts/seed-users.ts` (cria admin + 3 atendentes).
3. (Opcional) defina `AUTH_SECRET` na Vercel; sem ela, usa `ADMIN_TOKEN`.

Admin: login `admin`. Atendentes: login = e-mail. As atendentes trocam a senha no 1º acesso.
O admin gerencia usuários no menu **Usuários**.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: seção de login/usuários no README"
```

---

## Notas de deploy (ordem obrigatória)

1. Merge/commit do código.
2. **Antes** de o frontend novo ir ao ar: rodar `supabase-app-users.sql`, `supabase-contacts-inbox-rpc.sql` (atualizada) e `npx tsx scripts/seed-users.ts`.
3. (Opcional) setar `AUTH_SECRET` na Vercel.
4. Deploy. Lembre: **produção é a branch `main`** (memória `deploy-branch-main-nao-master`).

## Self-Review (preenchido)

- **Cobertura do spec:** modelo de dados (T3), hash (T1), token (T2), guardas (T4), login/me/change-password (T5/T6/T7), CRUD usuários (T8), escopo contatos (T9), agent_name + escopo mensagens (T10), escopo dashboard (T11), login/menu/dashboard/usuários no admin (T12-T14), remover "Não identificado" + nome no chat (T15), app (T16), verificação/deploy (T17). ✔
- **Placeholders:** nenhum "TBD/TODO"; todo passo de código tem código real. ✔
- **Consistência de tipos:** `AuthUser`, `TokenPayload`, `appendMessage(...agentName)`, `authHeader()`, `currentUser`, `authToken` usados de forma consistente entre tasks. ✔
