import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const missingEnv = !supabaseUrl || !supabaseAnonKey

// Use placeholder values so the module doesn't throw at load time.
// The app checks `missingEnv` and renders an error screen before any Supabase call.
export const supabase = createClient<Database>(
  supabaseUrl  || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
)
