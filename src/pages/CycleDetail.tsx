import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Save, Loader2, Filter, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { TRIAGE_TYPES, TRIAGE_COLORS } from '@/lib/constants'
import StateBadge from '@/components/StateBadge'
import type { TestResult, Cycle, TriageType } from '@/lib/types'

interface TriageEdit {
  triage_type: TriageType
  triage_desc: string
}

type Edits = Record<string, TriageEdit>

export default function CycleDetail() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const [moduleFilter, setModuleFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [triageFilter, setTriageFilter] = useState('')
  const [edits, setEdits] = useState<Edits>({})
  const [saving, setSaving] = useState<string | null>(null)

  const { data: cycle } = useQuery<Cycle>({
    queryKey: ['cycle', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('cycles').select('*').eq('id', id!).single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  const { data: results = [], isLoading } = useQuery<TestResult[]>({
    queryKey: ['test_results', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('test_results')
        .select('*')
        .eq('cycle_id', id!)
        .order('row_num', { ascending: true })
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  const modules = [...new Set(results.map(r => r.module).filter(Boolean))].sort() as string[]

  const filtered = results.filter(r => {
    if (moduleFilter && r.module !== moduleFilter) return false
    if (stateFilter && r.state !== stateFilter) return false
    if (triageFilter) {
      const eff = r.triage_type ?? 'Untriaged'
      if (triageFilter === 'Untriaged' && eff !== 'Untriaged') return false
      if (triageFilter !== 'Untriaged' && eff !== triageFilter) return false
    }
    return true
  })

  function getEdit(row: TestResult): TriageEdit {
    return edits[row.id] ?? {
      triage_type: (row.triage_type ?? 'Untriaged') as TriageType,
      triage_desc: row.triage_desc ?? '',
    }
  }

  function setEdit(rowId: string, patch: Partial<TriageEdit>) {
    setEdits(prev => ({
      ...prev,
      [rowId]: { ...getEditById(rowId, results), ...prev[rowId], ...patch },
    }))
  }

  function getEditById(rowId: string, rows: TestResult[]): TriageEdit {
    const row = rows.find(r => r.id === rowId)
    return {
      triage_type: (row?.triage_type ?? 'Untriaged') as TriageType,
      triage_desc: row?.triage_desc ?? '',
    }
  }

  async function saveRow(row: TestResult) {
    const edit = edits[row.id]
    if (!edit) return
    setSaving(row.id)
    try {
      // Cast to any to bypass supabase-js TriageType literal union inference
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tbl = (supabase as any).from('test_results')
      const { error } = await tbl.update({
        triage_type: edit.triage_type === 'Untriaged' ? null : edit.triage_type,
        triage_desc: edit.triage_desc || null,
        triaged_at: new Date().toISOString(),
      }).eq('id', row.id)
      if (error) throw error
      // Remove from dirty edits after save
      setEdits(prev => { const n = { ...prev }; delete n[row.id]; return n })
      queryClient.invalidateQueries({ queryKey: ['test_results', id] })
    } finally {
      setSaving(null)
    }
  }

  const isDirty = (rowId: string) => rowId in edits

  const stats = cycle ? {
    pass: Math.round((cycle.passed / (cycle.total_tests || 1)) * 100),
  } : null

  return (
    <div className="max-w-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{cycle?.name ?? '…'}</h1>
            {cycle && (
              <p className="text-sm text-gray-500 mt-0.5">
                {cycle.total_tests} tests · {cycle.passed} passed · {cycle.failed} failed
                {cycle.pending > 0 && ` · ${cycle.pending} pending`}
                {stats && ` · ${stats.pass}% pass rate`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <Filter size={14} />
          <span>Filters:</span>
        </div>
        <select
          value={moduleFilter}
          onChange={e => setModuleFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All Modules</option>
          {modules.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All States</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        <select
          value={triageFilter}
          onChange={e => setTriageFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All Triage</option>
          {TRIAGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {(moduleFilter || stateFilter || triageFilter) && (
          <button
            onClick={() => { setModuleFilter(''); setStateFilter(''); setTriageFilter('') }}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-red-600 transition-colors"
          >
            <X size={14} />
            Clear
          </button>
        )}
        <span className="text-sm text-gray-400 ml-auto">{filtered.length} rows</span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={32} className="animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">#</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">Module</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600">Test Title</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">State</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">Duration</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 min-w-[180px]">Triage Type</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 min-w-[220px]">Triage Description</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(row => {
                  const edit = getEdit(row)
                  const dirty = isDirty(row.id)
                  const isSaving = saving === row.id
                  return (
                    <tr key={row.id} className={`transition-colors ${dirty ? 'bg-yellow-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-3 py-2.5 text-gray-400 whitespace-nowrap">{row.row_num}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-medium">
                          {row.module ?? '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 max-w-xs">
                        <div className="font-medium text-gray-900 truncate" title={row.test_title ?? ''}>
                          {row.test_title}
                        </div>
                        {row.error && (
                          <div className="text-xs text-red-500 truncate mt-0.5" title={row.error}>
                            {row.error}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <StateBadge state={row.state} />
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                        {row.duration_s != null ? `${row.duration_s}s` : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          value={edit.triage_type}
                          onChange={e => setEdit(row.id, { triage_type: e.target.value as TriageType })}
                          className={`w-full text-xs rounded px-2 py-1.5 border focus:outline-none focus:ring-1 focus:ring-brand-500 ${TRIAGE_COLORS[edit.triage_type] ?? 'bg-gray-100'}`}
                        >
                          {TRIAGE_TYPES.map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="text"
                          value={edit.triage_desc}
                          onChange={e => setEdit(row.id, { triage_desc: e.target.value })}
                          placeholder="Add description…"
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                        />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {dirty && (
                          <button
                            onClick={() => saveRow(row)}
                            disabled={isSaving}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs rounded font-medium transition-colors"
                          >
                            {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                            Save
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-gray-400 text-sm">
                      No results match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
