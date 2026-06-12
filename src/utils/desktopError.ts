import { ApplicationError } from 'xconn'

export const DESKTOP_OFFLINE_MESSAGE = 'Desktop is offline.'

function errorMessage(error: unknown): string {
  if (error instanceof ApplicationError || error instanceof Error) {
    return (error.message || '').toLowerCase()
  }
  return ''
}

export function isNoSuchProcedureException(error: unknown): boolean {
  return errorMessage(error).includes('wamp.error.no_such_procedure')
}

// send() on a RTCDataChannel throws "RTCDataChannel.readyState is not 'open'"
// once the connection has dropped.
export function isDataChannelClosedError(error: unknown): boolean {
  const message = errorMessage(error)
  return message.includes('rtcdatachannel') && message.includes("readystate is not 'open'")
}

export function formatDesktopError(error: unknown, fallback = DESKTOP_OFFLINE_MESSAGE): string {
  if (isNoSuchProcedureException(error) || isDataChannelClosedError(error)) {
    return DESKTOP_OFFLINE_MESSAGE
  }
  if (error instanceof ApplicationError || error instanceof Error) {
    return error.message || fallback
  }
  return fallback
}
