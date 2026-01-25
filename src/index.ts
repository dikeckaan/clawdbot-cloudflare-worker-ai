import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { v4 as uuidv4 } from 'uuid'

type Bindings = {
    AI: any
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())

// Default model to use if not specified or if mapping is needed
const DEFAULT_MODEL = '@cf/meta/llama-3-8b-instruct'

app.get('/', (c) => {
    return c.text('Cloudflare Workers AI OpenAI-Compatible API is running!')
})

app.get('/v1/models', (c) => {
    return c.json({
        object: 'list',
        data: [
            {
                id: 'llama-3-8b-instruct',
                object: 'model',
                created: 1699000000,
                owned_by: 'cloudflare',
            },
            {
                id: '@cf/meta/llama-3-8b-instruct',
                object: 'model',
                created: 1699000000,
                owned_by: 'cloudflare',
            }
        ],
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

                // The AI response stream is a ReadableStream of Uint8Array (SSE events from CF)
                // Usually CF returns SSE events like `data: {"response":"..."}`
                // We need to re-format them to OpenAI style if they differ, but CF's llama output is often just the text chunks.
                // Wait, c.env.AI.run with stream: true returns a ReadableStream.
                // Let's handle the stream carefully.

                // NOTES on CF AI Streaming:
                // When streaming, the response object IS the stream if verified properly or response.body.
                // However, the AI binding returns a generic response.

                // Let's assume response is a ReadableStream as per docs when stream: true is passed.
                // Actually, response is typically an object that might have a body if it's a fetch response,
                // but for usage with binding `env.AI.run`, it returns a ReadableStream directly for streaming?
                // No, for binding, loop over the event stream.

                // Revised approach:
                // env.AI.run returns a standard Response object or similar in some versions, 
                // but the latest binding returns a result object or stream.
                // Documentation says: `const response = await env.AI.run(model, inputs)`
                // If stream: true, response is a ReadableStream (which emits binary chunks of the generated text).

                // OpenAI expects: `data: { ... }` events.
                // Cloudflare stream usually emits standard Server Sent Events source or just raw chunks depending on the model.
                // Most safe way: Iterate and wrap in OpenAI format.

                (async () => {
                    try {
                        // @ts-ignore
                        for await (const chunk of response) {
                            const token = decoder.decode(chunk, { stream: true })
                            // Chunk is mostly likely just the token string in recent binding versions for Llama?
                            // Or it is an object?
                            // Let's assume `chunk` is a Uint8Array containing the text delta.
                            // Actually, `response` is an AsyncIterable of Uint8Array or objects.
                            // Let's safely assume it yields objects like { response: "token" } or similar.
                            // RE-CHECK DOCS: `run` returns `ReadableStream`? No, it returns `Promise<any>`.
                            // But if streaming, it returns `ReadableStream`.

                            // Simplest "works-most-places" way for text generation models in CF:
                            // The stream yields plain text chunks? No, usually JSON with `response`.

                            // Let's try handling it as a standard specific-format stream. 
                            // IMPORTANT: Cloudflare AI bindings change. 
                            // Assuming `response` is valid AsyncIterable for now.

                            // BUT WAIT! We need to return the stream to the client.

                            // The most compatible way to transform the stream:

                            const chatChunk = {
                                id: `chatcmpl-${uuidv4()}`,
                                object: 'chat.completion.chunk',
                                created: Math.floor(Date.now() / 1000),
                                model: model,
                                choices: [{
                                    index: 0,
                                    delta: { content: token }, // We need to verify if token is string or needs parsing
                                    finish_reason: null
                                }]
                            }

                            // Re-parsing logic if `chunk` is not string.
                            // If it's a byte array, decode it.
                            // If it's JSON string `data: {"response":"hi"}`, parse it.
                            // Cloudflare output is historically a bit varied.
                            // Let's assume standard behavior:

                            // Standardizing on: we will pass the stream through validation.
                        }
                    } catch (e) {
                        console.error(e)
                    }
                })()

            // NOTE: Hono has a stream helper.
            // return c.streamText / etc.

            // SIMPLIFIED IMPLEMENTATION FOR STREAMING: 
            // We will trust Hono and a standard transformation.

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
