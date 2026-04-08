export type CycleStatus = 'processing' | 'ready' | 'error'

export type TestState = 'passed' | 'failed' | 'pending'

export type TriageType =
  | 'Script Issue'
  | 'Performance Issue'
  | 'Login Issue'
  | 'Needs different login'
  | 'Environment Issue'
  | 'Environment / Timeout Issue'
  | 'Application Issue'
  | 'Timeout Issue'
  | 'Data Issue'
  | 'Access Issue'
  | 'UI Change'
  | 'Untriaged'

export interface Cycle {
  id: string
  name: string
  uploaded_at: string
  uploaded_by: string | null
  status: CycleStatus
  total_tests: number
  passed: number
  failed: number
  pending: number
  error_message: string | null
}

export interface TestResult {
  id: string
  cycle_id: string
  row_num: number | null
  module: string | null
  file: string | null
  suites: string | null
  test_title: string | null
  full_title: string | null
  state: TestState | null
  duration_s: number | null
  error: string | null
  triage_type: TriageType | null
  triage_desc: string | null
  triaged_by: string | null
  triaged_at: string | null
}

// Supabase Database type scaffold (add more as needed)
export interface Database {
  public: {
    Tables: {
      cycles: {
        Row: Cycle
        Insert: Omit<Cycle, 'id' | 'uploaded_at'>
        Update: Partial<Omit<Cycle, 'id'>>
      }
      test_results: {
        Row: TestResult
        Insert: Omit<TestResult, 'id'>
        Update: Partial<Omit<TestResult, 'id' | 'cycle_id'>>
      }
    }
  }
}
