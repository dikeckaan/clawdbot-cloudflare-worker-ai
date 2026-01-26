import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE, stream as honoStream } from 'hono/streaming'
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
    // Let's protect /v1 and /api routes.
    if (c.req.path.startsWith('/v1') || c.req.path.startsWith('/api')) {
        const authHeader = c.req.header('Authorization')
        // Allow passing token via query param for easier usage (e.g. in URL)
        const queryToken = c.req.query('token') || c.req.query('key')
        const expectedToken = c.env.API_TOKEN

        if (expectedToken) {
            let receivedToken = ''
            if (authHeader && authHeader.startsWith('Bearer ')) {
                receivedToken = authHeader.split(' ')[1]
            } else if (queryToken) {
                receivedToken = queryToken
            }

            if (receivedToken !== expectedToken) {
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

// Ollama Compatibility Endpoints

app.get('/api/tags', (c) => {
    const models = [
        { name: 'llama-3-8b-instruct', model: '@cf/meta/llama-3-8b-instruct' },
        { name: 'gpt-oss-120b', model: '@cf/openai/gpt-oss-120b' },
        { name: 'llama-3.3-70b-instruct-fp8-fast', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }
    ]

    return c.json({
        models: models.map(m => ({
            name: m.name,
            model: m.name,
            modified_at: new Date().toISOString(),
            size: 0,
            digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
            details: {
                parent_model: '',
                format: 'gguf',
                family: 'llama',
                families: ['llama'],
                parameter_size: '8B',
                quantization_level: 'Q4_0'
            }
        }))
    })
})

app.post('/api/chat', async (c) => {
    try {
        const body = await c.req.json()
        let messages = body.messages || []
        // Ollama uses model names like 'llama3', we need to map or use raw
        // Simple mapping based on our known list, or fallback to default
        let model = DEFAULT_MODEL
        if (body.model) {
            if (body.model.includes('gpt-oss')) model = '@cf/openai/gpt-oss-120b'
            else if (body.model.includes('70b')) model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
            else if (body.model.includes('llama')) model = '@cf/meta/llama-3-8b-instruct'
            // Allow direct CF ID passing if user knows it
            if (body.model.startsWith('@cf/')) model = body.model
        }

        const stream = body.stream ?? true // Ollama defaults to true

        // Sanitize messages (same as v1 cleanup)
        messages = messages.map((msg: any) => {
            if (Array.isArray(msg.content)) {
                const textContent = msg.content
                    .filter((part: any) => part.type === 'text')
                    .map((part: any) => part.text)
                    .join('\n')
                return { ...msg, content: textContent }
            }
            return msg
        })

        const inputs = {
            messages,
            stream,
        }

        const response = await c.env.AI.run(model, inputs)

        if (stream) {
            // Ollama uses NDJSON (Newline Delimited JSON)
            // @ts-ignore
            const decoder = new TextDecoder()


            // Redoing streaming for Ollama (NDJSON) using Hono's stream helper
            return honoStream(c, async (stream) => {
                // @ts-ignore
                for await (const chunk of response) {
                    const text = decoder.decode(chunk, { stream: true })
                    const payload = {
                        model: body.model || 'unknown',
                        created_at: new Date().toISOString(),
                        message: { role: 'assistant', content: text },
                        done: false
                    }
                    await stream.write(JSON.stringify(payload) + '\n')
                }
                const finalPayload = {
                    model: body.model || 'unknown',
                    created_at: new Date().toISOString(),
                    done: true,
                    total_duration: 0,
                    load_duration: 0,
                    prompt_eval_count: 0,
                    prompt_eval_duration: 0,
                    eval_count: 0,
                    eval_duration: 0
                }
                await stream.write(JSON.stringify(finalPayload) + '\n')
            })

        } else {
            // Non-streaming
            // @ts-ignore
            const result = response as { response: string }
            return c.json({
                model: body.model || 'unknown',
                created_at: new Date().toISOString(),
                message: {
                    role: 'assistant',
                    content: result.response
                },
                done: true,
                total_duration: 0,
                load_duration: 0,
                prompt_eval_count: 0,
                prompt_eval_duration: 0,
                eval_count: 0,
                eval_duration: 0
            })
        }

    } catch (e: any) {
        return c.json({ error: e.message }, 500)
    }
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
        let messages = body.messages || []
        const model = body.model === 'llama-3-8b-instruct' ? DEFAULT_MODEL : (body.model || DEFAULT_MODEL)
        const stream = body.stream || false

        // Sanitize messages: Cloudflare AI models (Llama etc) typically expect content to be a string, 
        // but OpenAI clients (like Clawd) might send an array of content parts (e.g. for vision).
        // We need to flatten it to a single string.
        messages = messages.map((msg: any) => {
            if (Array.isArray(msg.content)) {
                // Extract text parts and join them
                const textContent = msg.content
                    .filter((part: any) => part.type === 'text')
                    .map((part: any) => part.text)
                    .join('\n')
                return { ...msg, content: textContent }
            }
            return msg
        })

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
                    const text = decoder.decode(chunk, { stream: true })

                    // console.log('Chunk:', text) // Uncomment to debug via `npx wrangler tail`

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
                // Send final "DONE" message with finish_reason: stop
                const finalPayload = {
                    id: `chatcmpl-${uuidv4()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    choices: [
                        {
                            index: 0,
                            delta: {},
                            finish_reason: 'stop'
                        }
                    ]
                }
                await stream.writeSSE({
                    data: JSON.stringify(finalPayload)
                })

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
