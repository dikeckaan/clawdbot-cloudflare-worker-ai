export function chatCompletionId(): string {
  return `chatcmpl-${crypto.randomUUID()}`
}

export function unixTimestamp(): number {
  return Math.floor(Date.now() / 1000)
}

export function isoTimestamp(): string {
  return new Date().toISOString()
}
