import { ApplicationError } from 'xconn'

export const DESKTOP_OFFLINE_MESSAGE = 'Desktop is offline.'

function errorUri(error: unknown): string {
  if (error instanceof ApplicationError || error instanceof Error) {
    return (error.message || '').toLowerCase()
  }
  return ''
}

function errorText(error: unknown): string {
  if (error instanceof ApplicationError) {
    const arg = error.args?.[0]
    if (typeof arg === 'string' && arg) return arg
  }
  if (error instanceof ApplicationError || error instanceof Error) {
    return error.message || ''
  }
  return ''
}

export function isNoSuchProcedureException(error: unknown): boolean {
  return errorUri(error).includes('wamp.error.no_such_procedure')
}

// send() on a RTCDataChannel throws "RTCDataChannel.readyState is not 'open'"
// once the connection has dropped.
export function isDataChannelClosedError(error: unknown): boolean {
  const message = errorUri(error)
  return message.includes('rtcdatachannel') && message.includes("readystate is not 'open'")
}

// errEditConflict — file changed on disk since it was read.
export function isEditConflictError(error: unknown): boolean {
  return errorText(error).toLowerCase().includes('could not be applied cleanly')
}

export function formatDesktopError(error: unknown, fallback = DESKTOP_OFFLINE_MESSAGE): string {
  if (isNoSuchProcedureException(error) || isDataChannelClosedError(error)) {
    return DESKTOP_OFFLINE_MESSAGE
  }
  return errorText(error) || fallback
}
