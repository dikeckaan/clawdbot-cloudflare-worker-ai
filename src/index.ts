import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { v4 as uuidv4 } from 'uuid'

type Bindings = {
    AI: any
    API_TOKEN?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())

// Middleware for Authentication
app.use('*', async (c, next) => {
    // Skip auth for landing page if desired, or protect everything.
    // Let's protect /v1 routes.
    if (c.req.path.startsWith('/v1')) {
        const authHeader = c.req.header('Authorization')
        const expectedToken = c.env.API_TOKEN

        if (expectedToken) {
            if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== expectedToken) {
                return c.json({ error: { message: 'Invalid API Key', type: 'invalid_request_error', param: null, code: 'invalid_api_key' } }, 401)
            }
        }
    }
    await next()
})

// Default model to use if not specified or if mapping is needed
const DEFAULT_MODEL = '@cf/meta/llama-3-8b-instruct'

app.get('/', (c) => {
    return c.text('Cloudflare Workers AI OpenAI-Compatible API is running! Access restricted.')
})

app.get('/v1/models', (c) => {
    const models = [
        { id: '@cf/meta/llama-3-8b-instruct', name: 'Llama 3 8B Instruct' },
        { id: '@cf/openai/gpt-oss-120b', name: 'GPT OSS 120B' }, // Note: Verify availability in CF AI
        { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B Instruct FP8 Fast' }
    ]

    return c.json({
        object: 'list',
        data: models.map(m => ({
            id: m.id,
            object: 'model',
            created: 1699000000,
            owned_by: 'cloudflare',
        })),
    })
})

app.post('/v1/chat/completions', async (c) => {
    try {
        const body = await c.req.json()
        const messages = body.messages || []
        const model = body.model === 'llama-3-8b-instruct' ? DEFAULT_MODEL : (body.model || DEFAULT_MODEL)
        const stream = body.stream || false

        // Cloudflare Workers AI inputs
        const inputs = {
            messages,
            stream,
        }

        const response = await c.env.AI.run(model, inputs)

        if (stream) {
            const { readable, writable } = new TransformStream()
            const writer = writable.getWriter()
            const encoder = new TextEncoder()
            // @ts-ignore
            const decoder = new TextDecoder()

            // Use Hono's streamSSE helper
            return streamSSE(c, async (stream) => {
                // @ts-ignore
                for await (const chunk of response) {
                    // chunk is usually Uint8Array or string.
                    // For Llama models, it is often a Bytes chunk of the string token.
                    const text = decoder.decode(chunk, { stream: true })

                    const payload = {
                        id: `chatcmpl-${uuidv4()}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: model,
                        choices: [
                            {
                                index: 0,
                                delta: { content: text },
                                finish_reason: null
                            }
                        ]
                    }
                    await stream.writeSSE({
                        data: JSON.stringify(payload)
                    })
                }
                await stream.writeSSE({
                    data: '[DONE]'
                })
            })

        } else {
            // Non-streaming
            // Cloudflare returns { response: "full text" } or similar
            // @ts-ignore
            const result = response as { response: string }

            const payload = {
                id: `chatcmpl-${uuidv4()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [
                    {
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: result.response,
                        },
                        finish_reason: 'stop',
                    },
                ],
                usage: {
                    prompt_tokens: 0, // Not always available
                    completion_tokens: 0,
                    total_tokens: 0
                }
            }
            return c.json(payload)
        }

    } catch (e: any) {
        return c.json({ error: e.message }, 500)
    }
})

export default app
