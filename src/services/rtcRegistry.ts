// Tracks which WampSession instances are backed by a live WebRTC P2P
// RTCPeerConnection, as opposed to a cloud-relay-only connection. Kept as a
// side table (rather than a property on Session) so the WAMP transport stays
// transport-agnostic; only components that specifically need P2P (e.g. raw
// data channel file streaming) need to consult it.
import type { WebRTCSession } from 'xconn-webrtc-js'

import type { WampSession } from './wamp'

const registry = new WeakMap<object, WebRTCSession>()

export function registerWebRTCSession(session: WampSession, webrtc: WebRTCSession): void {
  registry.set(session as object, webrtc)
}

export function getWebRTCSession(session: WampSession | null | undefined): WebRTCSession | null {
  if (!session) return null
  const webrtc = registry.get(session as object)
  if (!webrtc || webrtc.connection.connectionState !== 'connected') return null
  return webrtc
}
