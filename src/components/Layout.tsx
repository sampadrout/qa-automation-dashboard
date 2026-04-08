import { Outlet, Link, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { LogOut, FlaskConical } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Props { session: Session }

export default function Layout({ session }: Props) {
  const navigate = useNavigate()

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <Link to="/" className="flex items-center gap-2 font-semibold text-brand-600 text-lg">
          <FlaskConical size={20} />
          XR Triage
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{session.user.email}</span>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-red-600 transition-colors"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
