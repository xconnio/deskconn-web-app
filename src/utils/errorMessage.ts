// WebTransportError (thrown by failed WebTransport connects, e.g. on iOS
// Safari) can carry an empty `.message` — `e.message` alone then renders as
// a blank error with no diagnostic value. Fall back to `.name`/`.cause`.
export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    if (e.message) return e.message
    const cause = (e as { cause?: unknown }).cause
    if (cause) return String(cause)
    return e.name
  }
  return String(e)
}
