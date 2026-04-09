import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, missingEnv } from '@/lib/supabase'
import Login from '@/pages/Login'
import Cycles from '@/pages/Cycles'
import CycleDetail from '@/pages/CycleDetail'
import Analytics from '@/pages/Analytics'
import Layout from '@/components/Layout'

function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  if (missingEnv) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="bg-white rounded-xl border border-red-200 shadow p-8 max-w-md text-center">
          <p className="text-red-600 font-semibold text-lg mb-2">Missing Supabase configuration</p>
          <p className="text-sm text-gray-500">
            <code className="bg-gray-100 px-1 rounded">VITE_SUPABASE_URL</code> and{' '}
            <code className="bg-gray-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> were not set
            at build time. Add them as <strong>Environment variables</strong> (not Secrets) in
            Cloudflare Pages → Settings → Environment variables, then redeploy.
          </p>
        </div>
      </div>
    )
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
        <Route
          path="/"
          element={session ? <Layout session={session} /> : <Navigate to="/login" replace />}
        >
          <Route index element={<Cycles />} />
          <Route path="cycles/:id" element={<CycleDetail />} />
          <Route path="analytics" element={<Analytics />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
