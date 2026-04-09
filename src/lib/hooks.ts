import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { TRIAGE_TYPES } from './constants'

export interface TriageTypeRow {
  id: string
  name: string
  color: string
  sort_order: number
}

const FALLBACK_COLORS: Record<string, string> = {
  'Untriaged':                   '#9ca3af',
  'Script Issue':                '#fbbf24',
  'Application Issue':           '#ef4444',
  'Environment Issue':           '#f97316',
  'Environment / Timeout Issue': '#fb923c',
  'Performance Issue':           '#a855f7',
  'Login Issue':                 '#ec4899',
  'Needs different login':       '#f472b6',
  'Timeout Issue':               '#f59e0b',
  'Data Issue':                  '#3b82f6',
  'Access Issue':                '#dc2626',
  'UI Change':                   '#6366f1',
}

export function useTriageTypes() {
  const { data = [] } = useQuery<TriageTypeRow[]>({
    queryKey: ['triage-types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('triage_types')
        .select('*')
        .order('sort_order')
      if (error) throw error
      return data
    },
    staleTime: 60_000,
  })

  const types: string[] = data.length > 0 ? data.map(t => t.name) : TRIAGE_TYPES
  const colors: Record<string, string> = data.length > 0
    ? Object.fromEntries(data.map(t => [t.name, t.color]))
    : FALLBACK_COLORS

  return { types, colors, rows: data }
}

export function useIsAdmin() {
  const { data = false } = useQuery<boolean>({
    queryKey: ['is-admin'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return false
      const { data } = await supabase
        .from('admin_users')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()
      return !!data
    },
    staleTime: 300_000,
  })
  return data
}
