export type FilePreviewType = 'image' | 'audio' | 'video' | 'text' | 'pdf' | 'none'

export function formatSize(size?: number): string {
  if (typeof size !== 'number') return '-'
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size, unitIndex = -1
  while (value >= 1024 && unitIndex < units.length - 1) { value /= 1024; unitIndex++ }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

export function getFilePreviewType(name: string): FilePreviewType {
  const ext = name.toLowerCase().split('.').pop() || ''
  if (/^(png|jpg|jpeg|gif|webp|svg|bmp)$/.test(ext)) return 'image'
  if (/^(mp3|ogg|wav|flac|aac|m4a|opus)$/.test(ext)) return 'audio'
  if (/^(mp4|webm|mov|ogv)$/.test(ext)) return 'video'
  if (ext === 'pdf') return 'pdf'
  if (/^(txt|md|log|json|yaml|yml|toml|xml|ini|conf|env|sh|bash|zsh|py|js|ts|jsx|tsx|css|html|htm|go|rs|c|cpp|h|hpp|java|rb|php|csv|vue|svelte|sql)$/.test(ext)) return 'text'
  return 'none'
}

export function getMimeType(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || ''
  const m: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
    flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', opus: 'audio/ogg',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/mp4', ogv: 'video/ogg',
    pdf: 'application/pdf',
  }
  return m[ext] || 'application/octet-stream'
}

export function isFirefoxBrowser(): boolean {
  return /firefox/i.test(navigator.userAgent)
}
