import type { ChatCompletionChunk, OllamaChatChunk } from '../types'

/**
 * Parses the CF AI streaming response.
 * CF AI can return either:
 *  - A ReadableStream of raw bytes
 *  - An SSE-formatted text stream (data: ... lines)
 *
 * This generator yields plain text tokens.
 */
export async function* parseAiStream(
  response: ReadableStream | AsyncIterable<Uint8Array>
): AsyncGenerator<string> {
  const reader =
    response instanceof ReadableStream
      ? response.getReader()
      : null

  const decoder = new TextDecoder()
  let buffer = ''

  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Try to extract tokens from buffer
      const tokens = extractTokens(buffer)
      buffer = tokens.remaining
      for (const token of tokens.values) {
        yield token
      }
    }
    // Flush remaining buffer
    if (buffer.trim()) {
      const tokens = extractTokens(buffer + '\n')
      for (const token of tokens.values) {
        yield token
      }
    }
  } else {
    // AsyncIterable path
    for await (const chunk of response as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true })
      const tokens = extractTokens(buffer)
      buffer = tokens.remaining
      for (const token of tokens.values) {
        yield token
      }
    }
    if (buffer.trim()) {
      const tokens = extractTokens(buffer + '\n')
      for (const token of tokens.values) {
        yield token
      }
    }
  }
}

interface ExtractResult {
  values: string[]
  remaining: string
}

/**
 * Extracts text tokens from a buffer that may contain:
 * - SSE format: "data: {json}\n\n" lines
 * - Raw text
 */
function extractTokens(buffer: string): ExtractResult {
  const values: string[] = []

  // Check if this looks like SSE format
  if (buffer.includes('data: ')) {
    const lines = buffer.split('\n')
    let remaining = ''

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          if (parsed.response !== undefined) {
            values.push(parsed.response)
          }
        } catch {
          // Incomplete JSON, keep as remaining
          remaining = lines.slice(i).join('\n')
          return { values, remaining }
        }
      }
    }

    return { values, remaining: '' }
  }

  // Raw text: just return the buffer content directly
  // But only if we have a complete segment (ends with something)
  if (buffer.length > 0) {
    values.push(buffer)
    return { values, remaining: '' }
  }

  return { values: [], remaining: buffer }
}

// --- SSE helpers (OpenAI format) ---

export function sseChunkPayload(chunk: ChatCompletionChunk): string {
  return JSON.stringify(chunk)
}

// --- NDJSON helpers (Ollama format) ---

export function ndjsonLine(chunk: OllamaChatChunk): string {
  return JSON.stringify(chunk) + '\n'
}
