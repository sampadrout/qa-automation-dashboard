import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, LineChart, Line, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Cycle } from '@/lib/types'

// ── Chart colours per triage type ────────────────────────────────────────────
const CHART_COLORS: Record<string, string> = {
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
  'Untriaged':                   '#9ca3af',
}

const TABS = ['Summary', 'Pass Rate Trend', 'New Scripts'] as const
type Tab = typeof TABS[number]

// ── Shared fetch helpers ──────────────────────────────────────────────────────
async function fetchCycles(): Promise<Cycle[]> {
  const { data, error } = await supabase
    .from('cycles').select('*').eq('status', 'ready').order('name')
  if (error) throw error
  return data
}

interface FailedRow { cycle_id: string; module: string | null; triage_type: string | null }
async function fetchFailedResults(): Promise<FailedRow[]> {
  const { data, error } = await supabase
    .from('test_results')
    .select('cycle_id, module, triage_type')
    .in('state', ['failed', 'pending'])
    .limit(50000)
  if (error) throw error
  return data
}

interface ScriptRow { cycle_id: string; test_title: string | null; module: string | null }
async function fetchAllTitles(): Promise<ScriptRow[]> {
  const { data, error } = await supabase
    .from('test_results')
    .select('cycle_id, test_title, module')
    .not('test_title', 'is', null)
    .limit(50000)
  if (error) throw error
  return data
}

// ── Tooltip formatter ─────────────────────────────────────────────────────────
function pct(v: string | number) { return `${v}%` }

// Handles "2026-03-12" → "Mar 12"  and  "20260407.1" → "Apr 7"
function fmtDate(d: string) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (d.includes('-')) {
    const parts = d.split('-')
    if (parts.length >= 3) {
      const m = parseInt(parts[1])
      const day = parseInt(parts[2])
      if (m >= 1 && m <= 12) return `${months[m - 1]} ${day}`
    }
  }
  const match = d.match(/^(\d{4})(\d{2})(\d{2})/)
  if (match) {
    const m = parseInt(match[2])
    if (m >= 1 && m <= 12) return `${months[m - 1]} ${parseInt(match[3])}`
  }
  return d
}

