import { wampService, type WampSession } from './wamp'
import { REGISTRATION_AUTHID, REGISTRATION_SECRET } from '../config'

export const authService = {
  async register(form: { username: string; name: string; password: string }) {
    // Connect with registrar credentials
    const s = await wampService.connectWithCryptosign(REGISTRATION_AUTHID, REGISTRATION_SECRET)

    try {
      const result = await s.call('io.xconn.deskconn.account.create', [
        form.username,
        form.name,
        'user',
        form.password,
      ])
      return { result, session: s }
    } catch (err) {
      // Close session on failure locally if we created it strictly for this call
      // In the original code, we passed 's' back to the store.
      // We will return the session so the store can manage it (keep it open for verify).
      await s.close().catch(console.error)
      throw err
    }
  },

  async verifyAccount(session: WampSession | null, username: string, code: string) {
    let s = session

    // Ensure we have a valid registrar session
    if (!s) {
      console.log('Restoring registrar session for verification...')
      s = await wampService.connectWithCryptosign(REGISTRATION_AUTHID, REGISTRATION_SECRET)
    }

    try {
      const result = await s.call('io.xconn.deskconn.account.verify', [username, code])
      return result
    } catch (err) {
      throw err
    }
  },

  // Helper to get a session if not provided
  async getRegistrarSession(): Promise<WampSession> {
    return wampService.connectWithCryptosign(REGISTRATION_AUTHID, REGISTRATION_SECRET)
  },

  async resendOtp(session: WampSession | null, username: string) {
    let s = session
    if (!s) {
      s = await this.getRegistrarSession()
    }
    const result = await s.call('io.xconn.deskconn.account.otp.resend', [username])
    return { result, session: s }
  },

  async login(username: string, password: string) {
    const s = await wampService.connectWithCRA(username, password)
    const result = await s.call('io.xconn.deskconn.account.get')
    const userDetails = result.args?.[0] || result

    if (!userDetails || !userDetails.id) {
      await s.close()
      throw new Error('Invalid user details received')
    }

    return { session: s, userDetails }
  },

  async registerDevice(session: WampSession, deviceID: string, publicKey: string) {
    return session.call('io.xconn.deskconn.device.create', [deviceID, publicKey], {
      name: 'Browser Interface',
    })
  },

  async autoLogin(authId: string, privateKey: string) {
    const s = await wampService.connectWithCryptosign(authId, privateKey)
    const result = await s.call('io.xconn.deskconn.account.get')
    const userDetails = result.args?.[0] || result
    return { session: s, userDetails }
  },
}
