import type { TriageType } from './types'

export const TRIAGE_TYPES: TriageType[] = [
  'Untriaged',
  'Script Issue',
  'Application Issue',
  'Environment Issue',
  'Environment / Timeout Issue',
  'Performance Issue',
  'Login Issue',
  'Needs different login',
  'Timeout Issue',
  'Data Issue',
  'Access Issue',
  'UI Change',
]

export const TRIAGE_COLORS: Record<string, string> = {
  'Script Issue':                'bg-yellow-100 text-yellow-800',
  'Application Issue':           'bg-red-100 text-red-800',
  'Environment Issue':           'bg-orange-100 text-orange-800',
  'Environment / Timeout Issue': 'bg-orange-100 text-orange-800',
  'Performance Issue':           'bg-purple-100 text-purple-800',
  'Login Issue':                 'bg-pink-100 text-pink-800',
  'Needs different login':       'bg-pink-100 text-pink-800',
  'Timeout Issue':               'bg-orange-100 text-orange-800',
  'Data Issue':                  'bg-blue-100 text-blue-800',
  'Access Issue':                'bg-red-100 text-red-800',
  'UI Change':                   'bg-indigo-100 text-indigo-800',
  'Untriaged':                   'bg-gray-100 text-gray-500',
}
