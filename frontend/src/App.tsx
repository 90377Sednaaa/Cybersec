import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import type { ReactNode } from "react"

import { AppShell } from "@/components/layout/app-shell"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/lib/auth"

import { DashboardPage } from "@/pages/dashboard"
import { LoginPage } from "@/pages/login"
import { AssessmentsPage } from "@/pages/assessments"
import { AssessmentRunPage } from "@/pages/assessment-run"
import { FindingsPage } from "@/pages/findings"
import { SettingsPage } from "@/pages/settings"
import { TargetsPage } from "@/pages/targets"



function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/targets" element={<TargetsPage />} />
        <Route path="/assessments" element={<AssessmentsPage />} />
        <Route path="/assessments/:id" element={<AssessmentRunPage />} />
        <Route path="/findings" element={<FindingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
