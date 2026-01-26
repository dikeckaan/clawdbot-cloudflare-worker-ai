import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE, stream } from 'hono/streaming'
import { v4 as uuidv4 } from 'uuid'

// --- Types ---
type Bindings = {
    AI: any
    API_TOKEN?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// --- Middleware ---
app.use('*', cors())

app.use('*', async (c, next) => {
    // Auth Check for API routes
    if (c.req.path.startsWith('/v1') || c.req.path.startsWith('/api')) {
        const authHeader = c.req.header('Authorization')
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
                return c.json({
                    error: {
                        message: 'Invalid API Key',
                        type: 'invalid_request_error',
                        param: null,
                        code: 'invalid_api_key'
                    }
                }, 401)
            }
        }
    }
    await next()
})

// --- Constants ---
const DEFAULT_MODEL = '@cf/meta/llama-3-8b-instruct'

// --- Helpers ---
// Flattens array content (like from Clawd) to a single string for CF AI
function sanitizeMessages(messages: any[]) {
    return messages.map((msg: any) => {
        if (Array.isArray(msg.content)) {
            const textContent = msg.content
                .filter((part: any) => part.type === 'text')
                .map((part: any) => part.text)
                .join('\n')
            return { ...msg, content: textContent }
        }
        return msg
    })
}

// Maps short model names to CF IDs
function resolveModel(inputModel: string | undefined): string {
    if (!inputModel) return DEFAULT_MODEL
    if (inputModel.startsWith('@cf/')) return inputModel // Pass ID through

    if (inputModel.includes('gpt-oss')) return '@cf/openai/gpt-oss-120b'
    if (inputModel.includes('70b')) return '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
    if (inputModel.includes('llama')) return '@cf/meta/llama-3-8b-instruct'

    return DEFAULT_MODEL
}

// --- Routes ---

app.get('/', (c) => c.text('Cloudflare AI Worker Active'))

// 1. OpenAI Compatible Endpoints

app.get('/v1/models', (c) => {
    const models = [
        { id: '@cf/meta/llama-3-8b-instruct', name: 'Llama 3 8B' },
        { id: '@cf/openai/gpt-oss-120b', name: 'GPT OSS 120B' },
        { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B' },
        { id: 'llama-3-8b-instruct', name: 'Llama 3 (Alias)' }
    ]
    return c.json({
        object: 'list',
        data: models.map(m => ({
            id: m.id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'cloudflare',
        }))
    })
})

app.post('/v1/chat/completions', async (c) => {
    try {
        const body = await c.req.json()
        const messages = sanitizeMessages(body.messages || [])
        const model = resolveModel(body.model)
        const isStream = body.stream || false

        const response = await c.env.AI.run(model, { messages, stream: isStream })
        const created = Math.floor(Date.now() / 1000)
        const id = `chatcmpl-${uuidv4()}`

        if (isStream) {
            // @ts-ignore
            const decoder = new TextDecoder()
            return streamSSE(c, async (stream) => {
                // @ts-ignore
                for await (const chunk of response) {
                    const text = decoder.decode(chunk, { stream: true })
                    // Standard chunk
                    await stream.writeSSE({
                        data: JSON.stringify({
                            id,
                            object: 'chat.completion.chunk',
                            created,
                            model,
                            choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
                        })
                    })
                }
                // Final stop chunk
                await stream.writeSSE({
                    data: JSON.stringify({
                        id,
                        object: 'chat.completion.chunk',
                        created,
                        model,
                        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
                    })
                })
                // DONE marker
                await stream.writeSSE({ data: '[DONE]' })
            })
        } else {
            // @ts-ignore
            const result = response as { response: string }
            return c.json({
                id,
                object: 'chat.completion',
                created,
                model,
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: result.response },
                    finish_reason: 'stop'
                }],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
            })
        }
    } catch (e: any) {
        return c.json({ error: e.message }, 500)
    }
})

// 2. Ollama Compatible Endpoints

app.get('/api/tags', (c) => {
    // Simplified Ollama tags response
    const models = [
        { name: 'llama-3-8b-instruct', model: '@cf/meta/llama-3-8b-instruct' },
        { name: 'gpt-oss-120b', model: '@cf/openai/gpt-oss-120b' },
        { name: 'llama-3.3-70b-instruct-fp8-fast', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }
    ]
    return c.json({
        models: models.map(m => ({
            name: m.name,
            model: m.model,
            modified_at: new Date().toISOString(),
            size: 0,
            digest: 'sha256:0000',
            details: { format: 'gguf', family: 'llama', parameter_size: '8B', quantization_level: 'Q4_0' }
        }))
    })
})

app.post('/api/chat', async (c) => {
    try {
        const body = await c.req.json()
        const messages = sanitizeMessages(body.messages || [])
        const model = resolveModel(body.model)
        const isStream = body.stream ?? true // Ollama defaults to true

        const response = await c.env.AI.run(model, { messages, stream: isStream })
        const created_at = new Date().toISOString()

        if (isStream) {
            // @ts-ignore
            const decoder = new TextDecoder()
            // @ts-ignore
            return stream(c, async (stream) => {
                // @ts-ignore
                for await (const chunk of response) {
                    const text = decoder.decode(chunk, { stream: true })
                    const payload = {
                        model,
                        created_at,
                        message: { role: 'assistant', content: text },
                        done: false
                    }
                    await stream.write(JSON.stringify(payload) + '\n')
                }
                const final = {
                    model,
                    created_at,
                    done: true,
                    total_duration: 0,
                    load_duration: 0,
                    prompt_eval_count: 0,
                    prompt_eval_duration: 0,
                    eval_count: 0,
                    eval_duration: 0
                }
                await stream.write(JSON.stringify(final) + '\n')
            })
        } else {
            // @ts-ignore
            const result = response as { response: string }
            return c.json({
                model,
                created_at,
                message: { role: 'assistant', content: result.response },
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

export default app
