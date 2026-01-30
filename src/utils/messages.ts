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
