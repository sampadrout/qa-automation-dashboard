import { useState, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList,
} from 'recharts'
import {
  Upload, RefreshCw, CheckCircle2, XCircle, Loader2, ChevronRight, Zap, Clock,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { extractZip, parseCsvRows } from '@/lib/processZip'
import { useTriageTypes } from '@/lib/hooks'
import type { Cycle } from '@/lib/types'

function pad(n: number) { return String(n).padStart(2, '0') }

// Build a unique, human-readable name from a run date/time.
// Seconds are included so several runs on the same minute don't collide on cycles.name.
function smokeRunName(d: Date): string {
  return `Smoke ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// Pull a YYYY-MM-DD (with optional separators) out of a file name, e.g. "smoke_2026-06-15.csv".
function dateFromFileName(name: string): Date | null {
  const m = name.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/)
  if (!m) return null
  const [y, mo, d] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return new Date(y, mo - 1, d, 12, 0, 0)
}

// Resolve the run's date/time with this priority:
//   1. real start time embedded in the JSON report (most accurate)
//   2. a date the user typed in the Run Date field
//   3. a date detected in the uploaded file name
//   4. now (last resort)
function resolveRunDate(fileName: string, startedAt: string | null, runDateInput: string): Date {
  if (startedAt) return new Date(startedAt)
  if (runDateInput) return new Date(`${runDateInput}T12:00:00`)
  return dateFromFileName(fileName) ?? new Date()
}

// "Smoke 2026-07-05 19:13:27" → "Jul 5, 19:13"
function runLabel(c: Cycle): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const m = c.name.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (m) return `${months[parseInt(m[2]) - 1]} ${parseInt(m[3])}, ${m[4]}:${m[5]}`
  const d = new Date(c.uploaded_at)
  return `${months[d.getMonth()]} ${d.getDate()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function passRate(c: Cycle) {
  return c.total_tests > 0 ? Math.round((c.passed / c.total_tests) * 100) : 0
}

function rateColor(rate: number) {
  return rate >= 90 ? 'text-green-600' : rate >= 70 ? 'text-yellow-600' : 'text-red-600'
}

// Give each run a fixed horizontal slot so a long history scrolls instead of cramming.
function chartWidth(n: number, perRun: number) {
  return Math.max(680, n * perRun)
}

const RANGE_OPTIONS = [10, 20, 50, 'all'] as const

function StatusIcon({ status }: { status: string }) {
  if (status === 'ready')      return <CheckCircle2 size={16} className="text-green-500" />
  if (status === 'error')      return <XCircle size={16} className="text-red-500" />
  if (status === 'processing') return <Loader2 size={16} className="text-yellow-500 animate-spin" />
  return <Clock size={16} className="text-gray-400" />
}

interface SmokeResultRow { cycle_id: string; module: string | null; state: string | null; triage_type: string | null }

export default function SmokeTests() {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [runDate, setRunDate] = useState('')
  const [rangeLimit, setRangeLimit] = useState<number | 'all'>(20)
  const { colors: triageColors } = useTriageTypes()

  const { data: cycles = [], isLoading } = useQuery<Cycle[]>({
    queryKey: ['smoke-cycles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cycles')
        .select('*')
        .eq('kind', 'smoke')
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return data
    },
    refetchInterval: 5000,
  })

  const readyCycles = useMemo(() => cycles.filter(c => c.status === 'ready'), [cycles])
  const cycleIds = useMemo(() => readyCycles.map(c => c.id), [readyCycles])

  // Per-run per-module state counts (for the module health matrix). Smoke runs are small,
  // but page anyway since PostgREST caps a select at 1000 rows.
  const { data: resultRows = [] } = useQuery<SmokeResultRow[]>({
    queryKey: ['smoke-results', cycleIds],
    enabled: cycleIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const PAGE = 1000
      const all: SmokeResultRow[] = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('test_results')
          .select('cycle_id, module, state, triage_type')
          .in('cycle_id', cycleIds)
          .range(from, from + PAGE - 1)
        if (error) throw error
        all.push(...(data as SmokeResultRow[]))
        if (data.length < PAGE) break
        from += PAGE
      }
      return all
    },
  })

  // Oldest → newest for trend charts
  const chronoAll = useMemo(
    () => readyCycles.slice().sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at)),
    [readyCycles],
  )

  // Only the most-recent N runs are charted so a growing history stays readable.
  const chrono = useMemo(
    () => (rangeLimit === 'all' ? chronoAll : chronoAll.slice(-rangeLimit)),
    [chronoAll, rangeLimit],
  )

  const trendData = useMemo(
    () => chrono.map(c => ({
      id: c.id,
      label: runLabel(c),
      'Pass Rate (%)': passRate(c),
    })),
    [chrono],
  )

  // Module health matrix: modules (rows) × most-recent runs (cols) → pass rate per cell
  const matrix = useMemo(() => {
    const perCycle: Record<string, Record<string, { passed: number; total: number }>> = {}
    resultRows.forEach(r => {
      const mod = r.module || '(none)'
      if (!perCycle[r.cycle_id]) perCycle[r.cycle_id] = {}
      if (!perCycle[r.cycle_id][mod]) perCycle[r.cycle_id][mod] = { passed: 0, total: 0 }
      perCycle[r.cycle_id][mod].total += 1
      if (r.state === 'passed') perCycle[r.cycle_id][mod].passed += 1
    })
    const modules = [...new Set(resultRows.map(r => r.module || '(none)'))].sort()
    // Same visible window as the charts (oldest → newest)
    const runs = chrono
    return { perCycle, modules, runs }
  }, [resultRows, chrono])

  // Failure distribution by triage type across the visible runs (failed + pending = "failures")
  const visibleIds = useMemo(() => new Set(chrono.map(c => c.id)), [chrono])
  const failures = useMemo(
    () => resultRows.filter(r => r.state !== 'passed' && visibleIds.has(r.cycle_id)),
    [resultRows, visibleIds],
  )

  const triageTypesByFreq = useMemo(() => {
    const counts: Record<string, number> = {}
    failures.forEach(r => {
      const t = r.triage_type || 'Untriaged'
      counts[t] = (counts[t] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [failures])

  const failureDistData = useMemo(() => {
    const byCycle: Record<string, Record<string, number>> = {}
    chrono.forEach(c => { byCycle[c.id] = {} })
    failures.forEach(r => {
      if (!byCycle[r.cycle_id]) byCycle[r.cycle_id] = {}
      const t = r.triage_type || 'Untriaged'
      byCycle[r.cycle_id][t] = (byCycle[r.cycle_id][t] || 0) + 1
    })
    return chrono.map(c => {
      const counts = byCycle[c.id] ?? {}
      return {
        label: runLabel(c),
        ...counts,
        _total: Object.values(counts).reduce((a, b) => a + b, 0),
        _zero: 0,
      }
    })
  }, [failures, chrono])

  const latest = chrono[chrono.length - 1]

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const lower = file.name.toLowerCase()
    const isZip = lower.endsWith('.zip')
    const isCsv = lower.endsWith('.csv')
    if (!isZip && !isCsv) {
      setUploadError('Only .zip or .csv files are accepted.')
      return
    }

    setUploading(true)
    setUploadError(null)

    try {
      let rows, startedAt: string | null
      if (isZip) {
        ({ rows, startedAt } = await extractZip(file))
      } else {
        rows = parseCsvRows(await file.text())
        startedAt = null
        if (rows.length === 0) throw new Error('No valid test rows found in CSV')
      }
      const when = resolveRunDate(file.name, startedAt, runDate)
      const name = smokeRunName(when)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any

      // uploaded_at is set to the run date so historical back-fills sort correctly on trends.
      const { data: cycleData, error: cycleErr } = await db
        .from('cycles')
        .insert({ name, status: 'processing', kind: 'smoke', uploaded_at: when.toISOString() })
        .select('id')
        .single()
      if (cycleErr) {
        throw cycleErr.code === '23505'
          ? new Error(`A smoke run named "${name}" already exists.`)
          : cycleErr
      }

      const cycleId = (cycleData as { id: string }).id

      const BATCH = 500
      for (let i = 0; i < rows.length; i += BATCH) {
        const { error: insErr } = await db
          .from('test_results')
          .insert(rows.slice(i, i + BATCH).map(r => ({ ...r, cycle_id: cycleId })))
        if (insErr) throw insErr
      }

      const passed  = rows.filter(r => r.state === 'passed').length
      const failed  = rows.filter(r => r.state === 'failed').length
      const pending = rows.filter(r => r.state === 'pending').length
      await db.from('cycles').update({
        status: 'ready',
        total_tests: rows.length,
        passed,
        failed,
        pending,
      }).eq('id', cycleId)

      queryClient.invalidateQueries({ queryKey: ['smoke-cycles'] })
      setRunDate('')
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Zap size={22} className="text-amber-500" />
            Smoke Tests
          </h1>
          <p className="text-sm text-gray-500 mt-1">Pipeline smoke-test health across runs. Upload a pipeline ZIP or an exported CSV to record a run.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['smoke-cycles'] })
              queryClient.invalidateQueries({ queryKey: ['smoke-results'] })
            }}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className="text-gray-500" />
          </button>
          <label className="flex items-center gap-1.5 text-sm text-gray-500" title="Optional. Sets the run date for CSV back-fills. Ignored when the report already has a timestamp.">
            Run date
            <input
              type="date"
              value={runDate}
              onChange={e => setRunDate(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </label>
          <label className={`flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg cursor-pointer transition-colors ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {uploading ? 'Uploading…' : 'Upload ZIP / CSV'}
            <input ref={fileRef} type="file" accept=".zip,.csv" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        </div>
      </div>

      {uploadError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {uploadError}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={32} className="animate-spin text-gray-400" />
        </div>
      ) : readyCycles.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Zap size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No smoke runs yet. Upload a pipeline ZIP to get started.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Latest run summary */}
          {latest && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard label="Latest Pass Rate" value={`${passRate(latest)}%`} valueClass={rateColor(passRate(latest))} sub={runLabel(latest)} />
              <SummaryCard label="Tests" value={String(latest.total_tests)} valueClass="text-gray-900" sub={`${readyCycles.length} runs recorded`} />
              <SummaryCard label="Failing" value={String(latest.failed)} valueClass={latest.failed > 0 ? 'text-red-600' : 'text-gray-900'} sub="in latest run" />
              <SummaryCard label="Pending" value={String(latest.pending)} valueClass={latest.pending > 0 ? 'text-yellow-600' : 'text-gray-900'} sub="in latest run" />
            </div>
          )}

          {/* Range selector — keeps charts readable as history grows */}
          {chronoAll.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-gray-500 font-medium">Show:</span>
              {RANGE_OPTIONS.map(opt => (
                <button
                  key={String(opt)}
                  onClick={() => setRangeLimit(opt)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    rangeLimit === opt
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-brand-400'
                  }`}
                >
                  {opt === 'all' ? 'All' : `Last ${opt}`}
                </button>
              ))}
              <span className="text-gray-400 ml-1">Showing {chrono.length} of {chronoAll.length} runs</span>
            </div>
          )}

          {/* Pass rate trend */}
          {trendData.length > 1 && (
            <Section title="Pass Rate % Over Runs">
              <div className="overflow-x-auto">
                <div style={{ width: chartWidth(trendData.length, 48), minWidth: '100%', height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 24, right: 24, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval={0} angle={-30} textAnchor="end" height={56} />
                      <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: '#6b7280' }} />
                      <Tooltip formatter={(v: number) => `${v}%`} />
                      <Line type="monotone" dataKey="Pass Rate (%)" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 4, fill: '#f59e0b', strokeWidth: 0 }} activeDot={{ r: 6 }}>
                        <LabelList dataKey="Pass Rate (%)" position="top" formatter={(v: number) => `${v}%`} style={{ fontSize: 11, fontWeight: 700, fill: '#b45309' }} />
                      </Line>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Section>
          )}

          {/* Module health matrix */}
          {matrix.modules.length > 0 && (
            <Section title="Module Health (pass rate per run)">
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse w-max min-w-full">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-gray-50 border border-gray-200 px-3 py-2 text-left font-semibold text-gray-700 min-w-[160px]">Module</th>
                      {matrix.runs.map(run => (
                        <th key={run.id} className="bg-gray-50 border border-gray-200 px-3 py-2 text-center font-semibold text-gray-700 whitespace-nowrap">
                          {runLabel(run)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.modules.map(mod => (
                      <tr key={mod} className="hover:bg-gray-50">
                        <td className="sticky left-0 z-10 bg-white border border-gray-200 px-3 py-2 font-medium text-gray-800">{mod}</td>
                        {matrix.runs.map(run => {
                          const cell = matrix.perCycle[run.id]?.[mod]
                          if (!cell) return <td key={run.id} className="border border-gray-200 px-2 py-1.5 text-center text-gray-300">—</td>
                          const rate = cell.total > 0 ? Math.round((cell.passed / cell.total) * 100) : 0
                          const bg = rate >= 90 ? '#dcfce7' : rate >= 70 ? '#fef9c3' : '#fee2e2'
                          const fg = rate >= 90 ? '#15803d' : rate >= 70 ? '#a16207' : '#b91c1c'
                          return (
                            <td key={run.id} className="border border-gray-200 px-2 py-1.5 text-center" title={`${cell.passed}/${cell.total} passed`}>
                              <span className="inline-block px-2 py-0.5 rounded font-semibold" style={{ background: bg, color: fg }}>
                                {rate}%
                              </span>
                              <div className="text-[10px] text-gray-400 mt-0.5">{cell.passed}/{cell.total}</div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Failure distribution by triage type */}
          {triageTypesByFreq.length > 0 && (
            <Section title="Failure Distribution by Triage Type Over Runs">
              <div className="overflow-x-auto">
                <div style={{ width: chartWidth(failureDistData.length, 56), minWidth: '100%', height: 340 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={failureDistData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval={0} angle={-30} textAnchor="end" height={56} />
                      <YAxis tick={{ fontSize: 11 }} width={35} allowDecimals={false} />
                      <Tooltip />
                      <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 11, paddingLeft: 16 }} />
                      {triageTypesByFreq.map(t => (
                        <Bar key={t} dataKey={t} stackId="a" fill={triageColors[t] ?? '#cbd5e1'} maxBarSize={44} />
                      ))}
                      <Bar dataKey="_zero" stackId="a" fill="transparent" legendType="none" isAnimationActive={false}>
                        <LabelList
                          dataKey="_zero"
                          position="top"
                          content={({ x, y, width, index }) => {
                            const total = (failureDistData[index as number] as { _total?: number })?._total
                            if (!total) return null
                            return (
                              <text x={(x as number) + (width as number) / 2} y={(y as number) - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#374151">
                                {total}
                              </text>
                            )
                          }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Per-run breakdown table */}
              <div className="overflow-x-auto mt-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Run</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-600 whitespace-nowrap">Total</th>
                      {triageTypesByFreq.map(t => (
                        <th key={t} className="px-3 py-2 text-center font-semibold text-gray-600 whitespace-nowrap">
                          <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: triageColors[t] ?? '#cbd5e1' }} />
                          {t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {failureDistData.slice().reverse().map(row => (
                      <tr key={row.label as string} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{row.label as string}</td>
                        <td className="px-3 py-2 text-center font-semibold text-red-600">{(row._total as number) || '—'}</td>
                        {triageTypesByFreq.map(t => {
                          const v = (row as unknown as Record<string, number>)[t]
                          return (
                            <td key={t} className="px-3 py-2 text-center">
                              {v ? (
                                <span className="inline-block px-2 py-0.5 rounded text-xs font-medium" style={{ background: (triageColors[t] ?? '#cbd5e1') + '22', color: triageColors[t] ?? '#6b7280' }}>
                                  {v}
                                </span>
                              ) : '—'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Runs list */}
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 shadow-sm">
            <div className="px-5 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">All Runs</div>
            {cycles.map(c => (
              <Link
                key={c.id}
                to={`/cycles/${c.id}`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group"
              >
                <StatusIcon status={c.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{runLabel(c)}</span>
                    {c.status === 'error' && (
                      <span className="text-xs text-red-500 truncate max-w-xs">{c.error_message}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(c.uploaded_at).toLocaleString()}</p>
                </div>
                {c.status === 'ready' && (
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-500">{c.total_tests} tests</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500 rounded-full" style={{ width: `${passRate(c)}%` }} />
                      </div>
                      <span className={`font-medium ${rateColor(passRate(c))}`}>{passRate(c)}%</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-green-600">{c.passed} passed</span>
                      <span className="text-red-600">{c.failed} failed</span>
                      {c.pending > 0 && <span className="text-yellow-600">{c.pending} pending</span>}
                    </div>
                  </div>
                )}
                <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, valueClass, sub }: { label: string; value: string; valueClass: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${valueClass}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5 truncate">{sub}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 className="text-base font-semibold text-gray-800 mb-4">{title}</h2>
      {children}
    </div>
  )
}
