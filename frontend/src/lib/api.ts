const TOKEN_KEY = 'vibecheck.token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

/** Clears the session token and cached user profile (used on sign out). */
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem('vibecheck.user')
}

export function getUser(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem('vibecheck.user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const headers: Record<string, string> = {
    // Let the browser set the multipart boundary for FormData bodies.
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({}))

  // A rejected token (expired or server reset) means the session is dead —
  // forget it so the router sends the user to the sign-in page on next visit.
  if (res.status === 401) clearAuth()

  if (!res.ok) {
    const message = (data as { error?: unknown }).error
    throw new Error(typeof message === 'string' ? message : `Request failed (${res.status}).`)
  }

  return data as T
}

/** Fetches a protected file as a blob, carrying the auth token. */
async function downloadFile(url: string): Promise<Blob> {
  const res = await fetch(url, {
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
  })
  if (res.status === 401) clearAuth()
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const message = (data as { error?: unknown }).error
    throw new Error(typeof message === 'string' ? message : `Could not open file (${res.status}).`)
  }
  return res.blob()
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
  upload: <T>(url: string, form: FormData) => request<T>('POST', url, form),
  download: (url: string) => downloadFile(url),
}
