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

// Returns the first supported MSE MIME+codec string for the file, used for both
// MediaSource.isTypeSupported and addSourceBuffer. High-profile variants are tried
// first so the declared codec matches what real-world videos actually contain.
export function getMSEMimeType(name: string): string | null {
  if (!('MediaSource' in window)) return null
  const ext = name.toLowerCase().split('.').pop() || ''

  const candidates: Record<string, string[]> = {
    // MP4/MOV are intentionally excluded from MSE: browsers vary in how strictly they
    // validate the declared audio codec against the actual stream, and we can't know
    // the audio codec before reading the file. All browsers play MP4/MOV reliably via
    // the full-buffer blob URL path using their native decoder.
    webm: [
      'video/webm; codecs="vp9,opus"',
      'video/webm; codecs="vp8,vorbis"',
      'video/webm; codecs="vp9"',
    ],
    ogv: [
      'video/ogg; codecs="theora,vorbis"',
      'video/ogg; codecs="theora"',
      'video/ogg',
    ],
    mp3:  ['audio/mpeg'],
    ogg:  ['audio/ogg; codecs=vorbis', 'audio/ogg; codecs=opus', 'audio/ogg'],
    opus: ['audio/ogg; codecs=opus'],
    aac:  ['audio/mp4; codecs="mp4a.40.2"'],
    m4a:  ['audio/mp4; codecs="mp4a.40.2"'],
  }

  for (const mime of candidates[ext] ?? []) {
    if (MediaSource.isTypeSupported(mime)) return mime
  }
  return null
}

export function isFirefoxBrowser(): boolean {
  return /firefox/i.test(navigator.userAgent)
}
