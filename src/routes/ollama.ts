import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type {
  HonoEnv,
  OllamaChatRequest,
  CfAiChatResponse,
} from '../types'
import { MODEL_REGISTRY, resolveModel, isResponsesApiModel, getReasoningEffort } from '../models'
import { sanitizeMessages, messagesToResponsesApi, extractResponsesContent } from '../utils/messages'
import { isoTimestamp } from '../utils/ids'
import { ollamaError } from '../utils/errors'
import { parseAiStream, ndjsonLine } from '../utils/streaming'

const ollama = new Hono<HonoEnv>()

// --- GET /api/tags ---
ollama.get('/api/tags', (c) => {
  const now = isoTimestamp()
  return c.json({
    models: MODEL_REGISTRY.map((m) => ({
      name: m.alias,
      model: m.cfModelId,
      modified_at: now,
      size: 0,
      digest: 'sha256:0000',
      details: {
        format: 'gguf',
        family: m.family,
        parameter_size: m.parameterSize,
        quantization_level: 'Q4_0',
      },
    })),
  })
})

// --- POST /api/chat ---
ollama.post('/api/chat', async (c) => {
  try {
    const body = await c.req.json<OllamaChatRequest>()
    const messages = sanitizeMessages(body.messages || [])
    const model = resolveModel(body.model)
    const isStream = body.stream ?? true // Ollama defaults to streaming
    const created_at = isoTimestamp()
    const isResponses = isResponsesApiModel(model)

    const payload = isResponses
      ? messagesToResponsesApi(messages)
      : { messages }

    if (isStream) {
      // Responses API models: fetch non-streaming, emit as NDJSON
      if (isResponses) {
        const reasoningEffort = getReasoningEffort(model)
        const responsesPayload = reasoningEffort
          ? { ...payload, reasoning: { effort: reasoningEffort } }
          : payload
        const response = await c.env.AI.run(
          model as Parameters<typeof c.env.AI.run>[0],
          responsesPayload as Record<string, unknown>
        )
        const result = response as Record<string, unknown>
        const content = extractResponsesContent(result)

        return stream(c, async (s) => {
          await s.write(
            ndjsonLine({
              model,
              created_at,
              message: { role: 'assistant', content },
              done: false,
            })
          )
          await s.write(
            JSON.stringify({
              model,
              created_at,
              done: true,
              total_duration: 0,
              load_duration: 0,
              prompt_eval_count: 0,
              prompt_eval_duration: 0,
              eval_count: 0,
              eval_duration: 0,
            }) + '\n'
          )
        })
      }

      // Standard chat models — real streaming
      const response = await c.env.AI.run(
        model as Parameters<typeof c.env.AI.run>[0],
        { ...payload, stream: true } as Record<string, unknown>
      )

      return stream(c, async (s) => {
        for await (const token of parseAiStream(response as ReadableStream)) {
          await s.write(
            ndjsonLine({
              model,
              created_at,
              message: { role: 'assistant', content: token },
              done: false,
            })
          )
        }

        // Final done message
        await s.write(
          JSON.stringify({
            model,
            created_at,
            done: true,
            total_duration: 0,
            load_duration: 0,
            prompt_eval_count: 0,
            prompt_eval_duration: 0,
            eval_count: 0,
            eval_duration: 0,
          }) + '\n'
        )
      })
    }

    // Non-streaming
    const response = await c.env.AI.run(
      model as Parameters<typeof c.env.AI.run>[0],
      payload as Record<string, unknown>
    )

    const result = response as Record<string, unknown>
    let content: string
    if (isResponses) {
      content = extractResponsesContent(result)
    } else {
      content = (result as unknown as CfAiChatResponse).response
    }

    return c.json({
      model,
      created_at,
      message: { role: 'assistant', content },
      done: true,
      total_duration: 0,
      load_duration: 0,
      prompt_eval_count: 0,
      prompt_eval_duration: 0,
      eval_count: 0,
      eval_duration: 0,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return c.json(ollamaError(msg), 500)
  }
})

export { ollama }
