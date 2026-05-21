# 📋 Plano Auxiliar de Projeto — Inspirações, Ideias Novas e Ferramentas Gratuitas

Este documento foi criado com base na análise minuciosa do vídeo **"Criei um Agente de IA no WhatsApp em 20 Minutos com Claude Code"** (do canal *Eduardo Carezia - Automatiza AI*) e em pesquisas complementares. O objetivo é absorver as melhores ideias práticas, otimizações de custos e recursos **100% gratuitos** para potencializar o desenvolvimento do nosso **Agente Ideal**.

---

## 💡 1. Principais Sacadas e Aprendizados do Vídeo

1. **Desenvolvimento Orientado a Especificações (*Spec-Driven Development*):**
   * no vídeo, o desenvolvedor utiliza prompts detalhados e arquivos de especificação (`specs`) para que a IA (Claude Code / Antigravity) faça o trabalho pesado de codificação e instalação de pacotes de ponta a ponta.
   * **Como aplicar no nosso projeto:** Já possuímos uma especificação muito robusta em `docs/superpowers/specs/2026-05-20-agente-ideal-whatsapp-design.md` e um plano de implementação detalhado em `docs/superpowers/plans/2026-05-21-agente-ideal-implementation.md`. Podemos delegar tarefas bloco a bloco para o Antigravity executar de forma 100% autônoma.

2. **Foco Total na API Oficial (Meta Cloud API):**
   * O vídeo desmistifica a ideia de que "APIs não oficiais são melhores porque são mais fáceis". A API oficial da Meta é estável, não tem custos mensais de terceiros e **elimina o risco de banimento**, que é o principal gargalo em atendimento escolar.

3. **Deploy Simples via CLI (Sem fricção):**
   * O uso de ferramentas modernas como Railway CLI permite subir o servidor em minutos direto do terminal com um comando.
   * **Nossa Melhoria Gratuita:** A Railway descontinuou seu plano gratuito de longo prazo. Abaixo, detalhamos como hospedar de forma **totalmente gratuita**.

---

## 🛠️ 2. Ecossistema de Ferramentas e Infraestrutura 100% Gratuitas

Para atingir a premissa de **custo zero** de desenvolvimento e operação do MVP, selecionamos as melhores alternativas do mercado atual com planos gratuitos robustos:

### A. Banco de Dados: Turso DB (SQLite na Nuvem)
* **O problema do SQLite local:** Ao fazer deploy em servidores de hospedagem gratuitos (como Render ou Koyeb), os containers são efêmeros (reiniciam de tempos em tempos e limpam o disco). Guardar o arquivo `agente.db` localmente fará com que o histórico de mensagens e o estado da fila sejam perdidos a cada reinicialização do container.
* **A solução gratuita:** **Turso DB** (baseado em `libSQL`, fork do SQLite).
  * **Plano Gratuito:** Até 9 GB de armazenamento, 500 bancos de dados e 1 bilhão de consultas/mês de graça.
  * **Vantagem:** Mantém a sintaxe leve e rápida do SQLite, mas hospeda os dados de forma persistente e distribuída na nuvem. Integração simples substituindo `better-sqlite3` por `@libsql/client`.

### B. Hospedagem do Servidor: Koyeb ou Render
* **Koyeb:**
  * **Plano Gratuito:** Oferece instâncias micro gratuitas de alto desempenho.
  * **Vantagem:** Não possui o "cold start" (tempo de espera para reativar o app após inatividade) agressivo do Render. O app fica online 24h.
* **Render:**
  * **Plano Gratuito:** Hospedagem Node.js excelente.
  * **Limitação:** Entra em hibernação após 15 minutos sem requisições. Como pais podem mandar mensagens a qualquer hora, o primeiro contato do dia pode demorar até 50 segundos para ser respondido devido ao "cold start".
  * *Dica Grátis:* Pode-se usar um serviço gratuito de ping/cron (como UptimeRobot) para mandar uma requisição GET ao `/healthz` a cada 10 minutos, mantendo o Render sempre ativo.

### C. Franquia Oficial Gratuita da Meta (WhatsApp Business)
* **Como funciona:** A Meta concede **1.000 conversas gratuitas por mês** para cada conta do WhatsApp Business.
  * **Service Conversations (Iniciadas pelo Usuário):** Toda conversa onde o pai envia mensagem primeiro e o bot responde é considerada uma "conversa de serviço". Toda a troca de mensagens na janela de 24h consome apenas 1 crédito da franquia de 1.000 conversas do mês.
  * **Vantagem:** Para uma escola de médio porte em período de matrícula, 1.000 conversas mensais ativas cobrem tranquilamente todo o volume de atendimento do MVP a custo zero.

### D. LLM: Google Gemini 2.0 Flash via Google AI Studio
* **Plano Gratuito:**
  * **Limites:** 15 requisições por minuto (RPM) e 1.000.000 de tokens por dia.
  * **Vantagem:** A fila local SQLite que estruturamos no plano principal organiza e sequencia as requisições de forma assíncrona. Se tivermos picos de acessos, a fila segura o tráfego e responde de forma cadenciada, evitando estourar o limite de 15 RPM do Gemini gratuito (Erro 429).
  * **Janela de Contexto de 1.048.576 tokens:** Permite passar históricos de conversa longos sem perder performance ou contexto.

