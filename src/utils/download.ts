/** Triggers a browser download of a same-origin/object URL — doesn't own the URL's lifetime. */
export function downloadUrl(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/** Triggers a browser download of in-memory data, via a short-lived object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  downloadUrl(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
