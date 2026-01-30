// --- Cloudflare Worker Bindings ---

export type Bindings = {
  AI: Ai
  API_TOKEN?: string
}

export type HonoEnv = {
  Bindings: Bindings
}

// --- Model Registry ---

export interface ModelEntry {
  alias: string
  cfModelId: string
  displayName: string
  parameterSize: string
  family: string
}

// --- OpenAI Types ---

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[] | null
}

export interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export interface ChatCompletionRequest {
  model?: string
  messages: ChatMessage[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
}

export interface ChatCompletionResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: {
    index: number
    message: { role: 'assistant'; content: string }
    finish_reason: 'stop'
  }[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface ChatCompletionChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: {
    index: number
    delta: { role?: string; content?: string }
    finish_reason: string | null
  }[]
}

export interface EmbeddingsRequest {
  model?: string
  input?: string | string[]
  text?: string | string[]
}

export interface OpenAIModelEntry {
  id: string
  object: 'model'
  created: number
  owned_by: string
}

export interface OpenAIError {
  error: {
    message: string
    type: string
    param: string | null
    code: string
  }
}

// --- Ollama Types ---

export interface OllamaTagEntry {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details: {
    format: string
    family: string
    parameter_size: string
    quantization_level: string
  }
}

export interface OllamaChatRequest {
  model?: string
  messages: ChatMessage[]
  stream?: boolean
}

export interface OllamaChatResponse {
  model: string
  created_at: string
  message: { role: 'assistant'; content: string }
  done: boolean
  total_duration: number
  load_duration: number
  prompt_eval_count: number
  prompt_eval_duration: number
  eval_count: number
  eval_duration: number
}

export interface OllamaChatChunk {
  model: string
  created_at: string
  message: { role: 'assistant'; content: string }
  done: boolean
}

export interface OllamaError {
  error: string
}

// --- CF AI Response Types ---

export interface CfAiChatResponse {
  response: string
}

export interface CfAiEmbeddingResponse {
  shape: number[]
  data: number[] | number[][]
}
