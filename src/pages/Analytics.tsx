import { useState, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, LineChart, Line, ComposedChart, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList,
} from 'recharts'
import { Loader2, FileDown, ChevronRight, ChevronDown, CalendarRange } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTriageTypes, useSprints } from '@/lib/hooks'
import { captureAndExportPDF } from '@/lib/exportPdf'
import ReportContent from '@/components/ReportContent'
import type { Cycle } from '@/lib/types'

const TABS = ['Summary', 'New Scripts', 'Failure Matrix'] as const
type Tab = typeof TABS[number]

// ── Shared fetch helpers ──────────────────────────────────────────────────────
async function fetchCycles(): Promise<Cycle[]> {
  const { data, error } = await supabase
    .from('cycles').select('*').eq('status', 'ready').eq('kind', 'regression').order('name')
  if (error) throw error
  return data
}

interface FailedRow { cycle_id: string; module: string | null; triage_type: string | null; test_title: string | null; error: string | null }
async function fetchFailedResults(): Promise<FailedRow[]> {
  const PAGE = 1000
  const all: FailedRow[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('test_results')
      .select('cycle_id, module, triage_type, test_title, error')
      .in('state', ['failed', 'pending'])
      .range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

interface ModuleCountRow { cycle_id: string; module: string; test_count: number }
async function fetchModuleCounts(): Promise<ModuleCountRow[]> {
  const { data, error } = await supabase.rpc('get_module_counts_per_cycle')
  if (error) throw error
  return data as ModuleCountRow[]
}

interface ScriptRow { cycle_id: string; test_title: string | null; module: string | null }
// Fetches only the FIRST occurrence of each distinct test_title via a DB-side DISTINCT ON.
// This is O(distinct titles) instead of O(all test rows), making tab load vastly faster.
async function fetchAllTitles(): Promise<ScriptRow[]> {
  const { data, error } = await supabase.rpc('get_title_first_seen')
  if (error) throw error
  return data as ScriptRow[]
}

// Smoke bundle for the PDF: ready smoke cycles + their per-test module/state/triage rows.
interface SmokeResultRow { cycle_id: string; module: string | null; state: string | null; triage_type: string | null }
async function fetchSmokeReportBundle(): Promise<{ cycles: Cycle[]; results: SmokeResultRow[] }> {
  const { data: cyc, error } = await supabase
    .from('cycles').select('*').eq('kind', 'smoke').eq('status', 'ready').order('uploaded_at')
  if (error) throw error
  const cycles = cyc as Cycle[]
  const ids = cycles.map(c => c.id)
  if (ids.length === 0) return { cycles, results: [] }

  const PAGE = 1000
  const results: SmokeResultRow[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('test_results')
      .select('cycle_id, module, state, triage_type')
      .in('cycle_id', ids)
      .range(from, from + PAGE - 1)
    if (error) throw error
    results.push(...(data as SmokeResultRow[]))
    if (data.length < PAGE) break
    from += PAGE
  }
  return { cycles, results }
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

// Normalise a cycle name to a YYYY-MM-DD string for date comparisons
function cycleNameToDate(name: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(name)) return name.slice(0, 10)
  const m = name.match(/^(\d{4})(\d{2})(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return name
}

function filterCyclesBySprint<T extends { name: string }>(cycles: T[], start: string, end: string): T[] {
  if (!start && !end) return cycles
  return cycles.filter(c => {
    const d = cycleNameToDate(c.name)
    if (start && d < start) return false
    if (end   && d > end)   return false
    return true
  })
}

// ── Range limiting (keeps charts readable as run history grows) ────────────────
const RANGE_OPTIONS = [10, 20, 50, 'all'] as const
type RangeLimit = number | 'all'

function limitTail<T>(arr: T[], limit: RangeLimit): T[] {
  return limit === 'all' ? arr : arr.slice(-limit)
}

// Give each run a fixed horizontal slot so a long history scrolls instead of cramming.
function chartWidth(n: number, perRun: number) {
  return Math.max(680, n * perRun)
}

function RangeSelector({ value, onChange, shown, total }: { value: RangeLimit; onChange: (v: RangeLimit) => void; shown: number; total: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-gray-500 font-medium">Show:</span>
      {RANGE_OPTIONS.map(opt => (
        <button
          key={String(opt)}
          onClick={() => onChange(opt)}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
            value === opt ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:border-brand-400'
          }`}
        >
          {opt === 'all' ? 'All' : `Last ${opt}`}
        </button>
      ))}
      <span className="text-gray-400 ml-1">Showing {shown} of {total} runs</span>
    </div>
  )
}

// Wraps a chart so it scrolls horizontally with a fixed per-run width.
function ScrollChart({ count, perRun, height, children }: { count: number; perRun: number; height: number; children: React.ReactElement }) {
  return (
    <div className="overflow-x-auto">
      <div style={{ width: chartWidth(count, perRun), minWidth: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Expandable cycle detail ───────────────────────────────────────────────────
interface CycleRow { module: string | null; state: string | null; triage_type: string | null }

function CycleExpanded({ cycleId }: { cycleId: string }) {
  const { data: rows = [], isLoading } = useQuery<CycleRow[]>({
    queryKey: ['cycle-expanded', cycleId],
    queryFn: async () => {
      const PAGE = 1000
      const all: CycleRow[] = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('test_results')
          .select('module, state, triage_type')
          .eq('cycle_id', cycleId)
          .range(from, from + PAGE - 1)
        if (error) throw error
        all.push(...data)
        if (data.length < PAGE) break
        from += PAGE
      }
      return all
    },
    staleTime: 5 * 60 * 1000,
  })

  const moduleStats = useMemo(() => {
    const map: Record<string, Record<string, number>> = {}
    rows.forEach(r => {
      const mod = r.module || '(none)'
      if (!map[mod]) map[mod] = {}
      const s = r.state || 'unknown'
      map[mod][s] = (map[mod][s] || 0) + 1
    })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  const { triageByModule, triageTypes } = useMemo(() => {
    const map: Record<string, Record<string, number>> = {}
    const types = new Set<string>()
    rows.filter(r => r.state !== 'passed').forEach(r => {
      const mod = r.module || '(none)'
      const t = r.triage_type || 'Untriaged'
      types.add(t)
      if (!map[mod]) map[mod] = {}
      map[mod][t] = (map[mod][t] || 0) + 1
    })
    const sorted = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
    const triageList = [...types].sort()
    return { triageByModule: sorted, triageTypes: triageList }
  }, [rows])

  const states = ['passed', 'failed', 'pending', 'skipped']

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-8 py-4 text-sm text-gray-400">
        <Loader2 size={14} className="animate-spin" /> Loading details…
      </div>
    )
  }

  const stateColor: Record<string, string> = { passed: 'text-green-600', failed: 'text-red-600', pending: 'text-yellow-600', skipped: 'text-gray-500' }
  const thCls = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 bg-white border-b border-gray-200 whitespace-nowrap'
  const tdCls = 'px-3 py-1.5 text-xs text-gray-700 whitespace-nowrap'

  return (
    <div className="px-8 py-4 grid grid-cols-2 gap-6">
      {/* Module × State breakdown */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Module Breakdown</p>
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={thCls}>Module</th>
                {states.map(s => <th key={s} className={`${thCls} capitalize`}>{s}</th>)}
                <th className={thCls}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {moduleStats.map(([mod, counts], i) => {
                const total = Object.values(counts).reduce((a, b) => a + b, 0)
                return (
                  <tr key={mod} className={i % 2 === 1 ? 'bg-gray-50' : 'bg-white'}>
                    <td className={`${tdCls} font-medium text-gray-800`}>{mod}</td>
                    {states.map(s => (
                      <td key={s} className={`${tdCls} font-medium ${stateColor[s] ?? ''}`}>
                        {counts[s] ?? '—'}
                      </td>
                    ))}
                    <td className={`${tdCls} font-bold text-gray-800`}>{total}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Module × Triage type distribution */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Triage Distribution (failures)</p>
        <div className="rounded-lg border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={thCls}>Module</th>
                {triageTypes.map(t => <th key={t} className={thCls}>{t}</th>)}
                <th className={thCls}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {triageByModule.map(([mod, counts], i) => {
                const total = Object.values(counts).reduce((a, b) => a + b, 0)
                return (
                  <tr key={mod} className={i % 2 === 1 ? 'bg-gray-50' : 'bg-white'}>
                    <td className={`${tdCls} font-medium text-gray-800`}>{mod}</td>
                    {triageTypes.map(t => (
                      <td key={t} className={tdCls}>{counts[t] ?? '—'}</td>
                    ))}
                    <td className={`${tdCls} font-bold text-gray-800`}>{total}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Tab: Summary ──────────────────────────────────────────────────────────────
function SummaryTab({ sprintStart, sprintEnd }: { sprintStart: string; sprintEnd: string }) {
  const { data: rawCycles = [], isLoading: lc } = useQuery({ queryKey: ['cycles-analytics'], queryFn: fetchCycles, staleTime: 0 })
  const { data: failed = [], isLoading: lf } = useQuery({ queryKey: ['failed-results'], queryFn: fetchFailedResults, staleTime: 0 })
  const [rangeLimit, setRangeLimit] = useState<RangeLimit>(20)
  const sprintCycles = useMemo(() => filterCyclesBySprint(rawCycles, sprintStart, sprintEnd), [rawCycles, sprintStart, sprintEnd])
  const cycles = useMemo(() => limitTail(sprintCycles, rangeLimit), [sprintCycles, rangeLimit])
  const { colors: CHART_COLORS } = useTriageTypes()

  const cycleMap = useMemo(() =>
    Object.fromEntries(cycles.map(c => [c.id, c.name])), [cycles])

  const sprintCycleIds = useMemo(() => new Set(cycles.map(c => c.id)), [cycles])
  const filteredFailed = useMemo(() => failed.filter(r => sprintCycleIds.has(r.cycle_id)), [failed, sprintCycleIds])

  const [expandedCycles, setExpandedCycles] = useState<Set<string>>(new Set())
  function toggleCycle(id: string) {
    setExpandedCycles(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Pass rate chart data
  const passRateData = useMemo(() =>
    cycles.map(c => ({
      id: c.id,
      date: c.name,
      label: fmtDate(c.name),
      'Pass Rate (%)': c.total_tests > 0 ? Math.round((c.passed / c.total_tests) * 100 * 10) / 10 : 0,
      Passed: c.passed,
      Failed: c.failed,
      Pending: c.pending,
      Total: c.total_tests,
    })), [cycles])

  // All failures regardless of module (for chart)
  const allTriageTypes = useMemo(() => {
    const counts: Record<string, number> = {}
    filteredFailed.forEach(r => {
      const t = r.triage_type || 'Untriaged'
      counts[t] = (counts[t] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [filteredFailed])

  // Chart data: stacked bar (one bar per date)
  const chartData = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {}
    const trueTotal: Record<string, number> = {}
    cycles.forEach(c => {
      byDate[c.name] = {}
      trueTotal[c.name] = c.failed + c.pending
    })
    filteredFailed.forEach(r => {
      const date = cycleMap[r.cycle_id]
      if (!date) return
      const t = r.triage_type || 'Untriaged'
      byDate[date][t] = (byDate[date][t] || 0) + 1
    })
    return Object.entries(byDate).map(([date, counts]) => ({
      date, label: fmtDate(date), ...counts,
      _total: trueTotal[date] ?? Object.values(counts).reduce((a, b) => a + b, 0),
      _zero: 0,
    }))
  }, [filteredFailed, cycles, cycleMap])

  // Table: one row per date, triage type counts across all modules
  const tableRows = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {}
    cycles.forEach(c => { byDate[c.name] = {} })
    filteredFailed.forEach(r => {
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
  }, [filteredFailed, cycles, cycleMap])

  if (lc || lf) return <Spinner />

  return (
    <div className="space-y-8">
      {/* Range selector */}
      {sprintCycles.length > 1 && (
        <RangeSelector value={rangeLimit} onChange={setRangeLimit} shown={cycles.length} total={sprintCycles.length} />
      )}

      {/* Pass rate line chart */}
      <Section title="Pass Rate % Over Time">
        <ScrollChart count={passRateData.length} perRun={48} height={320}>
          <LineChart data={passRateData} margin={{ top: 24, right: 24, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval={0} angle={-30} textAnchor="end" height={56} />
            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: '#6b7280' }} />
            <Tooltip formatter={pct} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ''} />
            <Line
              type="monotone" dataKey="Pass Rate (%)"
              stroke="#2563eb" strokeWidth={2.5}
              dot={{ r: 5, fill: '#2563eb', strokeWidth: 0 }}
              activeDot={{ r: 7 }}
            >
              <LabelList
                dataKey="Pass Rate (%)"
                position="top"
                formatter={(v: number) => `${v}%`}
                style={{ fontSize: 11, fontWeight: 700, fill: '#1d4ed8' }}
              />
            </Line>
          </LineChart>
        </ScrollChart>
      </Section>

      {/* Run summary table */}
      <Section title="Run Summary Table">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2 w-8" />
                {['Date', 'Total', 'Passed', 'Failed', 'Pending', 'Pass Rate'].map(h => (
                  <th key={h} className="px-4 py-2 text-left font-semibold text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {passRateData.slice().reverse().map(r => {
                const isExpanded = expandedCycles.has(r.id)
                return (
                  <>
                    <tr
                      key={r.date}
                      onClick={() => toggleCycle(r.id)}
                      className="hover:bg-blue-50 cursor-pointer select-none"
                    >
                      <td className="px-3 py-2 text-gray-400">
                        {isExpanded
                          ? <ChevronDown size={15} className="text-brand-600" />
                          : <ChevronRight size={15} />}
                      </td>
                      <td className="px-4 py-2 font-medium text-gray-900">{r.date}</td>
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
                    {isExpanded && (
                      <tr key={`${r.date}-detail`}>
                        <td colSpan={7} className="px-0 py-0 bg-blue-50 border-b border-blue-100">
                          <CycleExpanded cycleId={r.id} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Stacked bar: all modules, failures by triage type over time */}
      <Section title="Failure Distribution by Triage Type Over Time (All Modules)">
        <ScrollChart count={chartData.length} perRun={56} height={360}>
          <BarChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval={0} angle={-30} textAnchor="end" height={56} />
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
            <Bar dataKey="_zero" stackId="a" fill="transparent" legendType="none" isAnimationActive={false}>
              <LabelList
                dataKey="_zero"
                position="top"
                content={({ x, y, width, index }) => {
                  const total = (chartData[index as number] as { _total?: number })?._total
                  if (!total) return null
                  return (
                    <text
                      x={(x as number) + (width as number) / 2}
                      y={(y as number) - 4}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill="#374151"
                    >
                      {total}
                    </text>
                  )
                }}
              />
            </Bar>
          </BarChart>
        </ScrollChart>
      </Section>

      {/* Date × Triage type distribution */}
      <Section title="Date-wise Failure Breakdown by Triage Type">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Date</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600 whitespace-nowrap">Total</th>
                {allTriageTypes.map(t => (
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
              {tableRows.slice().reverse().map(({ date, total, counts }) => (
                <tr key={date} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{date}</td>
                  <td className="px-3 py-2 text-center font-semibold text-red-600">{total || '—'}</td>
                  {allTriageTypes.map(t => (
                    <td key={t} className="px-3 py-2 text-center">
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

// ── Tab: New Scripts ───────────────────────────────────────────────────────────
function NewScriptsTab({ sprintStart, sprintEnd }: { sprintStart: string; sprintEnd: string }) {
  const { data: rawCycles = [], isLoading: lc } = useQuery({ queryKey: ['cycles-analytics'], queryFn: fetchCycles, staleTime: 5 * 60 * 1000 })
  const { data: allTitles = [], isLoading: lt } = useQuery({ queryKey: ['all-titles'], queryFn: fetchAllTitles, staleTime: 5 * 60 * 1000 })
  const [rangeLimit, setRangeLimit] = useState<RangeLimit>(20)
  // NOTE: first-seen detection must run over the FULL sprint window, so we keep `cycles`
  // complete and only trim the displayed chart/table rows below.
  const cycles = useMemo(() => filterCyclesBySprint(rawCycles, sprintStart, sprintEnd), [rawCycles, sprintStart, sprintEnd])
  const cycleMap = useMemo(() =>
    Object.fromEntries(cycles.map(c => [c.id, c.name])), [cycles])

  const datesSorted = useMemo(() => cycles.map(c => c.name), [cycles])

  // For each test_title: first seen date, module (derived from the first-seen RPC result)
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

  // Derive modules from the normalised keys ('(none)' for nulls) — must come after titleStats
  const modules = useMemo(() =>
    [...new Set(titleStats.map(s => s.module || '(none)'))].sort(), [titleStats])

  // New scripts per date × module
  const newByModule = useMemo(() => {
    // map[date][module] = count of first-seen titles
    const map: Record<string, Record<string, number>> = {}
    datesSorted.forEach(d => { map[d] = {} })
    titleStats.forEach(s => {
      const mod = s.module || '(none)'
      if (!map[s.firstSeen]) map[s.firstSeen] = {}
      map[s.firstSeen][mod] = (map[s.firstSeen][mod] || 0) + 1
    })
    return map
  }, [titleStats, datesSorted])

  // Stacked bar + cumulative line chart data — skip first date (all tests appear new there)
  const chartData = useMemo(() => {
    let cumulative = 0
    return datesSorted.slice(1).map(date => {
      const modCounts = newByModule[date] ?? {}
      const total = Object.values(modCounts).reduce((a, b) => a + b, 0)
      cumulative += total
      return { date, label: fmtDate(date), ...modCounts, 'Cumulative Total': cumulative, _total: total }
    })
  }, [newByModule, datesSorted])

  // Module colour palette (cycles through fixed set)
  const MODULE_PALETTE = ['#4f6ef7','#22c55e','#f97316','#a855f7','#ec4899','#14b8a6','#f59e0b','#64748b','#ef4444','#06b6d4']
  const moduleColors = useMemo(() =>
    Object.fromEntries(modules.map((m, i) => [m, MODULE_PALETTE[i % MODULE_PALETTE.length]])),
  [modules])

  // Cumulative test-case count per module over time (running total per date)
  const growthData = useMemo(() => {
    const running: Record<string, number> = {}
    return datesSorted.map(date => {
      const newThisDate = newByModule[date] ?? {}
      Object.entries(newThisDate).forEach(([mod, n]) => {
        running[mod] = (running[mod] ?? 0) + n
      })
      return { date, label: fmtDate(date), ...Object.fromEntries(Object.entries(running)) }
    })
  }, [newByModule, datesSorted])

  // Trimmed views for display (full data is retained for first-seen accuracy + CSV export)
  const chartDataView  = useMemo(() => limitTail(chartData, rangeLimit), [chartData, rangeLimit])
  const growthDataView = useMemo(() => limitTail(growthData, rangeLimit), [growthData, rangeLimit])
  const tableDates     = useMemo(() => limitTail(datesSorted.slice(1), rangeLimit).slice().reverse(), [datesSorted, rangeLimit])

  // date → module → sorted list of test titles first seen on that date
  const newTitlesByDateModule = useMemo(() => {
    const map: Record<string, Record<string, string[]>> = {}
    titleStats.forEach(s => {
      if (!map[s.firstSeen]) map[s.firstSeen] = {}
      const mod = s.module || '(none)'
      if (!map[s.firstSeen][mod]) map[s.firstSeen][mod] = []
      map[s.firstSeen][mod].push(s.title)
    })
    // Sort titles within each module
    Object.values(map).forEach(modMap =>
      Object.values(modMap).forEach(titles => titles.sort())
    )
    return map
  }, [titleStats])

  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())
  function toggleDate(date: string) {
    setExpandedDates(prev => {
      const next = new Set(prev)
      next.has(date) ? next.delete(date) : next.add(date)
      return next
    })
  }

  const [hiddenModules, setHiddenModules] = useState<Set<string>>(new Set())
  function toggleModule(mod: string) {
    setHiddenModules(prev => {
      const next = new Set(prev)
      next.has(mod) ? next.delete(mod) : next.add(mod)
      return next
    })
  }
  const visibleModules = modules.filter(m => !hiddenModules.has(m))

  if (lc || lt) return <Spinner />

  return (
    <div className="space-y-8">
      {/* Range selector */}
      {cycles.length > 1 && (
        <RangeSelector value={rangeLimit} onChange={setRangeLimit} shown={limitTail(cycles, rangeLimit).length} total={cycles.length} />
      )}

      {/* Stacked bar by module + cumulative line */}
      <Section title="New Scripts Added Per Run by Module">
        <ScrollChart count={chartDataView.length} perRun={52} height={340}>
          <ComposedChart data={chartDataView} margin={{ top: 16, right: 40, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval={0} angle={-30} textAnchor="end" height={56} />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ''} />
            <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 11, paddingLeft: 16 }} />
            {modules.map(m => (
              <Bar key={m} yAxisId="left" dataKey={m} stackId="a" fill={moduleColors[m]}>
                <LabelList dataKey="_total" position="top" content={({ x, y, width, index }) => {
                  const v = (chartDataView[index as number] as Record<string, unknown>)?._total as number
                  if (!v) return null
                  return <text x={(x as number) + (width as number) / 2} y={(y as number) - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#374151">{v}</text>
                }} />
              </Bar>
            ))}
            <Line yAxisId="right" type="monotone" dataKey="Cumulative Total"
              stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ScrollChart>
      </Section>

      {/* Test case growth per module over time — stacked area with module toggles */}
      <Section title="Test Case Growth Per Module Over Time">
        {/* Toolbar: toggles + download */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex flex-wrap gap-2">
          {modules.map(m => {
            const hidden = hiddenModules.has(m)
            return (
              <button
                key={m}
                onClick={() => toggleModule(m)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all"
                style={{
                  borderColor: moduleColors[m],
                  background: hidden ? '#f9fafb' : moduleColors[m] + '22',
                  color: hidden ? '#9ca3af' : moduleColors[m],
                  opacity: hidden ? 0.6 : 1,
                }}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: hidden ? '#d1d5db' : moduleColors[m] }}
                />
                {m}
              </button>
            )
          })}
          {hiddenModules.size > 0 && (
            <button
              onClick={() => setHiddenModules(new Set())}
              className="px-3 py-1 rounded-full text-xs font-medium border border-gray-300 text-gray-500 hover:bg-gray-100 transition-all"
            >
              Show all
            </button>
          )}
        </div>
        <button
          onClick={() => {
            const cols = ['Date', ...modules]
            const rows = growthData.map(d => [
              d.date,
              ...modules.map(m => ((d as Record<string, unknown>)[m] ?? 0) as number),
            ])
            const csv = [cols, ...rows].map(r => r.join(',')).join('\n')
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
            a.download = 'test-case-growth.csv'
            a.click()
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all flex-shrink-0"
        >
          <FileDown size={13} />
          Download CSV
        </button>
        </div>

        <ScrollChart count={growthDataView.length} perRun={48} height={360}>
          <AreaChart data={growthDataView} margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
            <defs>
              {modules.map(m => (
                <linearGradient key={m} id={`grad-${m}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={moduleColors[m]} stopOpacity={0.55} />
                  <stop offset="95%" stopColor={moduleColors[m]} stopOpacity={0.08} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval={0} angle={-30} textAnchor="end" height={56} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={44} />
            <Tooltip
              labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ''}
              formatter={(value: number, name: string) => [value.toLocaleString(), name]}
              contentStyle={{ fontSize: 12 }}
            />
            {visibleModules.map(m => (
              <Area
                key={m}
                type="monotone"
                dataKey={m}
                stackId="1"
                stroke={moduleColors[m]}
                strokeWidth={1.5}
                fill={`url(#grad-${m})`}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </AreaChart>
        </ScrollChart>
      </Section>

      {/* Date × Module new scripts table */}
      <Section title="New Scripts Per Date by Module">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 w-8" />
                <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Date</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600 whitespace-nowrap">Total New</th>
                {modules.map(m => (
                  <th key={m} className="px-3 py-2 text-center font-semibold text-gray-600 whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: moduleColors[m] }} />
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tableDates.map(date => {
                const mods = newByModule[date] ?? {}
                const total = Object.values(mods).reduce((a, b) => a + b, 0)
                const isExpanded = expandedDates.has(date)
                const titlesForDate = newTitlesByDateModule[date] ?? {}
                const colSpan = 3 + modules.length
                return (
                  <>
                    <tr
                      key={date}
                      onClick={() => total > 0 && toggleDate(date)}
                      className={`${total > 0 ? 'cursor-pointer hover:bg-blue-50' : 'hover:bg-gray-50'} select-none`}
                    >
                      <td className="px-3 py-2 text-gray-400">
                        {total > 0 && (isExpanded
                          ? <ChevronDown size={15} className="text-brand-600" />
                          : <ChevronRight size={15} />)}
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{date}</td>
                      <td className="px-3 py-2 text-center font-semibold text-blue-600">{total || '—'}</td>
                      {modules.map(m => (
                        <td key={m} className="px-3 py-2 text-center">
                          {mods[m] ? (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                              style={{ background: moduleColors[m] + '22', color: moduleColors[m] }}>
                              {mods[m]}
                            </span>
                          ) : '—'}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && (
                      <tr key={`${date}-detail`}>
                        <td colSpan={colSpan} className="px-0 py-0 bg-blue-50 border-b border-blue-100">
                          <div className="px-8 py-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
                            {Object.entries(titlesForDate).sort((a, b) => a[0].localeCompare(b[0])).map(([mod, titles]) => (
                              <div key={mod}>
                                <div className="flex items-center gap-2 mb-2">
                                  <span
                                    className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                                    style={{ background: moduleColors[mod] ?? '#cbd5e1' }}
                                  />
                                  <span className="text-xs font-semibold text-gray-700">{mod}</span>
                                  <span className="text-xs text-gray-400 font-medium">({titles.length})</span>
                                </div>
                                <ul className="space-y-0.5 max-h-48 overflow-y-auto">
                                  {titles.map(t => (
                                    <li key={t} className="text-xs text-gray-600 truncate pl-4" title={t}>
                                      · {t}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

    </div>
  )
}

// ── Tab: Failure Matrix ────────────────────────────────────────────────────────
function FailureMatrixTab({ sprintStart, sprintEnd }: { sprintStart: string; sprintEnd: string }) {
  const { data: rawCycles = [], isLoading: lc } = useQuery({ queryKey: ['cycles-analytics'], queryFn: fetchCycles, staleTime: 0 })
  const { data: failed = [], isLoading: lf } = useQuery({ queryKey: ['failed-results'], queryFn: fetchFailedResults, staleTime: 0 })
  const cycles = useMemo(() => filterCyclesBySprint(rawCycles, sprintStart, sprintEnd), [rawCycles, sprintStart, sprintEnd])
  const { colors: CHART_COLORS } = useTriageTypes()
  const [activeModule, setActiveModule] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const cycleMap = useMemo(() =>
    Object.fromEntries(cycles.map(c => [c.id, c.name])), [cycles])

  const sprintCycleIds = useMemo(() => new Set(cycles.map(c => c.id)), [cycles])
  const filteredFailed = useMemo(() => failed.filter(r => sprintCycleIds.has(r.cycle_id)), [failed, sprintCycleIds])

  const datesSorted = useMemo(() => cycles.map(c => c.name), [cycles])

  const modules = useMemo(() =>
    [...new Set(filteredFailed.map(r => r.module).filter(Boolean))].sort() as string[], [filteredFailed])

  const selectedModule = activeModule ?? modules[0] ?? ''

  // Build pivot: test_title → date → triage_type; also track latest error per title
  const { titles } = useMemo(() => {
    const map: Record<string, Record<string, string>> = {}
    const errorMap: Record<string, string | null> = {}
    filteredFailed
      .filter(r => r.module === selectedModule && r.test_title)
      .forEach(r => {
        const date = cycleMap[r.cycle_id]
        if (!date) return
        const title = r.test_title!
        if (!map[title]) map[title] = {}
        map[title][date] = r.triage_type || 'Untriaged'
        if (r.error) errorMap[title] = r.error
      })

    // Sort by fail count desc
    const sorted = Object.entries(map)
      .map(([title, dates]) => ({ title, dates, failCount: Object.keys(dates).length, error: errorMap[title] ?? null }))
      .sort((a, b) => b.failCount - a.failCount)

    return { titles: sorted }
  }, [failed, selectedModule, cycleMap])

  const filtered = useMemo(() =>
    search ? titles.filter(t => t.title.toLowerCase().includes(search.toLowerCase())) : titles,
    [titles, search])

  if (lc || lf) return <Spinner />

  return (
    <div className="space-y-6">
      {/* Module selector */}
      <div className="flex items-start gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-600 mt-1.5">Module:</span>
        <div className="flex flex-wrap gap-2">
          {modules.map(m => (
            <button
              key={m}
              onClick={() => { setActiveModule(m); setSearch('') }}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                m === selectedModule
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-brand-400'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <Section title={`${selectedModule} — Failed Tests × Cycle Date (${filtered.length} tests)`}>
        {/* Search */}
        <div className="mb-3">
          <input
            type="text"
            placeholder="Search test title…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="overflow-auto max-h-[600px]">
          <table className="text-xs border-collapse w-max min-w-full">
            <thead className="sticky top-0 z-20">
              <tr>
                {/* Sticky test title header */}
                <th className="sticky left-0 z-30 bg-gray-50 border border-gray-200 px-3 py-2 text-left font-semibold text-gray-700 min-w-[260px] max-w-[320px]">
                  Test Title
                </th>
                <th className="bg-gray-50 border border-gray-200 px-3 py-2 text-center font-semibold text-gray-700 whitespace-nowrap">
                  Fail Count
                </th>
                {datesSorted.map(d => (
                  <th key={d} className="bg-gray-50 border border-gray-200 px-3 py-2 text-center font-semibold text-gray-700 whitespace-nowrap">
                    {fmtDate(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ title, dates, failCount, error }) => (
                <tr key={title} className="hover:bg-blue-50 transition-colors">
                  {/* Sticky test title cell */}
                  <td className="sticky left-0 bg-white border border-gray-200 px-3 py-2 text-gray-800 max-w-[320px] hover:bg-blue-50 transition-colors">
                    <div className="truncate font-medium" title={title}>{title}</div>
                    {error && (
                      <div className="text-xs text-red-500 truncate mt-0.5" title={error}>{error}</div>
                    )}
                  </td>
                  {/* Fail count */}
                  <td className="border border-gray-200 px-3 py-2 text-center">
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                      failCount >= datesSorted.length * 0.7 ? 'bg-red-100 text-red-700' :
                      failCount >= datesSorted.length * 0.4 ? 'bg-orange-100 text-orange-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {failCount}
                    </span>
                  </td>
                  {/* One cell per date */}
                  {datesSorted.map(d => {
                    const triage = dates[d]
                    return (
                      <td key={d} className="border border-gray-200 px-2 py-1.5 text-center">
                        {triage ? (
                          <span
                            className="inline-block px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap"
                            style={{
                              background: (CHART_COLORS[triage] ?? '#9ca3af') + '25',
                              color: CHART_COLORS[triage] ?? '#6b7280',
                              border: `1px solid ${(CHART_COLORS[triage] ?? '#9ca3af')}55`,
                            }}
                            title={triage}
                          >
                            {triage.length > 12 ? triage.slice(0, 11) + '…' : triage}
                          </span>
                        ) : (
                          <span className="text-gray-200">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={datesSorted.length + 2} className="text-center py-10 text-gray-400">
                    No failed tests found for this module.
                  </td>
                </tr>
              )}
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

// ── Sprint selector bar ───────────────────────────────────────────────────────
function SprintSelector({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { sprints } = useSprints()
  const selected = sprints.find(s => s.id === value)
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-600 whitespace-nowrap">
        <CalendarRange size={15} className="text-brand-500" />
        Sprint
      </div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-[200px]"
      >
        <option value="">All time</option>
        {sprints.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      {selected && (
        <span className="text-xs text-brand-600 font-medium bg-brand-50 px-2 py-0.5 rounded-full border border-brand-100 whitespace-nowrap">
          {selected.start_date} → {selected.end_date}
        </span>
      )}
      {sprints.length === 0 && (
        <span className="text-xs text-gray-400">No sprints configured — add them in <strong>Settings</strong>.</span>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Analytics() {
  const [activeTab, setActiveTab] = useState<Tab>('Summary')
  const [selectedSprintId, setSelectedSprintId] = useState('')
  const { sprints } = useSprints()
  const selectedSprint = sprints.find(s => s.id === selectedSprintId)
  const sprintStart = selectedSprint?.start_date ?? ''
  const sprintEnd   = selectedSprint?.end_date   ?? ''
  const [exporting, setExporting] = useState(false)
  const reportRef = useRef<HTMLDivElement>(null)
  const { colors: triageColors } = useTriageTypes()

  // Pre-fetch all data so ReportContent off-screen component is always populated
  const { data: reportCycles = [] } = useQuery({ queryKey: ['cycles-analytics'], queryFn: fetchCycles, staleTime: 0 })
  const { data: reportFailed = [] } = useQuery({ queryKey: ['failed-results'], queryFn: fetchFailedResults, staleTime: 0 })
  const { data: reportTitles = [] } = useQuery({ queryKey: ['all-titles'], queryFn: fetchAllTitles, staleTime: 5 * 60 * 1000 })
  const { data: reportModuleCounts = [] } = useQuery({ queryKey: ['module-counts'], queryFn: fetchModuleCounts, staleTime: 5 * 60 * 1000 })
  const { data: reportSmoke = { cycles: [], results: [] } } = useQuery({ queryKey: ['smoke-report-bundle'], queryFn: fetchSmokeReportBundle, staleTime: 60_000 })

  async function handleExportPDF() {
    if (!reportRef.current) return
    setExporting(true)
    const el = reportRef.current
    el.style.left = '0'
    el.style.opacity = '1'
    try {
      await new Promise(r => setTimeout(r, 400)) // let recharts fully render charts
      await captureAndExportPDF(el, `qa-report-${new Date().toISOString().slice(0, 10)}.pdf`)
    } finally {
      el.style.left = '-9999px'
      el.style.opacity = '0'
      setExporting(false)
    }
  }

  return (
    <>
      {/* Off-screen report for PDF capture */}
      <div
        ref={reportRef}
        style={{ position: 'fixed', left: '-9999px', top: 0, opacity: 0, zIndex: -1, pointerEvents: 'none' }}
      >
        <ReportContent
          cycles={reportCycles}
          failed={reportFailed}
          allTitles={reportTitles}
          moduleCounts={reportModuleCounts}
          triageColors={triageColors}
          smokeCycles={reportSmoke.cycles}
          smokeResults={reportSmoke.results}
        />
      </div>

    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">Trends across all test cycles</p>
        </div>
        <button
          onClick={handleExportPDF}
          disabled={exporting}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />}
          Export PDF
        </button>
      </div>

      {/* Sprint selector */}
      <div className="mb-5">
        <SprintSelector value={selectedSprintId} onChange={setSelectedSprintId} />
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

      {activeTab === 'Summary'        && <SummaryTab        sprintStart={sprintStart} sprintEnd={sprintEnd} />}
      {activeTab === 'New Scripts'    && <NewScriptsTab     sprintStart={sprintStart} sprintEnd={sprintEnd} />}
      {activeTab === 'Failure Matrix' && <FailureMatrixTab  sprintStart={sprintStart} sprintEnd={sprintEnd} />}
    </div>
    </>
  )
}
