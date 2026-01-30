import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { HonoEnv } from './types'
import { authMiddleware } from './middleware/auth'
import { openai } from './routes/openai'
import { ollama } from './routes/ollama'

const app = new Hono<HonoEnv>()

// --- Global Middleware ---
app.use('*', cors())
app.use('*', authMiddleware)

// --- Health Check ---
app.get('/', (c) => c.text('Cloudflare AI Worker Active (OpenAI + Ollama Compatible)'))

// --- Mount Routes ---
app.route('/', openai)
app.route('/', ollama)

export default app
