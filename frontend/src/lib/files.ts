import { api } from './api'

/** Fetches a protected PDF and opens it in a new tab, cleaning up the blob URL. */
export async function openPdf(url: string): Promise<void> {
  const blob = await api.download(url)
  const objectUrl = URL.createObjectURL(blob)
  const tab = window.open(objectUrl, '_blank', 'noopener')
  if (!tab) {
    // Popup blocked — fall back to a same-tab navigation.
    window.location.assign(objectUrl)
  }
  // Give the new tab time to load before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}

/** Saves a protected PDF to disk using the server's filename. */
export async function savePdf(url: string, fallbackName = 'document.pdf'): Promise<void> {
  const blob = await api.download(url)
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fallbackName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
