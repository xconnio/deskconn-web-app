import { connectCryptosign, connectCRA, Client, AnonymousAuthenticator } from 'xconn'
import { connectWAMP, ClientConfig } from 'xconn-webrtc-js'

import { WAMP_URL, WAMP_REALM } from '../config'

// Define a type for the session to improve type safety if xconn exports one,
// otherwise use any/unknown but document it. Using 'any' for now as xconn types are not fully exposed in this context.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WampSession = any

export const wampService = {
  async connectWithCRA(authId: string, secret: string): Promise<WampSession> {
    return connectCRA(WAMP_URL, WAMP_REALM, authId, secret)
  },

  async connectWithCryptosign(authId: string, privateKey: string): Promise<WampSession> {
    return connectCryptosign(WAMP_URL, WAMP_REALM, authId, privateKey)
  },

  async connectWithAnonymous(authId: string): Promise<WampSession> {
    const client = new Client({ authenticator: new AnonymousAuthenticator(authId, {}) })
    return client.connect(WAMP_URL, WAMP_REALM)
  },

  async shellWithCryptosign(authId: string, privateKey: string, realm: string): Promise<WampSession> {
    return connectCryptosign(WAMP_URL, realm, authId, privateKey)
  },

  async shellWithWebRTC(config: ClientConfig): Promise<WampSession> {
    return connectWAMP(config)
  },
}
