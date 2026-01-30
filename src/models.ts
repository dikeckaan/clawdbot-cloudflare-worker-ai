import type { ModelEntry } from './types'

export const MODEL_REGISTRY: ModelEntry[] = [
  {
    alias: 'llama-3.3-70b',
    cfModelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    displayName: 'Llama 3.3 70B Instruct',
    parameterSize: '70B',
    family: 'llama',
  },
  {
    alias: 'llama-3.1-8b',
    cfModelId: '@cf/meta/llama-3.1-8b-instruct-fp8',
    displayName: 'Llama 3.1 8B Instruct',
    parameterSize: '8B',
    family: 'llama',
  },
  {
    alias: 'llama-3-8b',
    cfModelId: '@cf/meta/llama-3-8b-instruct',
    displayName: 'Llama 3 8B Instruct',
    parameterSize: '8B',
    family: 'llama',
  },
  {
    alias: 'llama-4-scout',
    cfModelId: '@cf/meta/llama-4-scout-17b-16e-instruct',
    displayName: 'Llama 4 Scout 17B',
    parameterSize: '17B',
    family: 'llama',
  },
  {
    alias: 'deepseek-r1',
    cfModelId: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    displayName: 'DeepSeek R1 Distill Qwen 32B',
    parameterSize: '32B',
    family: 'qwen',
  },
  {
    alias: 'qwen2.5-coder',
    cfModelId: '@cf/qwen/qwen2.5-coder-32b-instruct',
    displayName: 'Qwen 2.5 Coder 32B',
    parameterSize: '32B',
    family: 'qwen',
  },
  {
    alias: 'qwq-32b',
    cfModelId: '@cf/qwen/qwq-32b',
    displayName: 'QwQ 32B',
    parameterSize: '32B',
    family: 'qwen',
  },
  {
    alias: 'mistral-7b',
    cfModelId: '@cf/mistral/mistral-7b-instruct-v0.1',
    displayName: 'Mistral 7B Instruct',
    parameterSize: '7B',
    family: 'mistral',
  },
  {
    alias: 'phi-2',
    cfModelId: '@cf/microsoft/phi-2',
    displayName: 'Phi-2',
    parameterSize: '2.7B',
    family: 'phi',
  },
  {
    alias: 'gpt-oss-120b',
    cfModelId: '@cf/openai/gpt-oss-120b',
    displayName: 'GPT OSS 120B',
    parameterSize: '120B',
    family: 'gpt',
    useResponsesApi: true,
  },
]

/**
 * Models that use the Responses API ({ input }) instead of Chat API ({ messages }).
 */
const responsesApiModels = new Set(
  MODEL_REGISTRY.filter((m) => m.useResponsesApi).map((m) => m.cfModelId)
)

export function isResponsesApiModel(cfModelId: string): boolean {
  return responsesApiModels.has(cfModelId)
}

const DEFAULT_CF_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8'
const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-large-en-v1.5'

/** Build a lookup map from alias -> cfModelId */
const aliasMap = new Map<string, string>(
  MODEL_REGISTRY.map((m) => [m.alias, m.cfModelId])
)

/**
 * Resolves a user-supplied model name to a Cloudflare model ID.
 * Supports: exact alias, @cf/ passthrough, or falls back to default.
 */
export function resolveModel(input: string | undefined): string {
  if (!input) return DEFAULT_CF_MODEL
  if (input.startsWith('@cf/')) return input

  const exact = aliasMap.get(input)
  if (exact) return exact

  // Partial match: check if any alias is contained in the input
  for (const [alias, cfId] of aliasMap) {
    if (input.includes(alias)) return cfId
  }

  return DEFAULT_CF_MODEL
}

/**
 * Resolves an embedding model name. Falls back to default embedding model.
 */
export function resolveEmbeddingModel(input: string | undefined): string {
  if (!input) return DEFAULT_EMBEDDING_MODEL
  if (input.startsWith('@cf/')) return input
  return DEFAULT_EMBEDDING_MODEL
}
