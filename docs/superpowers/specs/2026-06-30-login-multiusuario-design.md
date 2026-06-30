# Sistema de Login Multi-usuário — Design

**Data:** 2026-06-30
**Status:** Aprovado (aguardando plano de implementação)

## Contexto

Hoje o projeto **Agente Ideal** não tem usuários: tanto o painel (`/admin`) quanto o
PWA mobile (`/app`) usam um **único token compartilhado** (`ADMIN_TOKEN`) embutido no
JS público, com login automático. Não há papéis, escopo por unidade nem registro de
quem responde.

Já existem peças reaproveitáveis:
- `contacts.unit_tag` (`AM`/`BC`/`CN`), preenchida pelo webhook.
- Donut do dashboard com visão "Unidades".
- Takeover humano via `POST /api/admin/contacts/[wa_id]/messages` (grava mensagem
  `assistant`, mas sem registrar quem enviou).
- Supabase com RLS `allow_all` + anon key.

## Objetivo

Substituir o token único por **autenticação multi-usuário real**, com 4 perfis:

| Login | Senha inicial | Papel | Unidade | Troca forçada |
|---|---|---|---|---|
| `admin` | `Ideal@2090` | admin | — | Não |
| `elizangela.cruz@grupoideal.com.br` | `senha123` | unit | AM | Sim |
| `ivane.furtado@grupoideal.com.br` | `senha123` | unit | BC | Sim |
| `adriane.fernandes@grupoideal.com.br` | `senha123` | unit | CN | Sim |

Requisitos do usuário:
1. Login obrigatório antes de entrar; sessão **persiste no dispositivo** (app ou site)
   para não repetir o login.
2. As 3 atendentes, ao entrar com `senha123`, são forçadas a **criar nova senha e
   confirmar**.
3. Cada atendente atende uma unidade: vê no **chat inicial apenas os contatos com a
   tag da sua unidade**, e o **dashboard filtrado** para a sua unidade.
4. Remover a categoria **"Não identificado"** do dashboard.
5. Só o **admin** tem acesso total e ganha um menu **"Usuários"** (CRUD) nas
   configurações. Todos têm "trocar minha senha".
6. No painel do admin, ver o **nome de quem assumiu o atendimento** nas mensagens.

## Decisões (confirmadas com o usuário)

- Atendentes de unidade usam **app + painel restrito** (mesmo login). No `/admin`
  veem só **Dashboard (travado na unidade) + Conversas (filtradas)**.
- Menu "Usuários": **CRUD completo** (criar/editar/excluir/resetar senha).
- Segurança: **hash + token assinado**, armazenando os usuários **no Supabase**.
- Admin entra com `admin` (não e-mail), sem troca forçada.

## Arquitetura

### 1. Modelo de dados (migration Supabase idempotente)

Arquivo: `public/admin/supabase-app-users.sql`

```sql
ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent_name TEXT;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,           -- 'admin' ou e-mail
  email TEXT,
  password_hash TEXT NOT NULL,          -- formato scrypt "salt:hash" (hex)
  role TEXT NOT NULL DEFAULT 'unit',    -- 'admin' | 'unit'
  unit TEXT,                            -- 'AM' | 'BC' | 'CN' (só unit)
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_users_login ON app_users(login);

-- RLS no padrão das demais tabelas (anon key → allow_all). A proteção real é o
-- backend: o anon key nunca lê app_users diretamente do frontend; só o backend
-- (com service/anon) valida senha e nunca devolve password_hash.
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_users' AND policyname='allow_all_app_users')
  THEN CREATE POLICY "allow_all_app_users" ON app_users FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;
```

> **Nota de segurança:** o `login` (POST) é a única forma de criar/editar usuários.
> O frontend nunca faz `select` direto em `app_users`; toda leitura/escrita de
> usuário passa pelos endpoints `/api/auth/*` e `/api/admin/users*`, que jamais
> devolvem `password_hash`. O seed dos 4 usuários é feito por um script
> (`scripts/seed-users.ts`) executado uma vez, porque os hashes precisam ser
> gerados pelo Node (scrypt) — não por SQL.

### 2. Hash de senha (sem nova dependência)

`src/auth/password.ts` usando `crypto.scryptSync`:
- `hashPassword(plain)` → `"<saltHex>:<hashHex>"`.
- `verifyPassword(plain, stored)` → comparação em tempo constante (`timingSafeEqual`).

### 3. Token de sessão assinado (stateless)

`src/auth/token.ts`:
- Segredo: `process.env.AUTH_SECRET || config.adminToken`.
- `signToken(payload)` → `base64url(json).base64url(hmacSHA256)`.
  payload = `{ uid, role, unit, name, iat, exp }` (exp = +30 dias).
- `verifyToken(token)` → valida assinatura e expiração; retorna payload ou `null`.

### 4. Endpoints de autenticação

- `POST /api/auth/login` `{ login, password }`
  - Busca `app_users` por `login` (case-insensitive), `active=true`.
  - `verifyPassword`; se falhar → 401.
  - Retorna `{ token, user: { id, name, role, unit, must_change_password } }`.
- `GET /api/auth/me` (Bearer) → revalida token contra o banco (papel/unidade atuais,
  `must_change_password`, `active`). Retorna o usuário sem hash.
- `POST /api/auth/change-password` `{ currentPassword, newPassword }` (Bearer)
  - Valida senha atual, grava novo hash, `must_change_password=false`.
  - Regra mínima de senha: ≥ 6 caracteres e diferente da atual.

