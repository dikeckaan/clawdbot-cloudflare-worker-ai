# clawdbot-cf-ai

Cloudflare Worker AI proxy with OpenAI and Ollama compatible API endpoints.

## Features

- **OpenAI compatible** — `/v1/models`, `/v1/chat/completions`, `/v1/embeddings`
- **Ollama compatible** — `/api/tags`, `/api/chat`
- **Streaming** — SSE (OpenAI) and NDJSON (Ollama)
- **Bearer token auth** — via `Authorization` header or `?token=` / `?key=` query param
- **Zero runtime deps** besides Hono — no `@cloudflare/ai`, no `uuid`
- **Type-safe** — strict TypeScript, no `@ts-ignore`

## Supported Models

| Alias | Cloudflare Model ID |
|-------|-------------------|
| `llama-3.3-70b` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| `llama-3.1-8b` | `@cf/meta/llama-3.1-8b-instruct-fp8` |
| `llama-3-8b` | `@cf/meta/llama-3-8b-instruct` |
| `llama-4-scout` | `@cf/meta/llama-4-scout-17b-16e-instruct` |
| `deepseek-r1` | `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` |
| `qwen2.5-coder` | `@cf/qwen/qwen2.5-coder-32b-instruct` |
| `qwq-32b` | `@cf/qwen/qwq-32b` |
| `mistral-7b` | `@cf/mistral/mistral-7b-instruct-v0.1` |
| `phi-2` | `@cf/microsoft/phi-2` |
| `gpt-oss-120b` | `@cf/openai/gpt-oss-120b` |

Any `@cf/*` model ID is also passed through directly. Default model is `llama-3.1-8b`.

## Setup

```bash
npm install
```

Set the `API_TOKEN` secret (optional — if not set, auth is disabled):

```bash
npx wrangler secret put API_TOKEN
```

## Development

```bash
npm run dev
```

## Deploy

```bash
npm run deploy
```

## API Usage

### Health check

```bash
curl https://your-worker.workers.dev/
```

### List models (OpenAI)

```bash
curl https://your-worker.workers.dev/v1/models \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Chat completion

```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.1-8b",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Streaming chat

```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.1-8b",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### Ollama chat

```bash
curl -X POST https://your-worker.workers.dev/api/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.1-8b",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Embeddings

```bash
curl -X POST https://your-worker.workers.dev/v1/embeddings \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/baai/bge-large-en-v1.5",
    "input": "Hello world"
  }'
```

## Project Structure

```
src/
  index.ts              Entry point — Hono app, middleware, route mounting
  types.ts              TypeScript interfaces and types
  models.ts             Model registry, alias map, resolver functions
  middleware/
    auth.ts             Bearer token / query param authentication
  routes/
    openai.ts           /v1/models, /v1/chat/completions, /v1/embeddings
    ollama.ts           /api/tags, /api/chat
  utils/
    streaming.ts        SSE and NDJSON streaming helpers
    messages.ts         Message sanitization (array content -> string)
    errors.ts           Error formatting (OpenAI + Ollama formats)
    ids.ts              ID and timestamp generation
```

## Configuration

`wrangler.toml`:

```toml
name = "clawdbot-cf-ai"
main = "src/index.ts"

[ai]
binding = "AI"
```

Environment variables / secrets:

| Name | Required | Description |
|------|----------|-------------|
| `API_TOKEN` | No | Bearer token for authentication. If not set, all requests are allowed. |
