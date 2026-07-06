import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts'
import type { Cycle } from '@/lib/types'

interface FailedRow     { cycle_id: string; module: string | null; triage_type: string | null }
interface ScriptRow     { cycle_id: string; test_title: string | null; module: string | null }
interface ModuleCountRow { cycle_id: string; module: string; test_count: number }
interface SmokeResultRow { cycle_id: string; module: string | null; state: string | null; triage_type: string | null }

interface Props {
  cycles: Cycle[]
  failed: FailedRow[]
  allTitles: ScriptRow[]
  moduleCounts: ModuleCountRow[]
  triageColors: Record<string, string>
  smokeCycles?: Cycle[]
  smokeResults?: SmokeResultRow[]
}

export const PAGE_W = 1080
export const PAGE_H = 720
const CHART_W = 1010
const TABLE_ROWS = 5          // max rows shown per table
const TABLE_COLS_TRIAGE = 6   // triage type names are long — keep fewer columns
const TABLE_COLS_MODULE  = 9  // module names are short — fit more columns
const MODULE_PALETTE = ['#4f6ef7','#22c55e','#f97316','#a855f7','#ec4899','#14b8a6','#f59e0b','#64748b','#ef4444','#06b6d4']

function pct(n: number, total: number) { return total > 0 ? Math.round((n / total) * 100) : 0 }
function trunc(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s }

function fmtDate(d: string) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (d.includes('-')) {
    const p = d.split('-')
    if (p.length >= 3) { const m = parseInt(p[1]); if (m >= 1 && m <= 12) return `${months[m-1]} ${parseInt(p[2])}` }
  }
  const match = d.match(/^(\d{4})(\d{2})(\d{2})/)
  if (match) { const m = parseInt(match[2]); if (m >= 1 && m <= 12) return `${months[m-1]} ${parseInt(match[3])}` }
  return d
}

// ── Shared style primitives ───────────────────────────────────────────────────
const pageBase: React.CSSProperties = {
  width: PAGE_W, height: PAGE_H,
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  background: '#f1f5f9', overflow: 'hidden',
  boxSizing: 'border-box', position: 'relative',
}

const thS: React.CSSProperties = {
  padding: '6px 10px', fontSize: 10, fontWeight: 700, color: '#475569',
  background: '#f8fafc', borderBottom: '2px solid #e2e8f0',
  whiteSpace: 'nowrap',
}
// Applied to variable-width triage/module columns — maxWidth prevents page overflow;
// text truncation handled in JS (DotLabel maxChars) since html2canvas ignores text-overflow
const thColS: React.CSSProperties = {
  ...thS, maxWidth: 110, whiteSpace: 'nowrap',
}
const tdS: React.CSSProperties = {
  padding: '5px 10px', fontSize: 10, color: '#374151',
  borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap',
}

// Dot + label — pure inline-block flow; avoids flex-in-table-cell which html2canvas misrenders
function DotLabel({ color, label, maxChars = 16 }: { color: string; label: string; maxChars?: number }) {
  const text = label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label
  return (
    <span style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
      <span style={{
        display: 'inline-block',
        width: 8, height: 8,
        borderRadius: 4,          // fixed px — '50%' can misrender in html2canvas
        background: color,
        verticalAlign: 'middle',
        marginRight: 5,
        position: 'relative', top: -1,
      }} />
      <span style={{ verticalAlign: 'middle' }}>{text}</span>
    </span>
  )
}

function RowNote({ shown, total }: { shown: number; total: number }) {
  if (shown >= total) return null
  return (
    <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 6, textAlign: 'right', fontStyle: 'italic' }}>
      Showing latest {shown} of {total} runs
    </div>
  )
}

// ── Layout helpers ────────────────────────────────────────────────────────────
function PageHeader({ title, sub, now, page, total }: { title: string; sub: string; now: string; page: number; total: number }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 65%, #3b82f6 100%)',
      padding: '12px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{title}</div>
        <div style={{ fontSize: 10, color: '#93c5fd', marginTop: 1 }}>{sub}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 9, color: '#bfdbfe' }}>{now} · Page {page} of {total}</div>
      </div>
    </div>
  )
}

function PageFooter({ label }: { label: string }) {
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      padding: '5px 28px', background: '#e2e8f0',
      display: 'flex', justifyContent: 'space-between',
    }}>
      <span style={{ fontSize: 9, color: '#64748b' }}>QA Automation Dashboard · Confidential</span>
      <span style={{ fontSize: 9, color: '#64748b' }}>{label}</span>
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', ...style }}>
      {children}
    </div>
  )
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#1e293b', marginBottom: 8, paddingBottom: 5, borderBottom: '1px solid #f1f5f9' }}>
      {children}
    </div>
  )
}

