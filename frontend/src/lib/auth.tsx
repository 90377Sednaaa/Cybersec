/* eslint-disable react-refresh/only-export-components */
import { useQueryClient } from "@tanstack/react-query"
import { createContext, useCallback, useContext, useEffect, useState } from "react"
import type { ReactNode } from "react"

import { api, clearToken, getToken, setToken } from "@/lib/api"
import type { Role, TokenResponse, User } from "@/lib/types"

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  hasRole: (...roles: Role[]) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState<boolean>(Boolean(getToken()))

  useEffect(() => {
    if (!getToken()) return
    api<User>("/api/auth/me")
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const body = new URLSearchParams({ username: email, password })
    const token = await api<TokenResponse>("/api/auth/login", { method: "POST", body })
    setToken(token.access_token)
    const me = await api<User>("/api/auth/me")
    setUser(me)
  }, [])

  const logout = useCallback(() => {
    // AuthProvider sits inside QueryClientProvider, so the cache outlives the
    // session unless we clear it. Without this, the next user to log in on the
    // same browser briefly sees the previous user's findings, notes and counts.
    void queryClient.cancelQueries()
    queryClient.clear()
    clearToken()
    setUser(null)
  }, [queryClient])

  const hasRole = useCallback(
    (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    [user],
  )

  return <AuthContext.Provider value={{ user, loading, login, logout, hasRole }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider")
  return ctx
}
