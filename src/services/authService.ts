import { ClientConfig } from 'xconn-webrtc-js'
import { CBORSerializer, connectCryptosign, CryptoSignAuthenticator } from 'xconn'

import { wampService, type WampSession } from './wamp'
import { REGISTRATION_AUTHID, WAMP_URL } from '../config'

interface TurnCredentials {
  credential: string
  expires_at: number
  urls: string[]
  username: string
}

let cachedTurnCredentials: TurnCredentials | null = null

export const authService = {
  async register(form: { username: string; name: string; password: string }) {
    // Connect with registrar credentials
    const s = await wampService.connectWithAnonymous(REGISTRATION_AUTHID)

    try {
      const result = await s.call('io.xconn.deskconn.account.create', [
        form.username,
        form.name,
        form.password,
      ])
      return { result, session: s }
    } catch (err) {
      // Close session on failure locally if we created it strictly for this call
      // In the original code, we passed 's' back to the store.
      // We will return the session so the store can manage it (keep it open for verify).
      await s.leave().catch(console.error)
      throw err
    }
  },

  async verifyAccount(session: WampSession | null, username: string, code: string) {
    let s = session

    // Ensure we have a valid registrar session
    if (!s) {
      console.log('Restoring registrar session for verification...')
      s = await wampService.connectWithAnonymous(REGISTRATION_AUTHID)
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
    return wampService.connectWithAnonymous(REGISTRATION_AUTHID)
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
    return { session: s, result }
  },

  async forgotPassword(email: string) {
    const s = await this.getRegistrarSession()
    try {
      const result = await s.call('io.xconn.deskconn.account.password.forget', [email])
      return { result, session: s }
    } catch (err) {
      // Close session if it was just for this call?
      // Typically we might want to keep it if we expect a follow up, but forgot -> reset flow usually is stateless or uses a new session.
      // However, the user said "this will be the same session".
      // Let's return it.
      return { result: null, session: s, error: err }
    }
  },

  async resetPassword(session: WampSession | null, email: string, password: string, otp: string) {
    let s = session
    if (!s) {
      s = await this.getRegistrarSession()
    }
    const args = [email, password, otp]

    const result = await s.call('io.xconn.deskconn.account.password.reset', args)
    return { result, session: s }
  },

  async registerDevice(session: WampSession, deviceID: string, publicKey: string) {
    return session.call('io.xconn.deskconn.device.create', [deviceID, publicKey], {
      name: 'Browser Interface',
    })
  },

  async autoLogin(authId: string, privateKey: string) {
    const s = await wampService.connectWithCryptosign(authId, privateKey)
    const result = await s.call('io.xconn.deskconn.account.get')
    return { session: s, result }
  },

  async createOrganization(session: WampSession, name: string) {
    return session.call('io.xconn.deskconn.organization.create', [name])
  },

  async listOrganizations(session: WampSession) {
    return session.call('io.xconn.deskconn.organization.list')
  },

  async getOrganization(session: WampSession, id: string) {
    return session.call('io.xconn.deskconn.organization.get', [id])
  },

  async updateOrganization(session: WampSession, id: string, name: string) {
    return session.call('io.xconn.deskconn.organization.update', [id], { name })
  },

  async deleteOrganization(session: WampSession, id: string) {
    return await session.call('io.xconn.deskconn.organization.delete', [id])
  },

  async inviteUserToOrganization(session: WampSession, orgId: string, email: string, role: string) {
    return session.call('io.xconn.deskconn.organization.invitation.create', [orgId, email, role])
  },

  async listOrgInvitesInbox(session: WampSession) {
    return session.call('io.xconn.deskconn.organization.invitation.inbox.list')
  },

  async listOrgInvitesOutbox(session: WampSession) {
    return session.call('io.xconn.deskconn.organization.invitation.outbox.list')
  },

  async respondToOrgInvite(session: WampSession, invitationId: string, status: 'accepted' | 'rejected') {
    return session.call('io.xconn.deskconn.organization.invitation.respond', [invitationId, status])
  },

  async updateOrgMemberRole(session: WampSession, orgId: string, userId: string, role: string) {
    return session.call('io.xconn.deskconn.organization.member.role.update', [orgId, userId, role])
  },

  async removeOrgMember(session: WampSession, orgId: string, userId: string) {
    return session.call('io.xconn.deskconn.organization.member.remove', [orgId, userId])
  },

  async updateAccount(session: WampSession, name: string, password?: string) {
    const kwargs: Record<string, unknown> = { name }
    if (password) {
      kwargs.password = password
    }
    return await session.call('io.xconn.deskconn.account.update', [], kwargs)
  },
  async listDesktops(session: WampSession) {
    return session.call('io.xconn.deskconn.desktop.list')
  },

  async listDesktopUserAccesses(session: WampSession, desktopId: string) {
    return session.call('io.xconn.deskconn.desktop.access.user.list', [desktopId])
  },

  async listDesktopOrgAccesses(session: WampSession, desktopId: string) {
    return session.call('io.xconn.deskconn.desktop.access.organization.list', [desktopId])
  },

  async setUserAccess(session: WampSession, desktopId: string, userId: string, role: string) {
    return session.call('io.xconn.deskconn.desktop.access.user.set', [desktopId, userId, role])
  },

  async revokeUserAccess(session: WampSession, accessId: string) {
    return session.call('io.xconn.deskconn.desktop.access.user.revoke', [accessId])
  },

  async revokeOrgAccess(session: WampSession, accessId: string) {
    return session.call('io.xconn.deskconn.desktop.access.organization.revoke', [accessId])
  },

  async updateUserAccessRole(session: WampSession, accessId: string, role: string) {
    return session.call('io.xconn.deskconn.desktop.access.user.update', [accessId, role])
  },

  async updateOrgAccessRole(session: WampSession, accessId: string, role: string) {
    return session.call('io.xconn.deskconn.desktop.access.organization.update', [accessId, role])
  },

  async inviteUserToDesktop(session: WampSession, desktopId: string, email: string, role: string) {
    return session.call('io.xconn.deskconn.desktop.invitation.user.create', [desktopId, email, role])
  },

  async grantOrgDesktopAccess(session: WampSession, desktopId: string, organizationId: string) {
    return session.call('io.xconn.deskconn.desktop.access.organization.grant', [desktopId, organizationId])
  },

  async listDesktopInvitesInbox(session: WampSession) {
    return session.call('io.xconn.deskconn.desktop.invitation.inbox.list')
  },

  async listDesktopInvitesOutbox(session: WampSession) {
    return session.call('io.xconn.deskconn.desktop.invitation.outbox.list')
  },

  async cancelDesktopInvite(session: WampSession, invitationId: string) {
    return session.call('io.xconn.deskconn.desktop.invitation.user.cancel', [invitationId])
  },

  async cancelOrgInvite(session: WampSession, invitationId: string) {
    return session.call('io.xconn.deskconn.organization.invitation.cancel', [invitationId])
  },

  async getMyDesktopAccess(session: WampSession, desktopId: string) {
    return session.call('io.xconn.deskconn.desktop.access.user.me', [desktopId])
  },

  async respondToDesktopInvite(session: WampSession, invitationId: string, status: 'accepted' | 'rejected') {
    return session.call('io.xconn.deskconn.desktop.invitation.respond', [invitationId, status])
  },

  async shellDesktop(authId: string, privateKey: string, realm: string) {
     return await wampService.shellWithCryptosign(authId, privateKey, realm)
  },

  async shellWebRTCDesktop(authID: string, privateKey: string, realm: string) {
    const procedureWebRTCOffer = 'io.xconn.webrtc.offer'
    const topicAnswererOnCandidate = 'io.xconn.webrtc.answerer.on_candidate'
    const topicOffererOnCandidate = 'io.xconn.webrtc.offerer.on_candidate'
    const session = await connectCryptosign(WAMP_URL, realm, authID, privateKey)

    const iceServers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }]

    const nowSecs = Math.floor(Date.now() / 5000)
    if (!cachedTurnCredentials || cachedTurnCredentials.expires_at <= nowSecs) {
      try {
        const result = await session.call('io.xconn.deskconn.coturn.credentials.create')
        cachedTurnCredentials = result.args[0] as TurnCredentials
      } catch {
        cachedTurnCredentials = null
      }
    }

    if (cachedTurnCredentials) {
      iceServers.push({
        urls: cachedTurnCredentials.urls,
        username: cachedTurnCredentials.username,
        credential: cachedTurnCredentials.credential,
      })
    }

    const config = new ClientConfig(
      realm,
      procedureWebRTCOffer,
      topicAnswererOnCandidate,
      topicOffererOnCandidate,
      new CBORSerializer(),
      new CryptoSignAuthenticator(authID, privateKey, {}),
      session,
      iceServers,
    )

    return await wampService.shellWithWebRTC(config)
  },
}
