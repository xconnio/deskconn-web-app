const runtimeConfig = (window as Window & { __APP_CONFIG__?: Record<string, string> }).__APP_CONFIG__ ?? {}

export const WAMP_URL = runtimeConfig.WAMP_URL ?? import.meta.env.VITE_WAMP_URL ?? 'ws://localhost:8080/ws'
export const WAMP_REALM = runtimeConfig.WAMP_REALM ?? import.meta.env.VITE_WAMP_REALM ?? 'io.xconn.deskconn'
export const REGISTRATION_AUTHID = runtimeConfig.REGISTRATION_AUTHID ?? import.meta.env.VITE_REGISTRATION_AUTHID ?? 'deskconn-web-app'
