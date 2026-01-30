import type { ChatMessage } from '../types'

/**
 * Flattens array content (e.g. from multi-modal clients) into a plain string.
 * CF AI only accepts string content in messages.
 */
export function sanitizeMessages(
  messages: ChatMessage[]
): { role: string; content: string }[] {
  return messages
    .map((msg) => {
      if (Array.isArray(msg.content)) {
        const text = msg.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text ?? '')
          .join('\n')
        return { role: msg.role, content: text }
      }
      return { role: msg.role, content: msg.content ?? '' }
    })
    .filter((msg) => msg.content.length > 0)
}

/**
 * Converts chat messages to the Responses API format used by gpt-oss-120b.
 * Extracts system message as `instructions`, concatenates user/assistant
 * messages into the `input` array.
 */
export function messagesToResponsesApi(
  messages: { role: string; content: string }[]
): { input: Array<{ role: string; content: string }>; instructions?: string } {
  let instructions: string | undefined
  const input: Array<{ role: string; content: string }> = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Combine multiple system messages
      instructions = instructions
        ? instructions + '\n' + msg.content
        : msg.content
    } else {
      input.push({ role: msg.role, content: msg.content })
    }
  }

  // If there's only one user message and no other context, send as plain string
  const result: { input: Array<{ role: string; content: string }>; instructions?: string } = { input }
  if (instructions) {
    result.instructions = instructions
  }
  return result
}

/**
 * Extract text content from Responses API result (gpt-oss-120b).
 * Only returns the message content, reasoning is ignored.
 */
export function extractResponsesContent(result: Record<string, unknown>): string {
  // Try common response shapes from CF Workers AI Responses API
  if (typeof result.response === 'string') return result.response
  if (typeof result.output_text === 'string') return result.output_text

  // output array format from Responses API - only extract message, ignore reasoning
  if (Array.isArray(result.output)) {
    const messageTexts: string[] = []

    for (const item of result.output) {
      const obj = item as Record<string, unknown>

      // Extract message content only (ignore reasoning)
      if (obj.type === 'message' && Array.isArray(obj.content)) {
        for (const c of obj.content as Record<string, unknown>[]) {
          if (c.type === 'output_text' && typeof c.text === 'string') {
            messageTexts.push(c.text)
          }
          // Also check for text directly in content
          if (c.type === 'text' && typeof c.text === 'string') {
            messageTexts.push(c.text)
          }
        }
      }
    }

    if (messageTexts.length > 0) return messageTexts.join('')
  }

  // Check for output_messages array (another Responses API format)
  if (Array.isArray(result.output_messages)) {
    const texts: string[] = []
    for (const msg of result.output_messages as Record<string, unknown>[]) {
      if (msg.role === 'assistant' && typeof msg.content === 'string') {
        texts.push(msg.content)
      }
    }
    if (texts.length > 0) return texts.join('')
  }

  // Fallback: stringify whatever we got
  return JSON.stringify(result)
}
