import { get, set, del, clear } from 'idb-keyval'

export const SecureStorage = {
  async setItem(key: string, value: string): Promise<void> {
    await set(key, value)
  },

  async getItem(key: string): Promise<string | null> {
    const val = await get(key)
    return val === undefined ? null : val
  },

  async removeItem(key: string): Promise<void> {
    await del(key)
  },

  async clear(): Promise<void> {
    await clear()
  },
}