### E. Testes Locais: Ngrok ou Localtunnel (Custo Zero)
* **Como funciona:** Para configurar o Webhook na Meta, ela exige uma URL pública HTTPS configurada e ativa.
* **Solução:** **Localtunnel** ou **Ngrok** expõem a porta `3000` do seu computador local de forma segura e gratuita para a internet durante o desenvolvimento.
  * *Comando:* `npx localtunnel --port 3000` gera um link HTTPS temporário que você cola diretamente no painel de desenvolvedor da Meta.

---

## ✨ 3. Novas Ideias de Funcionalidades Inspiradas no Vídeo

### 1. Qualificação e Coleta Ativa de Leads (Lead Scoring/Profiling)
Em vez de apenas responder dúvidas passivas, o agente pode atuar na qualificação ativa do lead durante o atendimento.
* **Como funciona:** Através de *Function Calling*, adicionamos uma ferramenta chamada `salvar_perfil_lead`. Conforme o pai conversa, o Gemini identifica e extrai de forma estruturada:
  * Nome do responsável
  * Nome do aluno
  * Série/Ano de interesse (ex.: 5º ano do Fundamental)
  * Telefone e E-mail
* **Onde salva:** Adicionamos uma tabela `leads` no banco de dados para estruturar essas informações, facilitando a exportação para o comercial.

### 2. Notificação e Handoff Interativo via Telegram
O nosso plano atual envia apenas um link de retomada manual (`https://wa.me/...`). Podemos enriquecer esse fluxo gratuitamente:
* **Botões Interativos no Telegram:** O bot do Telegram pode enviar mensagens usando **Inline Keyboards** (botões interativos).
  * **Botão 1: "Reassumir Chat"** -> Faz uma requisição interna de forma segura para reativar o bot após o atendimento humano.
  * **Botão 2: "Ver Histórico Recente"** -> Exibe na hora as últimas 5 mensagens enviadas no próprio chat do Telegram para que o atendente não precise abrir o WhatsApp sem contexto.

### 3. Fila de Follow-up Inteligente (Reengajamento Gratuito)
Muitos pais iniciam a conversa e param no meio do processo. Como a janela de 24h da Meta é gratuita para responder:
* **Como funciona:** O worker pode rodar uma tarefa periódica no banco de dados buscando conversas ativas cujo último contato do usuário foi há mais de 6 horas (mas menos de 24 horas).
* **Ação:** O Gemini gera uma mensagem amigável de follow-up (ex: *"Olá, ficou alguma dúvida sobre a matrícula do 5º ano do Pedro? Estou aqui para ajudar!"*). Isso aumenta a conversão sem custos de disparo.

---

## 📈 4. Proposta de Ajustes na Arquitetura do Projeto

Para implementar essas novas ideias sem alterar a essência simplificada do projeto, propomos as seguintes modificações estruturais:

### Alteração no Banco de Dados (SQLite local -> Turso Cloud/Local Hybrid)
Usando a biblioteca `@libsql/client`, o banco se comporta exatamente como SQLite local em desenvolvimento, mas em produção conecta via URL e Token à nuvem gratuita do Turso:

```typescript
import { createClient } from '@libsql/client';
import config from '../config/env';

export const dbClient = createClient({
  url: config.DB_PATH.startsWith('file:') ? config.DB_PATH : `libsql://${config.TURSO_DB_URL}`,
  authToken: config.TURSO_AUTH_TOKEN
});
```

### Nova Tabela no Schema (`leads`)
Para armazenar os leads qualificados pelo Gemini:

```sql
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id TEXT NOT NULL UNIQUE,
  responsavel_nome TEXT,
  aluno_nome TEXT,
  serie_interesse TEXT,
  email TEXT,
  status_qualificacao TEXT DEFAULT 'em_andamento', -- em_andamento | qualificado | agendado
  updated_at INTEGER NOT NULL
);
```

---

## 🗺️ 5. Próximos Passos de Execução Acelerada

Podemos iniciar a codificação do projeto de forma extremamente ágil utilizando o **Antigravity** seguindo as etapas do plano de implementação aprovado:

1. **Setup de Ambiente:** Configurar o `package.json` e as dependências (adicionando `@libsql/client` se optarmos pelo Turso).
2. **Criação do Banco de Dados:** Criar a estrutura com a nova tabela de leads.
3. **Módulo de Webhook:** Construir o Fastify Webhook e testar localmente usando `Localtunnel` integrado ao painel do WhatsApp Developer da Meta.
4. **Modelagem de IA & KB:** Escrever as prompts no padrão humanizado e preparar os arquivos JSON simulando a base da escola.
5. **Worker & Handoff:** Desenvolver a fila assíncrona robusta e a notificação com botões interativos no Telegram.

---
> **Dica Extra do Vídeo:** Lembre-se sempre de criar um número de teste exclusivo na Meta (ela fornece um número de telefone de teste gratuito) para não arriscar usar o número oficial da escola durante a fase de homologação!
