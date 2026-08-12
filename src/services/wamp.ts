import {
  connectWebTransportAnonymous,
  connectWebTransportCRA,
  connectWebTransportCryptosign,
  type WebTransportCertHash,
  type Session,
} from 'xconn'
import { connectWAMP, ClientConfig, type WebRTCSession } from 'xconn-webrtc-js'

import { WAMP_WT_URL, WAMP_WT_CERT_URL, WAMP_REALM } from '../config'

async function fetchCertHashes(): Promise<WebTransportCertHash[] | undefined> {
  if (!WAMP_WT_CERT_URL) return undefined
  const resp = await fetch(WAMP_WT_CERT_URL, { cache: 'no-store' })
  if (!resp.ok) {
    throw new Error(`failed to load WebTransport cert hash from ${WAMP_WT_CERT_URL}: ${resp.status} ${resp.statusText}`)
  }
  const payload: unknown = await resp.json()
  if (typeof payload !== 'object' || payload === null || !('hash' in payload) || typeof (payload as { hash?: unknown }).hash !== 'string') {
    throw new Error(`invalid WebTransport cert hash payload from ${WAMP_WT_CERT_URL}`)
  }
  const { hash } = payload as { hash: string }
  const hashBytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0))
  return [{ algorithm: 'sha-256', value: hashBytes }]
}

// Define a type for the session to improve type safety if xconn exports one,
// otherwise use any/unknown but document it. Using 'any' for now as xconn types are not fully exposed in this context.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WampSession = any

export const wampService = {
  async connectWithCRA(authId: string, secret: string): Promise<WampSession> {
    return connectWebTransportCRA(WAMP_WT_URL, WAMP_REALM, authId, secret, await fetchCertHashes())
  },

  async connectWithCryptosign(authId: string, privateKey: string): Promise<WampSession> {
    return connectWebTransportCryptosign(WAMP_WT_URL, WAMP_REALM, authId, privateKey, await fetchCertHashes())
  },

  async connectWithAnonymous(authId: string): Promise<WampSession> {
    return connectWebTransportAnonymous(WAMP_WT_URL, WAMP_REALM, authId, await fetchCertHashes())
  },

  async shellWithCryptosign(authId: string, privateKey: string, realm: string): Promise<WampSession> {
    return connectWebTransportCryptosign(WAMP_WT_URL, realm, authId, privateKey, await fetchCertHashes())
  },

  async shellWithWebRTC(config: ClientConfig): Promise<[Session, WebRTCSession]> {
    return connectWAMP(config)
  },
}
