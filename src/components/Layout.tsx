import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { LogOut, FlaskConical, BarChart2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Props { session: Session }

export default function Layout({ session }: Props) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

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
        <nav className="flex items-center gap-1 ml-8">
          <Link
            to="/"
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${pathname === '/' ? 'bg-brand-50 text-brand-600' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Cycles
          </Link>
          <Link
            to="/analytics"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${pathname.startsWith('/analytics') ? 'bg-brand-50 text-brand-600' : 'text-gray-500 hover:text-gray-800'}`}
          >
            <BarChart2 size={15} />
            Analytics
          </Link>
        </nav>
        <div className="flex items-center gap-4 ml-auto">
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
