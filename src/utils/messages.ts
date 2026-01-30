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
