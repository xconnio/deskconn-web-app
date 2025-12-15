export const WAMP_URL = import.meta.env.VITE_WAMP_URL || 'ws://localhost:8080/ws'
export const WAMP_REALM = import.meta.env.VITE_WAMP_REALM || 'io.xconn.deskconn'

// Registration specific credentials
export const REGISTRATION_AUTHID = import.meta.env.VITE_REGISTRATION_AUTHID || 'deskconn-web-app'
export const REGISTRATION_SECRET = import.meta.env.VITE_REGISTRATION_SECRET || ''
