import { x25519 } from '@noble/curves/ed25519.js'
import { chacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/ciphers/utils.js'

export interface EncryptionKeys {
  encryptKey: Uint8Array
  decryptKey: Uint8Array
}

export function createX25519KeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  const privateKey = randomBytes(32)
  const publicKey = x25519.getPublicKey(privateKey)
  return { publicKey, privateKey }
}

async function deriveKeyHKDF(sharedSecret: Uint8Array, info: string): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    sharedSecret.buffer.slice(
      sharedSecret.byteOffset,
      sharedSecret.byteOffset + sharedSecret.byteLength,
    ) as ArrayBuffer,
    'HKDF',
    false,
    ['deriveKey'],
  )
  const derived = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt'],
  )
  const raw = await crypto.subtle.exportKey('raw', derived)
  return new Uint8Array(raw)
}

export async function deriveSessionKeys(
  privateKey: Uint8Array,
  serverPublicKey: Uint8Array,
): Promise<EncryptionKeys> {
  const sharedSecret = x25519.getSharedSecret(privateKey, serverPublicKey)
  const [encryptKey, decryptKey] = await Promise.all([
    deriveKeyHKDF(sharedSecret, 'frontendToBackend'),
    deriveKeyHKDF(sharedSecret, 'backendToFrontend'),
  ])
  return { encryptKey, decryptKey }
}

export function encryptPayload(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = randomBytes(12)
  const cipher = chacha20poly1305(key, nonce)
  const ciphertext = cipher.encrypt(plaintext)
  const result = new Uint8Array(12 + ciphertext.length)
  result.set(nonce, 0)
  result.set(ciphertext, 12)
  return result
}

export function decryptPayload(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (data.length < 12) throw new Error('Payload too short')
  const nonce = data.slice(0, 12)
  const ciphertext = data.slice(12)
  const cipher = chacha20poly1305(key, nonce)
  return cipher.decrypt(ciphertext)
}

// Matches Go's encoding/json convention of encoding []byte fields as
// standard base64 — used for the plaintext key-exchange frames exchanged
// before either raw-stream file-transfer protocol switches to binary.
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
