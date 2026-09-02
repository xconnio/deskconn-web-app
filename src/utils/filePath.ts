// Remote file paths come from `deskconnd` running on the connected desktop,
// which uses '\' on Windows and '/' everywhere else. The frontend has no
// platform flag for the remote device, so every helper here infers the
// separator from the path string itself (a "C:" drive prefix, or a bare '\').
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:/

export function detectPathSeparator(path: string): '\\' | '/' {
  if (WINDOWS_DRIVE_PATTERN.test(path)) return '\\'
  return path.includes('\\') ? '\\' : '/'
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || WINDOWS_DRIVE_PATTERN.test(path)
}

export function normalizeComparablePath(path: string): string {
  const sep = detectPathSeparator(path)
  const sepPattern = sep === '\\' ? /\\+/g : /\/+/g
  const trailingPattern = sep === '\\' ? /\\$/ : /\/$/
  const normalized = path.replace(sepPattern, sep).replace(trailingPattern, '')
  return normalized || sep
}

export function isPathWithinHome(path: string, homePath: string): boolean {
  const sep = detectPathSeparator(homePath)
  const normalizedPath = normalizeComparablePath(path)
  const normalizedHome = normalizeComparablePath(homePath)

  return normalizedPath === normalizedHome || normalizedPath.startsWith(`${normalizedHome}${sep}`)
}

// Path segments between homePath and currentPath, for breadcrumb rendering.
export function relativeSegments(currentPath: string, homePath: string): string[] {
  const sep = detectPathSeparator(homePath)
  const normalizedCurrent = normalizeComparablePath(currentPath)
  const normalizedHome = normalizeComparablePath(homePath)
  const prefix = `${normalizedHome}${sep}`

  if (!normalizedCurrent.startsWith(prefix)) return []
  return normalizedCurrent.slice(prefix.length).split(sep).filter(Boolean)
}

export function joinPath(dir: string, name: string): string {
  const sep = detectPathSeparator(dir)
  const trimmedDir = dir.length > 1 && dir.endsWith(sep) ? dir.slice(0, -1) : dir
  return `${trimmedDir}${sep}${name}`
}

export function dirName(path: string): string {
  const sep = detectPathSeparator(path)
  const idx = path.lastIndexOf(sep)
  if (idx <= 0) return sep
  return path.slice(0, idx)
}