### 5. Guardas de autorização (`api/_lib/auth.ts`)

- `getAuthUser(req)`: extrai Bearer; se for o `ADMIN_TOKEN` legado → usuário sintético
  `{ role:'admin', name:'Admin' }` (mantém bot/ferramentas). Caso contrário,
  `verifyToken` → payload.
- `requireUser(req,res)`: retorna o usuário ou responde 401. Usado em contacts/stats/
  messages (com escopo de unidade aplicado dentro do handler).
- `requireAdmin(req,res)`: exige `role==='admin'` ou 403. Usado em config, escrita de
  banco e `users*`.
- `checkAdminAuth` legado passa a delegar para `requireUser` (compatibilidade) onde já
  era usado, e os handlers aplicam o escopo. Endpoints sensíveis migram para
  `requireAdmin`.

### 6. CRUD de usuários (admin only)

- `GET /api/admin/users` → lista (sem hash).
- `POST /api/admin/users` `{ name, login, email, role, unit, password }` → cria
  (hash gerado no backend; `must_change_password=true`).
- `PATCH /api/admin/users/[id]` → edita campos; `resetPassword` opcional (gera novo
  hash + `must_change_password=true`).
- `DELETE /api/admin/users/[id]` → `active=false` (soft delete; não deixa excluir o
  último admin).

### 7. Escopo por unidade

- **`contacts.ts`**: se `user.role==='unit'`, filtra o resultado do inbox para
  `unit_tag === user.unit`.
- **`messages.ts`** (GET e POST): se `user.role==='unit'`, carrega o contato e bloqueia
  (403) se `unit_tag !== user.unit`.
- **`stats.ts`**: se `user.role==='unit'`, calcula as métricas restritas à unidade —
  obtém o conjunto de `wa_id` com `unit_tag = user.unit` e escopa contagens de
  contatos e mensagens a esse conjunto; donuts/segmentos idem. Admin mantém visão
  global. Cache de stats passa a ter chave por escopo (`admin` vs unidade).

### 8. "Quem está respondendo"

- `messages.ts` POST passa `user.name` para `repo.appendMessage(..., { agent_name })`.
- `StateRepository.appendMessage` aceita `agent_name` opcional e grava na coluna.
- Inbox (`get_contacts_inbox` RPC / fallback) e histórico (`messages` GET) passam a
  devolver `agent_name`.
- Frontends mostram "— *Nome*" nas mensagens de humano (agent_name não nulo). Mensagens
  do bot continuam sem rótulo.
- A RPC `get_contacts_inbox` precisa incluir `agent_name` no preview (atualizar
  `supabase-contacts-inbox-rpc.sql`); o fallback em Node já lê a mensagem inteira.

### 9. Frontend `/admin`

- **Login real**: tela de login (campo login + senha) substitui o auto-login por token.
  Token salvo em `localStorage['AUTH_TOKEN']`. No boot, `GET /api/auth/me` valida; se
  inválido → tela de login.
- **Troca forçada**: se `me.must_change_password`, exibe tela "nova senha + confirmar"
  antes de liberar o painel.
- **Menu por papel**: `unit` vê só **Dashboard + Conversas**; **Banco/Config ocultos**;
  **Usuários** só para admin. Todos têm "trocar minha senha".
- **Dashboard**: para `unit`, o filtro de unidade fica **travado** na unidade do
  usuário. Remover o bucket **"Não identificado"** dos 3 donuts (Intenções/Unidades/
  Segmento): contatos sem tag não entram na contagem; a fatia some.
- **Usuários (admin)**: tabela com CRUD + botão "resetar senha".
- **Chat**: mensagens de humano exibem o nome do atendente.

### 10. Frontend `/app` (PWA)

- Tela de login passa de "token" para **login + senha**. Token salvo em
  `localStorage` (`CRM_TOKEN` reutilizado ou novo `AUTH_TOKEN`).
- Troca forçada de senha (mesma regra).
- Inbox filtrado por unidade (para `unit`).
- Entrada "trocar senha".
- Mensagens de humano exibem o nome do atendente.

### 11. Variáveis de ambiente

- `AUTH_SECRET` (novo, opcional) — segredo de assinatura do token; fallback para
  `ADMIN_TOKEN` se ausente. Documentar em `.env.example`.

## Fora de escopo (YAGNI)

- Recuperação de senha por e-mail.
- Logs de auditoria / histórico de login.
- 2FA.
- Permissões granulares além de `admin` × `unit`.

## Testes

- `password.ts`: hash/verify (sucesso, falha, formato inválido).
- `token.ts`: sign/verify (válido, adulterado, expirado).
- `login`: credenciais corretas/erradas, usuário inativo, `must_change_password`.
- `change-password`: senha atual errada, nova fraca, sucesso zera flag.
- Escopo de unidade: contato/stat de outra unidade bloqueado para `unit`; admin vê tudo.
- `agent_name`: POST grava o nome; GET devolve.

## Riscos

- **Stats por unidade**: mensagens não têm coluna de unidade; o escopo é derivado do
  conjunto de `wa_id` da unidade. Em volume alto pode ficar pesado — mitigado pelo
  cache por escopo; revisar se a base crescer muito.
- **Migração ordenada**: rodar `supabase-app-users.sql` + `scripts/seed-users.ts` +
  RPC atualizada antes do deploy do frontend novo, senão o login quebra.
- **Compatibilidade**: manter `ADMIN_TOKEN` legado como admin evita quebrar o bot e
  ferramentas durante a transição.
