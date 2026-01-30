import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type {
  HonoEnv,
  ChatCompletionRequest,
  ChatCompletionChunk,
  CfAiChatResponse,
  CfAiEmbeddingResponse,
  EmbeddingsRequest,
} from '../types'
import { MODEL_REGISTRY, resolveModel, resolveEmbeddingModel, isResponsesApiModel } from '../models'
import { sanitizeMessages, messagesToResponsesApi } from '../utils/messages'
import { chatCompletionId, unixTimestamp } from '../utils/ids'
import { openAIError } from '../utils/errors'
import { parseAiStream, sseChunkPayload } from '../utils/streaming'

const openai = new Hono<HonoEnv>()

// --- GET /v1/models ---
openai.get('/v1/models', (c) => {
  const created = unixTimestamp()
  return c.json({
    object: 'list',
    data: MODEL_REGISTRY.map((m) => ({
      id: m.alias,
      object: 'model' as const,
      created,
      owned_by: 'cloudflare',
    })),
  })
})

// --- POST /v1/chat/completions ---
openai.post('/v1/chat/completions', async (c) => {
  try {
    const body = await c.req.json<ChatCompletionRequest>()
    const messages = sanitizeMessages(body.messages || [])
    const model = resolveModel(body.model)
    const isStream = body.stream ?? false
    const id = chatCompletionId()
    const created = unixTimestamp()
    const isResponses = isResponsesApiModel(model)

    // Build the payload based on model type
    const payload = isResponses
      ? messagesToResponsesApi(messages)
      : { messages }

    if (isStream) {
      // Responses API models don't support CF AI streaming — fetch non-streaming then emit as SSE
      if (isResponses) {
        const response = await c.env.AI.run(
          model as Parameters<typeof c.env.AI.run>[0],
          payload as Record<string, unknown>
        )
        const result = response as Record<string, unknown>
        const content = extractResponsesContent(result)

        return streamSSE(c, async (stream) => {
          const chunk: ChatCompletionChunk = {
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              { index: 0, delta: { content }, finish_reason: null },
            ],
          }
          await stream.writeSSE({ data: sseChunkPayload(chunk) })
          const stopChunk: ChatCompletionChunk = {
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          }
          await stream.writeSSE({ data: sseChunkPayload(stopChunk) })
          await stream.writeSSE({ data: '[DONE]' })
        })
      }

      // Standard chat models — real streaming
      const response = await c.env.AI.run(
        model as Parameters<typeof c.env.AI.run>[0],
        { ...payload, stream: true } as Record<string, unknown>
      )

      return streamSSE(c, async (stream) => {
        for await (const token of parseAiStream(response as ReadableStream)) {
          const chunk: ChatCompletionChunk = {
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              { index: 0, delta: { content: token }, finish_reason: null },
            ],
          }
          await stream.writeSSE({ data: sseChunkPayload(chunk) })
        }

        // Final stop chunk
        const stopChunk: ChatCompletionChunk = {
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }
        await stream.writeSSE({ data: sseChunkPayload(stopChunk) })
        await stream.writeSSE({ data: '[DONE]' })
      })
    }

    // Non-streaming
    const response = await c.env.AI.run(
      model as Parameters<typeof c.env.AI.run>[0],
      payload as Record<string, unknown>
    )

    // Responses API returns { output_text } or object with output, Chat API returns { response }
    const result = response as Record<string, unknown>
    const content = isResponses
      ? extractResponsesContent(result)
      : (result as unknown as CfAiChatResponse).response

    return c.json({
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: content ?? '' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return c.json(openAIError(msg), 500)
  }
})

/** Extract text content from Responses API result (gpt-oss-120b) */
function extractResponsesContent(result: Record<string, unknown>): string {
  // Try common response shapes from CF Workers AI Responses API
  if (typeof result.response === 'string') return result.response
  if (typeof result.output_text === 'string') return result.output_text

  // output array format: { output: [{ type: "message", content: [{ type: "output_text", text }] }] }
  if (Array.isArray(result.output)) {
    const texts: string[] = []
    for (const item of result.output) {
      const obj = item as Record<string, unknown>
      if (obj.type === 'message' && Array.isArray(obj.content)) {
        for (const c of obj.content as Record<string, unknown>[]) {
          if (c.type === 'output_text' && typeof c.text === 'string') {
            texts.push(c.text)
          }
        }
      }
    }
    if (texts.length > 0) return texts.join('')
  }

  // Fallback: stringify whatever we got
  return JSON.stringify(result)
}

// --- POST /v1/embeddings ---
openai.post('/v1/embeddings', async (c) => {
  try {
    const body = await c.req.json<EmbeddingsRequest>()
    const inputRaw = body.input ?? body.text
    const model = resolveEmbeddingModel(body.model)

    let text: string | string[]
    if (Array.isArray(inputRaw)) {
      text = inputRaw.map((i) => String(i))
    } else {
      text = String(inputRaw ?? '')
    }

    const response = (await c.env.AI.run(
      model as Parameters<typeof c.env.AI.run>[0],
      { text }
    )) as CfAiEmbeddingResponse

    const embeddingData = response.data ?? []
    let embeddings: number[][]
    if (Array.isArray(embeddingData) && typeof embeddingData[0] === 'number') {
      embeddings = [embeddingData as number[]]
    } else {
      embeddings = embeddingData as number[][]
    }

    return c.json({
      object: 'list',
      data: embeddings.map((emb, idx) => ({
        object: 'embedding',
        embedding: emb,
        index: idx,
      })),
      model,
      usage: { prompt_tokens: 0, total_tokens: 0 },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return c.json(openAIError(msg), 500)
  }
})

export { openai }
