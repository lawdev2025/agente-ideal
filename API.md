# API Documentation

## Overview

Este documento descreve a API do Agente Ideal, um assistente de IA para suporte educacional integrado com WhatsApp e Telegram.

## Architecture

```
┌─────────────────┐
│  WhatsApp API   │
└────────┬────────┘
         │
    ┌────▼────┐
    │ Webhook │
    └────┬────┘
         │
    ┌────▼──────────────┐
    │ Queue (SQLite)    │
    └────┬──────────────┘
         │
    ┌────▼──────────────┐
    │ Message Poller    │
    └────┬──────────────┘
         │
    ┌────▼──────────────────┐
    │ Message Orchestrator   │
    └────┬───────┬──────────┘
         │       │
    ┌────▼──┐ ┌──▼─────────┐
    │ Gemini│ │ KB Tools   │
    │  LLM  │ │            │
    └────┬──┘ └──┬─────────┘
         │       │
    ┌────▼───────▼──────────┐
    │ Response/Escalation    │
    └────┬──────────┬────────┘
         │          │
    ┌────▼─┐   ┌────▼──────┐
    │WhatsApp  │ Telegram   │
    │(Response)│(Escalation)│
    └─────────┘ └───────────┘
```

## Endpoints

### POST /webhook
Recebe mensagens do WhatsApp via Meta Cloud API.

**Headers:**
- `x-hub-signature-256`: HMAC SHA-256 signature
- `Content-Type`: application/json

**Body:**
```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "entry_id",
      "time": 1234567890,
      "messaging": [
        {
          "sender": { "id": "user_id" },
          "recipient": { "id": "bot_id" },
          "timestamp": 1234567890,
          "message": {
            "mid": "message_id",
            "text": "Qual é minha mensalidade?"
          }
        }
      ]
    }
  ]
}
```

**Response:**
```json
{
  "received": true
}
```

**Signature Validation:**
```
hash = HMAC-SHA256(secret, payload)
header_signature = sha256=<hash>
```

### GET /webhook
Verificação de webhook (Meta Cloud API).

**Query Parameters:**
- `mode`: "subscribe"
- `token`: verify_token
- `challenge`: challenge string

**Response:**
Returns challenge string if valid, 403 if invalid.

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```

## KB Tools

Ferramentas disponíveis para o assistente via function calling.

### get_tuition_info
Obtém informações de mensalidade do aluno.

**Parameters:**
```json
{
  "student_id": "STU001"
}
```

**Response:**
```
Mensalidade do aluno STU001: R$ 500.00, vencimento em 25 de maio, status: Pago
```

### get_schedule
Obtém cronograma de aulas e datas importantes.

**Parameters:**
```json
{
  "student_id": "STU001"
}
```

**Response:**
```
Cronograma de STU001:
Segunda: 19:00 - Matemática
Quarta: 19:00 - Português
Sexta: 19:00 - Ciências
Próxima avaliação: 01/06
```

### get_study_materials
Obtém materiais de estudo disponíveis.

**Parameters:**
```json
{
  "student_id": "STU001",
  "subject": "Matemática"
}
```

**Response:**
```
Materiais de Matemática para STU001:
Apostila Cap. 1-3
Exercícios resolvidos
Vídeos
```

### get_contact_info
Obtém informações de contato.

**Parameters:**
```json
{
  "type": "support"
}
```

**Values for type:** `support`, `coordination`, `teacher`

**Response:**
```
Contato support: Email: suporte@plataforma.com | Tel: (11) 3000-0000
```

### escalate_to_specialist
Escala para um especialista.

**Parameters:**
```json
{
  "reason": "billing",
  "student_id": "STU001",
  "message": "Dúvida sobre pagamento"
}
```

**Response:**
```
Sua solicitação foi escalada para Departamento Financeiro. Um especialista entrará em contato com o aluno STU001 em breve.
```

## Message Flow

```
1. WhatsApp envia mensagem → Webhook
2. Webhook valida signature
3. Webhook armazena na queue
4. Poller reclama mensagens
5. Orchestrator processa:
   a. Recupera histórico de conversa
   b. Envia para Gemini LLM com tools
   c. Se LLM chamar tools, executa
   d. Gera resposta final
   e. Envia via WhatsApp ou escala via Telegram
```

## State Management

Todas as mensagens são armazenadas no SQLite para:
- Manter histórico de conversas
- Rastrear interações
- Recuperação de contexto
- Auditoria

## Error Handling

Erros de processamento:
1. Tool execution failure → Escalação automática
2. LLM generation failure → Escalação automática
3. WhatsApp send failure → Retry com exponential backoff
4. Queue processing failure → Release claim para retry

## Configuration

Todas as configurações são carregadas via variáveis de ambiente:

```
# WhatsApp
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_ACCESS_TOKEN=token
WHATSAPP_APP_SECRET=secret
WHATSAPP_VERIFY_TOKEN=verify_token

# Gemini
GEMINI_API_KEY=api_key
GEMINI_MODEL=gemini-2.0-flash

# Telegram (escalação)
TELEGRAM_BOT_TOKEN=bot_token
TELEGRAM_CHAT_ID=chat_id

# Aplicação
PORT=3000
NODE_ENV=production
DB_PATH=./data/agente.db
LOG_LEVEL=info
```

## Security

- **Signature Validation**: HMAC SHA-256 para todas as mensagens do webhook
- **Rate Limiting**: Implementado no nível de queue
- **Token Management**: Armazenado apenas em variáveis de ambiente
- **Data Encryption**: SQLite com dados sensíveis (em produção)

## Performance

- **Queue**: SQLite com atomic claims para processamento distribuído
- **Polling**: Intervalo configurável (default 5s)
- **Caching**: Histórico de conversa em memória para contexto rápido
- **Exponential Backoff**: Retries automáticos com backoff exponencial