// ── Tab: Summary ──────────────────────────────────────────────────────────────
function SummaryTab() {
  const { data: cycles = [], isLoading: lc } = useQuery({ queryKey: ['cycles-analytics'], queryFn: fetchCycles })
  const { data: failed = [], isLoading: lf } = useQuery({ queryKey: ['failed-results'], queryFn: fetchFailedResults })
  const [moduleFilter, setModuleFilter] = useState<string | null>(null)

  const cycleMap = useMemo(() =>
    Object.fromEntries(cycles.map(c => [c.id, c.name])), [cycles])

  const modules = useMemo(() =>
    [...new Set(failed.map(r => r.module).filter(Boolean))].sort() as string[], [failed])

  // Default to first module once data loads
  const activeModule = moduleFilter ?? modules[0] ?? ''

  // All failures regardless of module (for chart)
  const allTriageTypes = useMemo(() => {
    const counts: Record<string, number> = {}
    failed.forEach(r => {
      const t = r.triage_type || 'Untriaged'
      counts[t] = (counts[t] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [failed])

  // Chart data: all modules stacked bar (one bar per date)
  const chartData = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {}
    cycles.forEach(c => { byDate[c.name] = {} })
    failed.forEach(r => {
      const date = cycleMap[r.cycle_id]
      if (!date) return
      const t = r.triage_type || 'Untriaged'
      byDate[date][t] = (byDate[date][t] || 0) + 1
    })
    return Object.entries(byDate).map(([date, counts]) => ({ date, label: fmtDate(date), ...counts }))
  }, [failed, cycles, cycleMap])

  // Table: date × triage type for the selected module
  const moduleRows = useMemo(() => {
    const filtered = failed.filter(r => r.module === activeModule)
    const byDate: Record<string, Record<string, number>> = {}
    cycles.forEach(c => { byDate[c.name] = {} })
    filtered.forEach(r => {
      const date = cycleMap[r.cycle_id]
      if (!date) return
      const t = r.triage_type || 'Untriaged'
      byDate[date][t] = (byDate[date][t] || 0) + 1
    })
    return Object.entries(byDate).map(([date, counts]) => ({
      date,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      counts,
    }))
  }, [failed, cycles, cycleMap, activeModule])

  // Triage types present for the selected module
  const moduleTriageTypes = useMemo(() => {
    const counts: Record<string, number> = {}
    moduleRows.forEach(r => Object.entries(r.counts).forEach(([t, n]) => {
      counts[t] = (counts[t] || 0) + n
    }))
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [moduleRows])

  if (lc || lf) return <Spinner />

  return (
    <div className="space-y-8">
      {/* Stacked bar: all modules, failures by triage type over time */}
      <Section title="Failure Distribution by Triage Type Over Time (All Modules)">
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} width={35} />
            <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ''} />
            <Legend
              layout="vertical"
              align="right"
              verticalAlign="middle"
              wrapperStyle={{ fontSize: 11, paddingLeft: 16 }}
            />
            {allTriageTypes.map(t => (
              <Bar key={t} dataKey={t} stackId="a" fill={CHART_COLORS[t] ?? '#cbd5e1'} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Section>

      {/* Date × Triage breakdown for selected module */}
      <Section title="Date-wise Failure Breakdown by Triage Type">
        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm font-medium text-gray-600">Module:</label>
          <div className="flex flex-wrap gap-2">
            {modules.map(m => (
              <button
                key={m}
                onClick={() => setModuleFilter(m)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  m === activeModule
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-brand-400'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Date</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600 whitespace-nowrap">Total</th>
                {moduleTriageTypes.map(t => (
                  <th key={t} className="px-3 py-2 text-center font-semibold text-gray-600 whitespace-nowrap">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                      style={{ background: CHART_COLORS[t] ?? '#cbd5e1' }}
                    />
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {moduleRows.map(({ date, total, counts }) => (
                <tr key={date} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{date}</td>
                  <td className="px-3 py-2 text-center font-semibold text-red-600">{total || '—'}</td>
                  {moduleTriageTypes.map(t => (
                    <td key={t} className="px-3 py-2 text-center text-gray-600">
                      {counts[t] ? (
                        <span
                          className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                          style={{ background: CHART_COLORS[t] + '22', color: CHART_COLORS[t] }}
                        >
                          {counts[t]}
                        </span>
                      ) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

// ── Tab: Pass Rate Trend ───────────────────────────────────────────────────────
function PassRateTrendTab() {
  const { data: cycles = [], isLoading } = useQuery({ queryKey: ['cycles-analytics'], queryFn: fetchCycles })

  const chartData = useMemo(() =>
    cycles.map(c => ({
      date: c.name,
      'Pass Rate (%)': c.total_tests > 0 ? Math.round((c.passed / c.total_tests) * 100 * 10) / 10 : 0,
      Passed: c.passed,
      Failed: c.failed,
      Pending: c.pending,
      Total: c.total_tests,
    })), [cycles])

  if (isLoading) return <Spinner />

  return (
    <div className="space-y-8">
      {/* Pass rate line */}
      <Section title="Pass Rate % Over Time">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
            <Tooltip formatter={pct} />
            <Legend />
            <Line
              type="monotone" dataKey="Pass Rate (%)"
              stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </Section>

      {/* Absolute counts bar */}
      <Section title="Passed / Failed / Pending Counts Per Run">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="Passed"  stackId="a" fill="#22c55e" />
            <Bar dataKey="Failed"  stackId="a" fill="#ef4444" />
            <Bar dataKey="Pending" stackId="a" fill="#fbbf24" />
          </BarChart>
        </ResponsiveContainer>
      </Section>

      {/* Table */}
      <Section title="Run Summary Table">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Date', 'Total', 'Passed', 'Failed', 'Pending', 'Pass Rate'].map(h => (
                  <th key={h} className="px-4 py-2 text-left font-semibold text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {chartData.map(r => (
                <tr key={r.date} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">{r.date}</td>
                  <td className="px-4 py-2 text-gray-600">{r.Total}</td>
                  <td className="px-4 py-2 text-green-600 font-medium">{r.Passed}</td>
                  <td className="px-4 py-2 text-red-600 font-medium">{r.Failed}</td>
                  <td className="px-4 py-2 text-yellow-600">{r.Pending}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${r['Pass Rate (%)']}%` }} />
                      </div>
                      <span className={`font-semibold ${r['Pass Rate (%)'] >= 90 ? 'text-green-600' : r['Pass Rate (%)'] >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {r['Pass Rate (%)']}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

// ── Tab: New Scripts ───────────────────────────────────────────────────────────
function NewScriptsTab() {
  const { data: cycles = [], isLoading: lc } = useQuery({ queryKey: ['cycles-analytics'], queryFn: fetchCycles })
  const { data: allTitles = [], isLoading: lt } = useQuery({ queryKey: ['all-titles'], queryFn: fetchAllTitles })
  const [moduleFilter, setModuleFilter] = useState('')
  const [search, setSearch] = useState('')

  const cycleMap = useMemo(() =>
    Object.fromEntries(cycles.map(c => [c.id, c.name])), [cycles])

  const datesSorted = useMemo(() => cycles.map(c => c.name), [cycles])

  const modules = useMemo(() =>
    [...new Set(allTitles.map(r => r.module).filter(Boolean))].sort() as string[], [allTitles])

  // For each test_title: first seen date, last seen date, run count, module
  const titleStats = useMemo(() => {
    const map: Record<string, { firstSeen: string; lastSeen: string; runs: Set<string>; module: string }> = {}
    allTitles.forEach(r => {
      if (!r.test_title) return
      const date = cycleMap[r.cycle_id]
      if (!date) return
      if (!map[r.test_title]) {
        map[r.test_title] = { firstSeen: date, lastSeen: date, runs: new Set([date]), module: r.module ?? '' }
      } else {
        const s = map[r.test_title]
        if (date < s.firstSeen) s.firstSeen = date
        if (date > s.lastSeen) s.lastSeen = date
        s.runs.add(date)
      }
    })
    return Object.entries(map).map(([title, s]) => ({
      title,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
      runCount: s.runs.size,
      module: s.module,
    })).sort((a, b) => a.firstSeen.localeCompare(b.firstSeen) || a.module.localeCompare(b.module))
  }, [allTitles, cycleMap])

  // New scripts per date chart data
  const chartData = useMemo(() => {
    const newPerDate: Record<string, number> = {}
    datesSorted.forEach(d => { newPerDate[d] = 0 })
    titleStats.forEach(s => {
      newPerDate[s.firstSeen] = (newPerDate[s.firstSeen] || 0) + 1
    })
    let cumulative = 0
    return datesSorted.map(date => {
      cumulative += newPerDate[date] || 0
      return { date, 'New Scripts': newPerDate[date] || 0, 'Cumulative Total': cumulative }
    })
  }, [titleStats, datesSorted])

  // Filtered detail table
  const filtered = useMemo(() => titleStats.filter(s => {
    if (moduleFilter && s.module !== moduleFilter) return false
    if (search && !s.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [titleStats, moduleFilter, search])

  if (lc || lt) return <Spinner />

  return (
    <div className="space-y-8">
      {/* Combo chart */}
      <Section title="New Scripts Added Per Run + Cumulative Total">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 40, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar yAxisId="left" dataKey="New Scripts" fill="#4f6ef7" />
            <Line yAxisId="right" type="monotone" dataKey="Cumulative Total"
              stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Section>

      {/* Detail table */}
      <Section title={`Script Details (${filtered.length} of ${titleStats.length})`}>
        <div className="flex items-center gap-3 mb-3">
          <select
            value={moduleFilter}
            onChange={e => setModuleFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All Modules</option>
            {modules.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input
            type="text"
            placeholder="Search test title…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 flex-1 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="border-b border-gray-200">
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Test Title</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Module</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">First Seen</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Last Seen</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600 whitespace-nowrap"># Runs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(s => (
                <tr key={s.title} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-800 max-w-xs truncate" title={s.title}>{s.title}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">{s.module || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{s.firstSeen}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{s.lastSeen}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${s.runCount < datesSorted.length ? 'bg-yellow-50 text-yellow-700' : 'bg-green-50 text-green-700'}`}>
                      {s.runCount} / {datesSorted.length}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

// ── Shared UI helpers ─────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 className="text-base font-semibold text-gray-800 mb-4">{title}</h2>
      {children}
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-20">
      <Loader2 size={32} className="animate-spin text-gray-400" />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Analytics() {
  const [activeTab, setActiveTab] = useState<Tab>('Summary')

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Trends across all test cycles</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === tab
                ? 'bg-white border border-b-white border-gray-200 text-brand-600 -mb-px'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Summary'         && <SummaryTab />}
      {activeTab === 'Pass Rate Trend' && <PassRateTrendTab />}
      {activeTab === 'New Scripts'     && <NewScriptsTab />}
    </div>
  )
}
