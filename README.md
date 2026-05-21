# Agente Ideal

Um assistente de IA inteligente para suporte educacional, integrado com WhatsApp e Telegram.

## Features

- **IA Conversacional**: Powered by Google Gemini 2.0 Flash
- **Integração WhatsApp**: Recebe e envia mensagens via Meta Cloud API
- **Escalação Telegram**: Escalação automática para especialistas via Telegram
- **Knowledge Base**: Ferramentas para consultar:
  - Mensalidade e pagamentos
  - Cronograma de aulas
  - Materiais de estudo
  - Contatos e suporte
- **Armazenamento SQLite**: Queue e state management
- **Processamento Assíncrono**: Poller com exponential backoff
- **Logs Estruturados**: Pino com JSON

## Stack Tecnológico

- **Runtime**: Node.js 18+
- **Linguagem**: TypeScript
- **Framework Web**: Fastify
- **LLM**: Google Generative AI (Gemini)
- **Database**: SQLite
- **Queue**: SQLite Queue com atomic claims
- **Testing**: Vitest
- **Logger**: Pino

## Installation

```bash
# Clone o repositório
git clone <repository>
cd agente-ideal

# Install dependencies
npm install

# Setup database
npm run db:init

# Configure environment variables
cp .env.example .env
# Edite .env com suas chaves de API
```

## Configuration

Crie um arquivo `.env` na raiz do projeto:

```bash
# WhatsApp Cloud API
WHATSAPP_PHONE_NUMBER_ID=seu_phone_id
WHATSAPP_ACCESS_TOKEN=seu_access_token
WHATSAPP_APP_SECRET=seu_app_secret
WHATSAPP_VERIFY_TOKEN=seu_verify_token

# Google Gemini
GEMINI_API_KEY=sua_api_key
GEMINI_MODEL=gemini-2.0-flash

# Telegram (para escalação)
TELEGRAM_BOT_TOKEN=seu_bot_token
TELEGRAM_CHAT_ID=seu_chat_id

# Aplicação
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
DB_PATH=./data/agente.db

# Instituição
INSTITUTION_NAME=Seu Colégio
PERSONA_NAME=Ana
ENROLLMENT_PERIOD_END=2026-12-15
```

## Development

```bash
# Start dev server with hot reload
npm run dev

# Run tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run type checking
npm run type-check

# Lint code
npm run lint

# Format code
npm run format

# Build for production
npm run build
```

## API

### Webhook Endpoint

POST `/webhook` - Recebe mensagens do WhatsApp

Headers:
- `x-hub-signature-256`: HMAC signature

### Health Check

GET `/health` - Verifica saúde da aplicação

Para mais detalhes, veja [API.md](./API.md)

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Agente Ideal                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────┐        ┌──────────────┐               │
│  │  Webhook    │        │ Message      │               │
│  │  (Fastify)  │───────▶│  Queue       │               │
│  └─────────────┘        │  (SQLite)    │               │
│                         └──────────────┘               │
│                              │                         │
│                              ▼                         │
│                         ┌──────────────┐               │
│                         │   Poller     │               │
│                         │ (5s interval)│               │
│                         └──────────────┘               │
│                              │                         │
│                              ▼                         │
│                    ┌──────────────────┐               │
│                    │   Orchestrator   │               │
│                    │                  │               │
│                    │ ┌────────────┐   │               │
│                    │ │  Gemini    │   │               │
│                    │ │  LLM       │   │               │
│                    │ └────────────┘   │               │
│                    │ ┌────────────┐   │               │
│                    │ │ KB Tools   │   │               │
│                    │ └────────────┘   │               │
│                    └──────────────────┘               │
│                              │                         │
│                ┌─────────────┴─────────────┐          │
│                ▼                           ▼          │
│           ┌─────────┐              ┌─────────────┐   │
│           │WhatsApp │              │  Telegram   │   │
│           │(Response)              │(Escalation) │   │
│           └─────────┘              └─────────────┘   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## Usage Flow

1. Aluno envia mensagem via WhatsApp
2. Meta Cloud API envia para `/webhook`
3. Webhook valida signature e armazena na queue
4. Poller reclama mensagens a cada 5 segundos
5. Orchestrator processa:
   - Recupera histórico de conversa
   - Envia para Gemini com ferramentas disponíveis
   - Se Gemini chamar tools, executa e obtém resultado
   - Gera resposta final baseada no contexto
6. Resposta é enviada de volta via WhatsApp
7. Se não conseguir resolver, escala via Telegram para especialista

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- llm.test.ts

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

## Deployment

### Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY build ./build
COPY src ./src

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "build/src/index.js"]
```

### Environment Variables (Production)

Ensure the following are set:
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_VERIFY_TOKEN`
- `GEMINI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `NODE_ENV=production`
- `LOG_LEVEL=info`

## Monitoring

### Logs

Todas as operações são logadas via Pino:

```bash
# Development (pretty print)
npm run dev

# Production (JSON format)
npm start
```

### Metrics

- Message processing time
- Tool execution time
- Queue size
- Escalation rate

## Troubleshooting

### Webhook não recebe mensagens

1. Verifique se `WHATSAPP_VERIFY_TOKEN` está correto
2. Verifique se a assinatura HMAC está sendo validada corretamente
3. Confirme que a URL do webhook está acessível publicamente

### Mensagens não são processadas

1. Verifique se o banco de dados SQLite está acessível
2. Confirme se o poller está rodando
3. Verifique os logs para erros

### Escalação não funciona

1. Confirme que `TELEGRAM_BOT_TOKEN` está correto
2. Verifique se o bot está no grupo especificado
3. Confirme que `TELEGRAM_CHAT_ID` é válido

## Contributing

1. Create a feature branch (`git checkout -b feature/AmazingFeature`)
2. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
3. Push to the branch (`git push origin feature/AmazingFeature`)
4. Open a Pull Request

## License

MIT

## Support

Para suporte, abra uma issue no repositório.

## Roadmap

- [ ] Suporte a múltiplos canais (SMS, Messenger, etc)
- [ ] Análise de sentimento
- [ ] Feedback collection
- [ ] Dashboard de analytics
- [ ] Custom training data
- [ ] Suporte a idiomas múltiplos
