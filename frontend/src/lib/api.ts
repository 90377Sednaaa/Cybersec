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

/**
 * One authenticated fetch with the shared 401 handling and backend-detail
 * parsing. Every wrapper below goes through here so an expired session is
 * treated the same for JSON, header-bearing and binary responses.
 */
async function request(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers)
  const body = options.body
  if (typeof body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  // URLSearchParams bodies set their own x-www-form-urlencoded content type -
  // never override it, or FastAPI's OAuth2 form parsing breaks.
  const token = getToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const res = await fetch(path, { ...options, headers })
  // Auth endpoints legitimately return 401 (bad credentials on login, wrong
  // current password on change-password). Those are ordinary errors, not an
  // expired session - let the generic !res.ok branch surface the backend detail.
  const isAuthCall = path.startsWith("/api/auth/")
  if (res.status === 401 && getToken() && !isAuthCall) {
    clearToken()
    // A full navigation discards ProtectedRoute's router state.from, so keep the
    // deep link for the login page to restore after re-authentication.
    sessionStorage.setItem("aletheia-return-to", window.location.pathname)
    window.location.href = "/login"
    throw new ApiError(401, "Session expired")
  }
  if (!res.ok) {
    let message = res.statusText
    try {
      const data: unknown = await res.json()
      const detail = (data as { detail?: unknown }).detail
      if (typeof detail === "string") {
        message = detail
      } else if (Array.isArray(detail)) {
        message = detail
          .map((item: { msg?: string }) => item.msg || JSON.stringify(item))
          .join("; ")
      } else if (detail !== undefined && detail !== null) {
        message = JSON.stringify(detail)
      } else {
        message = JSON.stringify(data)
      }
    } catch {
      // non-JSON error body; fall back to statusText
    }
    throw new ApiError(res.status, message)
  }
  return res
}

/** Authenticated fetch against the FastAPI backend (dev server proxies /api). */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await request(path, options)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export interface ApiWithMeta<T> {
  data: T
  /** X-Total-Count, when the endpoint sends one (findings list, proposal 06). */
  totalCount: number | null
}

/**
 * Like `api()`, but also exposes the response headers. A header is invisible
 * to `api()`'s JSON helper, which is why the findings total needed this.
 */
export async function apiWithMeta<T>(path: string, options: RequestInit = {}): Promise<ApiWithMeta<T>> {
  const res = await request(path, options)
  const header = res.headers.get("X-Total-Count")
  const parsed = header === null ? Number.NaN : Number(header)
  return {
    data: res.status === 204 ? (undefined as T) : ((await res.json()) as T),
    totalCount: Number.isFinite(parsed) ? parsed : null,
  }
}

/**
 * Authenticated binary download. A plain `<a href>` cannot send the
 * Authorization header, and a raw fetch bypassed the shared 401 handler (F-27).
 */
export async function apiBlob(path: string, options: RequestInit = {}): Promise<Blob> {
  const res = await request(path, options)
  return res.blob()
}
