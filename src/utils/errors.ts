import type { OpenAIError, OllamaError } from '../types'

export function openAIError(
  message: string,
  type = 'internal_error',
  code = 'internal_error',
  param: string | null = null
): OpenAIError {
  return {
    error: { message, type, param, code },
  }
}

export function ollamaError(message: string): OllamaError {
  return { error: message }
}
