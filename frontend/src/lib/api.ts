const TOKEN_KEY = "platform_token"

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Authenticated fetch against the FastAPI backend (dev server proxies /api). */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  const body = options.body
  if (typeof body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  // URLSearchParams bodies set their own x-www-form-urlencoded content type —
  // never override it, or FastAPI's OAuth2 form parsing breaks.
  const token = getToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const res = await fetch(path, { ...options, headers })
  if (res.status === 401 && getToken()) {
    clearToken()
    window.location.href = "/login"
    throw new ApiError(401, "Session expired")
  }
  if (!res.ok) {
    let message = res.statusText
    try {
      const data: unknown = await res.json()
      const detail = (data as { detail?: unknown }).detail
      message = typeof detail === "string" ? detail : JSON.stringify(detail ?? data)
    } catch {
      // non-JSON error body; fall back to statusText
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
