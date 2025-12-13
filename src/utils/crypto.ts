import * as ed from '@noble/ed25519'

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function generateDeviceID(): string {
  return 'device-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString(36)
}

export interface KeyPair {
  privateKey: string
  publicKey: string
}

export async function generateKeys(): Promise<KeyPair> {
  const privateKey = ed.utils.randomSecretKey()
  const publicKey = await ed.getPublicKeyAsync(privateKey)
  return {
    privateKey: toHex(privateKey),
    publicKey: toHex(publicKey),
  }
}
