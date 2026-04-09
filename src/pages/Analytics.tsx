import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, LineChart, Line, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList,
} from 'recharts'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTriageTypes } from '@/lib/hooks'
import type { Cycle } from '@/lib/types'

const TABS = ['Summary', 'New Scripts', 'Failure Matrix'] as const
type Tab = typeof TABS[number]

// ── Shared fetch helpers ──────────────────────────────────────────────────────
async function fetchCycles(): Promise<Cycle[]> {
  const { data, error } = await supabase
    .from('cycles').select('*').eq('status', 'ready').order('name')
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

interface ScriptRow { cycle_id: string; test_title: string | null; module: string | null }
async function fetchAllTitles(): Promise<ScriptRow[]> {
  const PAGE = 1000
  const all: ScriptRow[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('test_results')
      .select('cycle_id, test_title, module')
      .not('test_title', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
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
  const { data: cycles = [], isLoading: lc } = useQuery({ queryKey: ['cycles-analytics'], queryFn: fetchCycles, staleTime: 0 })
  const { data: failed = [], isLoading: lf } = useQuery({ queryKey: ['failed-results'], queryFn: fetchFailedResults, staleTime: 0 })
  const { colors: CHART_COLORS } = useTriageTypes()

  const cycleMap = useMemo(() =>
    Object.fromEntries(cycles.map(c => [c.id, c.name])), [cycles])

  // Pass rate chart data
  const passRateData = useMemo(() =>
    cycles.map(c => ({
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
    failed.forEach(r => {
      const t = r.triage_type || 'Untriaged'
      counts[t] = (counts[t] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [failed])

  // Chart data: stacked bar (one bar per date)
  const chartData = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {}
    const trueTotal: Record<string, number> = {}
    cycles.forEach(c => {
      byDate[c.name] = {}
      trueTotal[c.name] = c.failed + c.pending
    })
    failed.forEach(r => {
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
  }, [failed, cycles, cycleMap])

  // Table: one row per date, triage type counts across all modules
  const tableRows = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {}
    cycles.forEach(c => { byDate[c.name] = {} })
    failed.forEach(r => {
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
  }, [failed, cycles, cycleMap])

  if (lc || lf) return <Spinner />

  return (
    <div className="space-y-8">
      {/* Pass rate line chart */}
      <Section title="Pass Rate % Over Time">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={passRateData} margin={{ top: 24, right: 24, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval={0} />
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
        </ResponsiveContainer>
      </Section>

      {/* Run summary table */}
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
              {passRateData.map(r => (
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
        </ResponsiveContainer>
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
              {tableRows.map(({ date, total, counts }) => (
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
function NewScriptsTab() {
  const { data: cycles = [], isLoading: lc } = useQuery({ queryKey: ['cycles-analytics'], queryFn: fetchCycles, staleTime: 0 })
  const { data: allTitles = [], isLoading: lt } = useQuery({ queryKey: ['all-titles'], queryFn: fetchAllTitles, staleTime: 0 })
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

  if (lc || lt) return <Spinner />

  return (
    <div className="space-y-8">
      {/* Stacked bar by module + cumulative line */}
      <Section title="New Scripts Added Per Run by Module">
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={chartData} margin={{ top: 16, right: 40, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval={0} />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ''} />
            <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 11, paddingLeft: 16 }} />
            {modules.map(m => (
              <Bar key={m} yAxisId="left" dataKey={m} stackId="a" fill={moduleColors[m]}>
                <LabelList dataKey="_total" position="top" content={({ x, y, width, index }) => {
                  const v = (chartData[index as number] as Record<string, unknown>)?._total as number
                  if (!v) return null
                  return <text x={(x as number) + (width as number) / 2} y={(y as number) - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#374151">{v}</text>
                }} />
              </Bar>
            ))}
            <Line yAxisId="right" type="monotone" dataKey="Cumulative Total"
              stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Section>

      {/* Date × Module new scripts table */}
      <Section title="New Scripts Per Date by Module">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
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
              {datesSorted.slice(1).map(date => {
                const mods = newByModule[date] ?? {}
                const total = Object.values(mods).reduce((a, b) => a + b, 0)
                return (
                  <tr key={date} className="hover:bg-gray-50">
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
function FailureMatrixTab() {
  const { data: cycles = [], isLoading: lc } = useQuery({ queryKey: ['cycles-analytics'], queryFn: fetchCycles, staleTime: 0 })
  const { data: failed = [], isLoading: lf } = useQuery({ queryKey: ['failed-results'], queryFn: fetchFailedResults, staleTime: 0 })
  const { colors: CHART_COLORS } = useTriageTypes()
  const [activeModule, setActiveModule] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const cycleMap = useMemo(() =>
    Object.fromEntries(cycles.map(c => [c.id, c.name])), [cycles])

  const datesSorted = useMemo(() => cycles.map(c => c.name), [cycles])

  const modules = useMemo(() =>
    [...new Set(failed.map(r => r.module).filter(Boolean))].sort() as string[], [failed])

  const selectedModule = activeModule ?? modules[0] ?? ''

  // Build pivot: test_title → date → triage_type; also track latest error per title
  const { titles } = useMemo(() => {
    const map: Record<string, Record<string, string>> = {}
    const errorMap: Record<string, string | null> = {}
    failed
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

      {activeTab === 'Summary'        && <SummaryTab />}
      {activeTab === 'New Scripts'    && <NewScriptsTab />}
      {activeTab === 'Failure Matrix'  && <FailureMatrixTab />}
    </div>
  )
}
