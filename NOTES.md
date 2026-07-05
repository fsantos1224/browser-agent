# BrowseAgent — Decisões e Aprendizados

## Questão respondida

Como construir um browser interaction agent (similar ao `/interact` da Firecrawl) usando Playwright + TypeScript + AI, com sessões, navegação por prompt e loop de agente?

## Decisões validadas

### Arquitetura
- **Agent loop com tool calling**: o LLM decide o próximo passo via function calling, não por parsing de texto livre. Mais confiável e fácil de debugar.
- **Sessões com browser pool**: reutilizar browsers entre sessões (pool de 3) reduz latência em ~1.5s por sessão (tempo de launch do Chromium).
- **In-memory store**: suficiente para o protótipo. Para produção, um store externo (Redis) seria necessário para multi-instância.

### Stack
| Camada | Escolha | Por quê |
|---|---|---|
| Browser | Playwright | API consistente, suporte nativo a async/await, accessibility snapshots |
| AI | OpenAI GPT (function calling) | Tool use nativo, mais maduro que alternativas |
| API | Fastify | Tipado, rápido, schema validation embutido |
| Runtime | tsx | TypeScript sem build step, ideal para protótipo |

### Loop do agente
1. LLM recebe prompt + ferramentas disponíveis
2. LLM decide ação via function calling
3. Playwright executa
4. Screenshot é tirado e enviado como contexto visual
5. Resultado volta pro LLM
6. Repete até LLM chamar `done`

Esse loop com feedback visual (screenshot) é essencial para o LLM entender o estado atual da página.

### Tratamento de erros
- Retry com exponential backoff (1s, 2s) em ações que falham
- Cada ação tem timeout de 5s
- Sessões inativas por 5min são limpas automaticamente

## Próximos passos (se fosse para produção)
- [ ] Usar accessibility tree em vez de screenshot para contexto mais estruturado
- [ ] Rate limiting por sessão
- [ ] Multi-instância com Redis para sessões
- [ ] Streaming de steps via SSE
- [ ] Suporte a autenticação (cookies, localStorage persistence)
- [ ] Cache de respostas do LLM para prompts similares
- [ ] Dockerfile para deploy

## Comandos

```bash
# Scripts Playwright avulsos
npm run login
npm run extract
npm run scroll
npm run popups

# Terminal prototype (CLI interativo)
npm run cli

# API server
npm run dev

# Chamar o agente AI
curl -X POST http://localhost:3456/sessions \
  -H "Content-Type: application/json"
# Pegar sessionId da resposta e usar:
curl -X POST http://localhost:3456/sessions/{id}/agent \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Go to google.com and search for Playwright"}'
```