// ── Page 1: Executive Summary ─────────────────────────────────────────────────
function Page1({ cycles, failed, triageColors, now, total }: Omit<Props, 'allTitles' | 'moduleCounts' | 'smokeCycles' | 'smokeResults'> & { now: string; total: number }) {
  const latest = cycles[cycles.length - 1]
  if (!latest) return null

  const passRate = pct(latest.passed, latest.total_tests)
  const failTotal = latest.failed + latest.pending
  const rateColor = passRate >= 90 ? '#16a34a' : passRate >= 70 ? '#d97706' : '#dc2626'

  const triageCounts: Record<string, number> = {}
  failed.filter(r => r.cycle_id === latest.id).forEach(r => {
    const t = r.triage_type || 'Untriaged'
    triageCounts[t] = (triageCounts[t] || 0) + 1
  })
  const sortedTriage = Object.entries(triageCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const maxCount = sortedTriage[0]?.[1] ?? 1

  const r = 64, cx = 80, cy = 80
  const circ = Math.PI * r
  const arcOffset = circ * (1 - passRate / 100)

  return (
    <div data-page="1" style={pageBase}>
      <PageHeader title="XR Pay - QA Run Status Report" sub={latest.name} now={now} page={1} total={total} />
      <div style={{ padding: '12px 22px 30px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* KPI row */}
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { label: 'Total Tests',    value: latest.total_tests, color: '#2563eb', sub: '' },
            { label: 'Passed',         value: latest.passed,      color: '#16a34a', sub: `${pct(latest.passed, latest.total_tests)}% pass rate` },
            { label: 'Failed',         value: latest.failed,      color: '#dc2626', sub: `${pct(latest.failed, latest.total_tests)}% of run` },
            { label: 'Pending',        value: latest.pending,     color: '#d97706', sub: `${pct(latest.pending, latest.total_tests)}% of run` },
            { label: 'Total Failures', value: failTotal,          color: '#7c3aed', sub: 'failed + pending' },
          ].map(({ label, value, color, sub }) => (
            <div key={label} style={{
              flex: 1, background: '#fff', borderRadius: 10, padding: '10px 14px',
              borderTop: `3px solid ${color}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1.1, marginTop: 3 }}>{value.toLocaleString()}</div>
              {sub && <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
            </div>
          ))}
        </div>

        {/* Two-column */}
        <div style={{ display: 'flex', gap: 12 }}>
          <Card style={{ flex: 1 }}>
            <CardTitle>Failure Triage Breakdown — {latest.name}</CardTitle>
            {sortedTriage.length === 0
              ? <div style={{ fontSize: 11, color: '#94a3b8' }}>No failures recorded</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {sortedTriage.map(([type, count]) => {
                    const color = triageColors[type] ?? '#9ca3af'
                    const barPct = Math.round((count / maxCount) * 100)
                    const ofFail = failTotal > 0 ? Math.round((count / failTotal) * 100) : 0
                    return (
                      <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 168, fontSize: 9, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap', flexShrink: 0 }}>{trunc(type, 24)}</div>
                        <div style={{ flex: 1, height: 16, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                          {/* paddingTop centres 8px text in 16px bar — most reliable in html2canvas */}
                          <div style={{
                            height: 16, width: `${barPct}%`, background: color, borderRadius: 4,
                            boxSizing: 'border-box', paddingTop: 3, paddingLeft: 5,
                          }}>
                            {barPct > 12 && (
                              <span style={{ fontSize: 8, fontWeight: 700, color: '#fff' }}>{count}</span>
                            )}
                          </div>
                        </div>
                        <div style={{ width: 56, display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#1e293b' }}>{count}</span>
                          {/* fixed height + paddingTop + border-box = reliable centering in html2canvas */}
                          <span style={{ fontSize: 8, fontWeight: 700, color, minWidth: 26, display: 'inline-block', textAlign: 'right' }}>{ofFail}%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
            }
          </Card>

          {/* Gauge */}
          <Card style={{ width: 230, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <CardTitle>Run Health</CardTitle>
            <svg width={cx * 2} height={cy + 12} viewBox={`0 0 ${cx * 2} ${cy + 12}`}>
              <path d={`M ${cx-r},${cy} A ${r},${r} 0 0 1 ${cx+r},${cy}`} fill="none" stroke="#e2e8f0" strokeWidth={13} strokeLinecap="round" />
              <path d={`M ${cx-r},${cy} A ${r},${r} 0 0 1 ${cx+r},${cy}`} fill="none" stroke={rateColor} strokeWidth={13} strokeLinecap="round"
                strokeDasharray={`${circ}`} strokeDashoffset={`${arcOffset}`} />
              <text x={cx} y={cy - 8} textAnchor="middle" fontSize={22} fontWeight={800} fill={rateColor}>{passRate}%</text>
              <text x={cx} y={cy + 4} textAnchor="middle" fontSize={8} fill="#94a3b8">Pass Rate</text>
            </svg>
            <div style={{ width: '100%', marginTop: 6 }}>
              {[{ label: 'Passed', val: latest.passed, color: '#16a34a' }, { label: 'Failed', val: latest.failed, color: '#dc2626' }, { label: 'Pending', val: latest.pending, color: '#d97706' }].map(({ label, val, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #f1f5f9', minWidth: 0 }}>
                  <DotLabel color={color} label={label} maxChars={99} />
                  <span style={{ fontSize: 11, fontWeight: 700, color, flexShrink: 0, paddingLeft: 8 }}>{val.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div style={{
              marginTop: 10, padding: '4px 12px', borderRadius: 20,
              background: passRate >= 90 ? '#dcfce7' : passRate >= 70 ? '#fef9c3' : '#fee2e2',
              color: passRate >= 90 ? '#15803d' : passRate >= 70 ? '#92400e' : '#991b1b',
              fontSize: 10, fontWeight: 700,
            }}>
              {passRate >= 90 ? 'HEALTHY' : passRate >= 70 ? 'NEEDS ATTENTION' : 'CRITICAL'}
            </div>
          </Card>
        </div>
      </div>
      <PageFooter label={latest.name} />
    </div>
  )
}

// ── Page 2: Pass Rate Trend ───────────────────────────────────────────────────
function Page2({ cycles, now, total }: { cycles: Cycle[]; now: string; total: number }) {
  const passRateData = cycles.map(c => ({
    label: fmtDate(c.name),
    'Pass Rate (%)': c.total_tests > 0 ? Math.round((c.passed / c.total_tests) * 1000) / 10 : 0,
  }))

  // Table: latest TABLE_ROWS cycles, newest first
  const tableRows = [...cycles].reverse().slice(0, TABLE_ROWS)

  return (
    <div data-page="2" style={pageBase}>
      <PageHeader title="Pass Rate Trend" sub="All cycles — pass rate over time" now={now} page={2} total={total} />
      <div style={{ padding: '12px 22px 30px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card>
          <CardTitle>Pass Rate % Over Time</CardTitle>
          <LineChart width={CHART_W} height={230} data={passRateData} margin={{ top: 16, right: 16, left: 0, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} />
            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10, fill: '#64748b' }} width={38} />
            <Tooltip formatter={(v: number) => [`${v}%`, 'Pass Rate']} />
            <Line type="monotone" dataKey="Pass Rate (%)" stroke="#2563eb" strokeWidth={2.5}
              isAnimationActive={false}
              dot={{ r: 4, fill: '#2563eb', strokeWidth: 0 }} activeDot={{ r: 6 }}>
              <LabelList dataKey="Pass Rate (%)" position="top"
                formatter={(v: number) => `${v}%`}
                style={{ fontSize: 9, fontWeight: 700, fill: '#1d4ed8' }} />
            </Line>
          </LineChart>
        </Card>

        <Card>
          <CardTitle>Run Summary (Latest {tableRows.length})</CardTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Date', 'Total', 'Passed', 'Failed', 'Pending', 'Pass Rate'].map(h => (
                  <th key={h} style={{ ...thS, textAlign: h === 'Date' ? 'left' : 'center' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((c, i) => {
                const rate = pct(c.passed, c.total_tests)
                return (
                  <tr key={c.id} style={{ background: i % 2 === 1 ? '#f8fafc' : '#fff' }}>
                    <td style={{ ...tdS, fontWeight: 600 }}>{c.name}</td>
                    <td style={{ ...tdS, textAlign: 'center' }}>{c.total_tests}</td>
                    <td style={{ ...tdS, textAlign: 'center', color: '#16a34a', fontWeight: 600 }}>{c.passed}</td>
                    <td style={{ ...tdS, textAlign: 'center', color: '#dc2626', fontWeight: 600 }}>{c.failed}</td>
                    <td style={{ ...tdS, textAlign: 'center', color: '#d97706' }}>{c.pending || '—'}</td>
                    <td style={{ ...tdS, textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <div style={{ width: 52, height: 5, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
                          <div style={{ height: '100%', width: `${rate}%`, borderRadius: 3, background: rate >= 90 ? '#16a34a' : rate >= 70 ? '#d97706' : '#dc2626' }} />
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, minWidth: 30, color: rate >= 90 ? '#16a34a' : rate >= 70 ? '#d97706' : '#dc2626' }}>{rate}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <RowNote shown={tableRows.length} total={cycles.length} />
        </Card>
      </div>
      <PageFooter label="Pass Rate Trend" />
    </div>
  )
}

// ── Page 3: Failure Distribution ──────────────────────────────────────────────
function Page3({ cycles, failed, triageColors, now, total }: Omit<Props, 'allTitles' | 'moduleCounts' | 'smokeCycles' | 'smokeResults'> & { now: string; total: number }) {
  const cycleMap = Object.fromEntries(cycles.map(c => [c.id, c.name]))

  // Top triage types by total count, capped for table columns
  const triageCounts: Record<string, number> = {}
  failed.forEach(r => { const t = r.triage_type || 'Untriaged'; triageCounts[t] = (triageCounts[t] || 0) + 1 })
  const allTriageTypes = Object.entries(triageCounts).sort((a, b) => b[1] - a[1]).map(([t]) => t)
  const tableTriageTypes = allTriageTypes.slice(0, TABLE_COLS_TRIAGE) // top N for table columns

  const byDate: Record<string, Record<string, number>> = {}
  cycles.forEach(c => { byDate[c.name] = {} })
  failed.forEach(r => {
    const date = cycleMap[r.cycle_id]; if (!date) return
    const t = r.triage_type || 'Untriaged'
    byDate[date][t] = (byDate[date][t] || 0) + 1
  })

  const chartData = Object.entries(byDate).map(([date, counts]) => ({
    label: fmtDate(date), date,
    _total: cycles.find(c => c.name === date)?.failed ?? 0,
    _zero: 0, ...counts,
  }))

  // Table: latest TABLE_ROWS dates, newest first
  const allTableRows = Object.entries(byDate).reverse()
  const tableRows = allTableRows.slice(0, TABLE_ROWS)

  return (
    <div data-page="3" style={pageBase}>
      <PageHeader title="Failure Distribution" sub="Triage type breakdown across all cycles" now={now} page={3} total={total} />
      <div style={{ padding: '12px 22px 30px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card>
          <CardTitle>Failure Distribution by Triage Type Over Time</CardTitle>
          <BarChart width={CHART_W} height={218} data={chartData} margin={{ top: 6, right: 16, left: 0, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={30} />
            <Tooltip labelFormatter={(_, p) => p?.[0]?.payload?.date ?? ''} />
            <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} />
            {allTriageTypes.map(t => (
              <Bar key={t} dataKey={t} stackId="a" fill={triageColors[t] ?? '#cbd5e1'} isAnimationActive={false} />
            ))}
            <Bar dataKey="_zero" stackId="a" fill="transparent" legendType="none" isAnimationActive={false}>
              <LabelList dataKey="_zero" position="top" content={({ x, y, width, index }) => {
                const total = (chartData[index as number] as { _total?: number })?._total
                if (!total) return null
                return <text x={(x as number) + (width as number) / 2} y={(y as number) - 3} textAnchor="middle" fontSize={9} fontWeight={700} fill="#1e293b">{total}</text>
              }} />
            </Bar>
          </BarChart>
        </Card>

        <Card>
          <CardTitle>Date-wise Triage Breakdown (Latest {tableRows.length} · Top {tableTriageTypes.length} types)</CardTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ ...thS, textAlign: 'left' }}>Date</th>
                <th style={{ ...thS, textAlign: 'center' }}>Total</th>
                {tableTriageTypes.map(t => (
                  <th key={t} style={{ ...thColS, maxWidth: 110, textAlign: 'left' }}>
                    <DotLabel color={triageColors[t] ?? '#9ca3af'} label={t} maxChars={14} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map(([date, counts], i) => {
                const total = Object.values(counts).reduce((a, b) => a + b, 0)
                return (
                  <tr key={date} style={{ background: i % 2 === 1 ? '#f8fafc' : '#fff' }}>
                    <td style={{ ...tdS, fontWeight: 600 }}>{date}</td>
                    <td style={{ ...tdS, textAlign: 'center', fontWeight: 700, color: '#dc2626' }}>{total || '—'}</td>
                    {tableTriageTypes.map(t => (
                      <td key={t} style={{ ...tdS, textAlign: 'center' }}>
                        {counts[t]
                          ? <span style={{ fontSize: 9, fontWeight: 700, color: triageColors[t] ?? '#6b7280' }}>{counts[t]}</span>
                          : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <RowNote shown={tableRows.length} total={allTableRows.length} />
        </Card>
      </div>
      <PageFooter label="Failure Distribution" />
    </div>
  )
}

// ── Page 4: Test Case Growth ───────────────────────────────────────────────────
function Page4({ cycles, allTitles, moduleCounts, now, total }: { cycles: Cycle[]; allTitles: ScriptRow[]; moduleCounts: ModuleCountRow[]; now: string; total: number }) {
  const cycleMap = Object.fromEntries(cycles.map(c => [c.id, c.name]))
  const datesSorted = cycles.map(c => c.name)

  // First-seen per title (RPC already returns one row per title, so just map directly)
  const titleFirstSeen: Record<string, { date: string; module: string }> = {}
  allTitles.forEach(r => {
    if (!r.test_title) return
    const date = cycleMap[r.cycle_id]; if (!date) return
    const ex = titleFirstSeen[r.test_title]
    if (!ex || date < ex.date) titleFirstSeen[r.test_title] = { date, module: r.module || '(none)' }
  })

  const modules = [...new Set(Object.values(titleFirstSeen).map(v => v.module))].sort()
  const moduleColors = Object.fromEntries(modules.map((m, i) => [m, MODULE_PALETTE[i % MODULE_PALETTE.length]]))

  // Incremental new per date × module
  const newByDateMod: Record<string, Record<string, number>> = {}
  datesSorted.forEach(d => { newByDateMod[d] = {} })
  Object.values(titleFirstSeen).forEach(({ date, module: mod }) => {
    if (!newByDateMod[date]) newByDateMod[date] = {}
    newByDateMod[date][mod] = (newByDateMod[date][mod] || 0) + 1
  })

  // Cumulative count per module per date (growth data)
  const growthData = (() => {
    const running: Record<string, number> = {}
    return datesSorted.map(date => {
      const newThisDate = newByDateMod[date] ?? {}
      Object.entries(newThisDate).forEach(([mod, n]) => { running[mod] = (running[mod] ?? 0) + n })
      return { date, label: fmtDate(date), ...Object.fromEntries(Object.entries(running)) }
    })
  })()

  // Build per-cycle per-module lookup from real counts
  // countsMap[cycle_id][module] = test_count
  const countsMap: Record<string, Record<string, number>> = {}
  moduleCounts.forEach(r => {
    if (!countsMap[r.cycle_id]) countsMap[r.cycle_id] = {}
    countsMap[r.cycle_id][r.module] = r.test_count
  })

  // All modules that appear in ANY cycle's counts (for table columns)
  const allCountModules = [...new Set(moduleCounts.map(r => r.module))].sort()
  const tableCountModules = allCountModules.slice(0, TABLE_COLS_MODULE)
  const allCountColors = Object.fromEntries(allCountModules.map((m, i) => [m, MODULE_PALETTE[i % MODULE_PALETTE.length]]))

  // Latest 5 cycles (most recent first, ordered by name desc)
  const latest5Cycles = cycles.slice().reverse().slice(0, 5)

  return (
    <div data-page="4" style={pageBase}>
      <PageHeader title="Test Case Growth" sub="Cumulative test cases per module over time" now={now} page={4} total={total} />
      <div style={{ padding: '12px 22px 30px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        <Card>
          <CardTitle>Test Case Growth Per Module Over Time</CardTitle>
          <AreaChart width={CHART_W} height={220} data={growthData} margin={{ top: 10, right: 16, left: 0, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} width={36} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} />
            {modules.map(m => (
              <Area
                key={m}
                type="monotone"
                dataKey={m}
                stackId="1"
                stroke={moduleColors[m]}
                strokeWidth={1.5}
                fill={moduleColors[m]}
                fillOpacity={0.4}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </Card>

        <Card>
          <CardTitle>Latest {latest5Cycles.length} Runs — Total Tests Per Module</CardTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ ...thS, textAlign: 'left' }}>Run</th>
                <th style={{ ...thS, textAlign: 'center' }}>Total</th>
                {tableCountModules.map(m => (
                  <th key={m} style={{ ...thColS, maxWidth: 80, textAlign: 'left' }}>
                    <DotLabel color={allCountColors[m]} label={m} maxChars={11} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {latest5Cycles.map((cycle, i) => {
                const modCounts = countsMap[cycle.id] ?? {}
                const total = cycle.total_tests
                return (
                  <tr key={cycle.id} style={{ background: i % 2 === 1 ? '#f8fafc' : '#fff' }}>
                    <td style={{ ...tdS, fontWeight: 600 }}>{cycle.name}</td>
                    <td style={{ ...tdS, textAlign: 'center', fontWeight: 700, color: '#2563eb' }}>{total.toLocaleString()}</td>
                    {tableCountModules.map(m => {
                      const val = modCounts[m] ?? 0
                      return (
                        <td key={m} style={{ ...tdS, textAlign: 'center' }}>
                          {val > 0
                            ? <span style={{ fontSize: 9, fontWeight: 700, color: allCountColors[m] }}>{val}</span>
                            : <span style={{ color: '#d1d5db' }}>—</span>}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      </div>
      <PageFooter label="Test Case Growth" />
    </div>
  )
}

// "Smoke 2026-06-28 12:00:00" → "Jun 28, 12:00"
function smokeLabel(name: string) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (m) return `${months[parseInt(m[2]) - 1]} ${parseInt(m[3])}, ${m[4]}:${m[5]}`
  return fmtDate(name)
}

const SMOKE_TREND_MAX = 14   // most-recent runs charted (keeps PDF readable)
const SMOKE_MATRIX_MAX = 6   // most-recent runs shown as matrix columns

// ── Smoke Page 1: Latest-run health + pass-rate trend ──────────────────────────
function SmokePage1({ smokeCycles, now, page, total }: { smokeCycles: Cycle[]; now: string; page: number; total: number }) {
  const chrono = smokeCycles
  const latest = chrono[chrono.length - 1]
  if (!latest) return null

  const passRate = pct(latest.passed, latest.total_tests)
  const failTotal = latest.failed + latest.pending
  const rateColor = passRate >= 90 ? '#16a34a' : passRate >= 70 ? '#d97706' : '#dc2626'

  const trend = chrono.slice(-SMOKE_TREND_MAX).map(c => ({
    label: smokeLabel(c.name),
    'Pass Rate (%)': c.total_tests > 0 ? Math.round((c.passed / c.total_tests) * 1000) / 10 : 0,
  }))

  const r = 64, cx = 80, cy = 80
  const circ = Math.PI * r
  const arcOffset = circ * (1 - passRate / 100)

  return (
    <div data-page="smoke-1" style={pageBase}>
      <PageHeader title="Smoke Tests — Health" sub={`Latest run: ${smokeLabel(latest.name)}`} now={now} page={page} total={total} />
      <div style={{ padding: '12px 22px 30px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* KPI row */}
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { label: 'Total Tests',    value: latest.total_tests, color: '#2563eb', sub: '' },
            { label: 'Passed',         value: latest.passed,      color: '#16a34a', sub: `${pct(latest.passed, latest.total_tests)}% pass rate` },
            { label: 'Failed',         value: latest.failed,      color: '#dc2626', sub: `${pct(latest.failed, latest.total_tests)}% of run` },
            { label: 'Pending',        value: latest.pending,     color: '#d97706', sub: `${pct(latest.pending, latest.total_tests)}% of run` },
            { label: 'Runs Recorded',  value: chrono.length,      color: '#7c3aed', sub: 'smoke runs' },
          ].map(({ label, value, color, sub }) => (
            <div key={label} style={{
              flex: 1, background: '#fff', borderRadius: 10, padding: '10px 14px',
              borderTop: `3px solid ${color}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1.1, marginTop: 3 }}>{value.toLocaleString()}</div>
              {sub && <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
            </div>
          ))}
        </div>

        {/* Trend + gauge */}
        <div style={{ display: 'flex', gap: 12 }}>
          <Card style={{ flex: 1 }}>
            <CardTitle>Pass Rate % Over Runs (latest {trend.length})</CardTitle>
            <LineChart width={CHART_W - 250} height={230} data={trend} margin={{ top: 16, right: 16, left: 0, bottom: 2 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#64748b' }} interval={0} angle={-20} textAnchor="end" height={44} />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10, fill: '#64748b' }} width={38} />
              <Tooltip formatter={(v: number) => [`${v}%`, 'Pass Rate']} />
              <Line type="monotone" dataKey="Pass Rate (%)" stroke="#f59e0b" strokeWidth={2.5}
                isAnimationActive={false}
                dot={{ r: 4, fill: '#f59e0b', strokeWidth: 0 }} activeDot={{ r: 6 }}>
                <LabelList dataKey="Pass Rate (%)" position="top"
                  formatter={(v: number) => `${v}%`}
                  style={{ fontSize: 9, fontWeight: 700, fill: '#b45309' }} />
              </Line>
            </LineChart>
          </Card>

          <Card style={{ width: 230, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <CardTitle>Latest Run Health</CardTitle>
            <svg width={cx * 2} height={cy + 12} viewBox={`0 0 ${cx * 2} ${cy + 12}`}>
              <path d={`M ${cx-r},${cy} A ${r},${r} 0 0 1 ${cx+r},${cy}`} fill="none" stroke="#e2e8f0" strokeWidth={13} strokeLinecap="round" />
              <path d={`M ${cx-r},${cy} A ${r},${r} 0 0 1 ${cx+r},${cy}`} fill="none" stroke={rateColor} strokeWidth={13} strokeLinecap="round"
                strokeDasharray={`${circ}`} strokeDashoffset={`${arcOffset}`} />
              <text x={cx} y={cy - 8} textAnchor="middle" fontSize={22} fontWeight={800} fill={rateColor}>{passRate}%</text>
              <text x={cx} y={cy + 4} textAnchor="middle" fontSize={8} fill="#94a3b8">Pass Rate</text>
            </svg>
            <div style={{ width: '100%', marginTop: 6 }}>
              {[{ label: 'Passed', val: latest.passed, color: '#16a34a' }, { label: 'Failed', val: latest.failed, color: '#dc2626' }, { label: 'Pending', val: latest.pending, color: '#d97706' }].map(({ label, val, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #f1f5f9', minWidth: 0 }}>
                  <DotLabel color={color} label={label} maxChars={99} />
                  <span style={{ fontSize: 11, fontWeight: 700, color, flexShrink: 0, paddingLeft: 8 }}>{val.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div style={{
              marginTop: 10, padding: '4px 12px', borderRadius: 20,
              background: passRate >= 90 ? '#dcfce7' : passRate >= 70 ? '#fef9c3' : '#fee2e2',
              color: passRate >= 90 ? '#15803d' : passRate >= 70 ? '#92400e' : '#991b1b',
              fontSize: 10, fontWeight: 700,
            }}>
              {passRate >= 90 ? 'HEALTHY' : passRate >= 70 ? 'NEEDS ATTENTION' : 'CRITICAL'} · {failTotal} failing
            </div>
          </Card>
        </div>
      </div>
      <PageFooter label="Smoke Tests — Health" />
    </div>
  )
}

// ── Smoke Page 2: Module health matrix + failure distribution ──────────────────
function SmokePage2({ smokeCycles, smokeResults, triageColors, now, page, total }: { smokeCycles: Cycle[]; smokeResults: SmokeResultRow[]; triageColors: Record<string, string>; now: string; page: number; total: number }) {
  const chrono = smokeCycles

  // Per-run per-module pass/total
  const perCycle: Record<string, Record<string, { passed: number; total: number }>> = {}
  smokeResults.forEach(r => {
    const mod = r.module || '(none)'
    if (!perCycle[r.cycle_id]) perCycle[r.cycle_id] = {}
    if (!perCycle[r.cycle_id][mod]) perCycle[r.cycle_id][mod] = { passed: 0, total: 0 }
    perCycle[r.cycle_id][mod].total += 1
    if (r.state === 'passed') perCycle[r.cycle_id][mod].passed += 1
  })
  const modules = [...new Set(smokeResults.map(r => r.module || '(none)'))].sort()
  const matrixRuns = chrono.slice(-SMOKE_MATRIX_MAX)

  // Failure distribution by triage type per run
  const failures = smokeResults.filter(r => r.state !== 'passed')
  const triageCounts: Record<string, number> = {}
  failures.forEach(r => { const t = r.triage_type || 'Untriaged'; triageCounts[t] = (triageCounts[t] || 0) + 1 })
  const allTriageTypes = Object.entries(triageCounts).sort((a, b) => b[1] - a[1]).map(([t]) => t)

  const byCycle: Record<string, Record<string, number>> = {}
  failures.forEach(r => {
    if (!byCycle[r.cycle_id]) byCycle[r.cycle_id] = {}
    const t = r.triage_type || 'Untriaged'
    byCycle[r.cycle_id][t] = (byCycle[r.cycle_id][t] || 0) + 1
  })
  const distData = chrono.slice(-SMOKE_TREND_MAX).map(c => {
    const counts = byCycle[c.id] ?? {}
    return { label: smokeLabel(c.name), _total: Object.values(counts).reduce((a, b) => a + b, 0), _zero: 0, ...counts }
  })

  return (
    <div data-page="smoke-2" style={pageBase}>
      <PageHeader title="Smoke Tests — Modules & Failures" sub="Module health and triage distribution" now={now} page={page} total={total} />
      <div style={{ padding: '12px 22px 30px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card>
          <CardTitle>Module Health — Pass Rate per Run (latest {matrixRuns.length})</CardTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ ...thS, textAlign: 'left' }}>Module</th>
                {matrixRuns.map(run => (
                  <th key={run.id} style={{ ...thS, textAlign: 'center' }}>{smokeLabel(run.name)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((mod, i) => (
                <tr key={mod} style={{ background: i % 2 === 1 ? '#f8fafc' : '#fff' }}>
                  <td style={{ ...tdS, fontWeight: 600 }}>{mod}</td>
                  {matrixRuns.map(run => {
                    const cell = perCycle[run.id]?.[mod]
                    if (!cell) return <td key={run.id} style={{ ...tdS, textAlign: 'center', color: '#d1d5db' }}>—</td>
                    const rate = cell.total > 0 ? Math.round((cell.passed / cell.total) * 100) : 0
                    const color = rate >= 90 ? '#16a34a' : rate >= 70 ? '#d97706' : '#dc2626'
                    return (
                      <td key={run.id} style={{ ...tdS, textAlign: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color }}>{rate}%</span>
                        <span style={{ fontSize: 8, color: '#94a3b8', marginLeft: 3 }}>{cell.passed}/{cell.total}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardTitle>Failure Distribution by Triage Type Over Runs</CardTitle>
          {allTriageTypes.length === 0
            ? <div style={{ fontSize: 11, color: '#94a3b8' }}>No failures recorded across smoke runs</div>
            : <BarChart width={CHART_W} height={218} data={distData} margin={{ top: 6, right: 16, left: 0, bottom: 2 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#64748b' }} interval={0} angle={-20} textAnchor="end" height={44} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={30} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} />
                {allTriageTypes.map(t => (
                  <Bar key={t} dataKey={t} stackId="a" fill={triageColors[t] ?? '#cbd5e1'} isAnimationActive={false} />
                ))}
                <Bar dataKey="_zero" stackId="a" fill="transparent" legendType="none" isAnimationActive={false}>
                  <LabelList dataKey="_zero" position="top" content={({ x, y, width, index }) => {
                    const t = (distData[index as number] as { _total?: number })?._total
                    if (!t) return null
                    return <text x={(x as number) + (width as number) / 2} y={(y as number) - 3} textAnchor="middle" fontSize={9} fontWeight={700} fill="#1e293b">{t}</text>
                  }} />
                </Bar>
              </BarChart>
          }
        </Card>
      </div>
      <PageFooter label="Smoke Tests — Modules & Failures" />
    </div>
  )
}

// ── Root export ───────────────────────────────────────────────────────────────
export default function ReportContent({ cycles, failed, allTitles, moduleCounts, triageColors, smokeCycles = [], smokeResults = [] }: Props) {
  const now = new Date().toLocaleString()
  const hasSmoke = smokeCycles.length > 0
  const total = 4 + (hasSmoke ? 2 : 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <Page1 cycles={cycles} failed={failed} triageColors={triageColors} now={now} total={total} />
      <Page2 cycles={cycles} now={now} total={total} />
      <Page3 cycles={cycles} failed={failed} triageColors={triageColors} now={now} total={total} />
      <Page4 cycles={cycles} allTitles={allTitles} moduleCounts={moduleCounts} now={now} total={total} />
      {hasSmoke && <SmokePage1 smokeCycles={smokeCycles} now={now} page={5} total={total} />}
      {hasSmoke && <SmokePage2 smokeCycles={smokeCycles} smokeResults={smokeResults} triageColors={triageColors} now={now} page={6} total={total} />}
    </div>
  )
}
