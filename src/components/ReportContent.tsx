import {
  LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts'
import type { Cycle } from '@/lib/types'

interface FailedRow { cycle_id: string; module: string | null; triage_type: string | null }
interface ScriptRow  { cycle_id: string; test_title: string | null; module: string | null }

interface Props {
  cycles: Cycle[]
  failed: FailedRow[]
  allTitles: ScriptRow[]
  triageColors: Record<string, string>
}

export const PAGE_W = 1080
export const PAGE_H = 720
const CHART_W = 1010
const TABLE_ROWS = 5         // max rows shown per table
const TABLE_COLS = 8         // max triage/module columns shown
const MODULE_PALETTE = ['#4f6ef7','#22c55e','#f97316','#a855f7','#ec4899','#14b8a6','#f59e0b','#64748b','#ef4444','#06b6d4']

function pct(n: number, total: number) { return total > 0 ? Math.round((n / total) * 100) : 0 }

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
const tdS: React.CSSProperties = {
  padding: '5px 10px', fontSize: 10, color: '#374151',
  borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap',
}

// Dot + label in a flex row — fixes vertical alignment in all browsers & html2canvas
function DotLabel({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
      <span>{label}</span>
    </div>
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
function Page1({ cycles, failed, triageColors, now }: Omit<Props, 'allTitles'> & { now: string }) {
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
      <PageHeader title="QA Run Status Report" sub={latest.name} now={now} page={1} total={4} />
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
                        <div style={{ width: 168, fontSize: 9, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }}>{type}</div>
                        <div style={{ flex: 1, height: 16, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${barPct}%`, background: color, borderRadius: 4, display: 'flex', alignItems: 'center', paddingLeft: 5 }}>
                            {barPct > 12 && <span style={{ fontSize: 8, fontWeight: 700, color: '#fff' }}>{count}</span>}
                          </div>
                        </div>
                        <div style={{ width: 56, display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#1e293b' }}>{count}</span>
                          <span style={{ fontSize: 8, fontWeight: 600, background: color + '20', color, borderRadius: 8, padding: '1px 4px' }}>{ofFail}%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
            }
          </Card>

          {/* Gauge */}
          <Card style={{ width: 196, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <DotLabel color={color} label={label} />
                  <span style={{ fontSize: 11, fontWeight: 700, color }}>{val.toLocaleString()}</span>
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
function Page2({ cycles, now }: { cycles: Cycle[]; now: string }) {
  const passRateData = cycles.map(c => ({
    label: fmtDate(c.name),
    'Pass Rate (%)': c.total_tests > 0 ? Math.round((c.passed / c.total_tests) * 1000) / 10 : 0,
  }))

  // Table: latest TABLE_ROWS cycles, newest first
  const tableRows = [...cycles].reverse().slice(0, TABLE_ROWS)

  return (
    <div data-page="2" style={pageBase}>
      <PageHeader title="Pass Rate Trend" sub="All cycles — pass rate over time" now={now} page={2} total={4} />
      <div style={{ padding: '12px 22px 30px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card>
          <CardTitle>Pass Rate % Over Time</CardTitle>
          <LineChart width={CHART_W} height={230} data={passRateData} margin={{ top: 16, right: 16, left: 0, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} />
            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10, fill: '#64748b' }} width={38} />
            <Tooltip formatter={(v: number) => [`${v}%`, 'Pass Rate']} />
            <Line type="monotone" dataKey="Pass Rate (%)" stroke="#2563eb" strokeWidth={2.5}
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
function Page3({ cycles, failed, triageColors, now }: Omit<Props, 'allTitles'> & { now: string }) {
  const cycleMap = Object.fromEntries(cycles.map(c => [c.id, c.name]))

  // Top triage types by total count, capped for table columns
  const triageCounts: Record<string, number> = {}
  failed.forEach(r => { const t = r.triage_type || 'Untriaged'; triageCounts[t] = (triageCounts[t] || 0) + 1 })
  const allTriageTypes = Object.entries(triageCounts).sort((a, b) => b[1] - a[1]).map(([t]) => t)
  const tableTriageTypes = allTriageTypes.slice(0, TABLE_COLS) // top N for table columns

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
      <PageHeader title="Failure Distribution" sub="Triage type breakdown across all cycles" now={now} page={3} total={4} />
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
              <Bar key={t} dataKey={t} stackId="a" fill={triageColors[t] ?? '#cbd5e1'} />
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
          <CardTitle>
            Date-wise Triage Breakdown (Latest {tableRows.length} · Top {tableTriageTypes.length} types)
          </CardTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ ...thS, textAlign: 'left' }}>Date</th>
                <th style={{ ...thS, textAlign: 'center' }}>Total</th>
                {tableTriageTypes.map(t => (
                  <th key={t} style={{ ...thS, textAlign: 'left' }}>
                    <DotLabel color={triageColors[t] ?? '#9ca3af'} label={t} />
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
                          ? <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 600, background: (triageColors[t] ?? '#9ca3af') + '22', color: triageColors[t] ?? '#6b7280' }}>{counts[t]}</span>
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

// ── Page 4: New Scripts ───────────────────────────────────────────────────────
function Page4({ cycles, allTitles, now }: { cycles: Cycle[]; allTitles: ScriptRow[]; now: string }) {
  const cycleMap = Object.fromEntries(cycles.map(c => [c.id, c.name]))
  const datesSorted = cycles.map(c => c.name)

  const titleFirstSeen: Record<string, { date: string; module: string }> = {}
  allTitles.forEach(r => {
    if (!r.test_title) return
    const date = cycleMap[r.cycle_id]; if (!date) return
    const ex = titleFirstSeen[r.test_title]
    if (!ex || date < ex.date) titleFirstSeen[r.test_title] = { date, module: r.module || '(none)' }
  })

  const modules = [...new Set(Object.values(titleFirstSeen).map(v => v.module))].sort()
  const tableModules = modules.slice(0, TABLE_COLS)
  const moduleColors = Object.fromEntries(modules.map((m, i) => [m, MODULE_PALETTE[i % MODULE_PALETTE.length]]))

  const newByDateMod: Record<string, Record<string, number>> = {}
  datesSorted.forEach(d => { newByDateMod[d] = {} })
  Object.values(titleFirstSeen).forEach(({ date, module: mod }) => {
    if (!newByDateMod[date]) newByDateMod[date] = {}
    newByDateMod[date][mod] = (newByDateMod[date][mod] || 0) + 1
  })

  let cumulative = 0
  const chartData = datesSorted.slice(1).map(date => {
    const mods = newByDateMod[date] ?? {}
    const total = Object.values(mods).reduce((a, b) => a + b, 0)
    cumulative += total
    return { label: fmtDate(date), ...mods, 'Cumulative Total': cumulative, _total: total }
  })

  const allTableDates = datesSorted.slice(1).reverse()
  const tableDates = allTableDates.slice(0, TABLE_ROWS)

  return (
    <div data-page="4" style={pageBase}>
      <PageHeader title="New Scripts Added" sub="First-seen test scripts per run by module" now={now} page={4} total={4} />
      <div style={{ padding: '12px 22px 30px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card>
          <CardTitle>New Scripts Per Run by Module</CardTitle>
          <ComposedChart width={CHART_W} height={218} data={chartData} margin={{ top: 10, right: 40, left: 0, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} />
            {modules.map(m => (
              <Bar key={m} yAxisId="left" dataKey={m} stackId="a" fill={moduleColors[m]} />
            ))}
            <Line yAxisId="right" type="monotone" dataKey="Cumulative Total" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </Card>

        <Card>
          <CardTitle>
            New Scripts Per Date by Module (Latest {tableDates.length} · Top {tableModules.length} modules)
          </CardTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ ...thS, textAlign: 'left' }}>Date</th>
                <th style={{ ...thS, textAlign: 'center' }}>Total New</th>
                {tableModules.map(m => (
                  <th key={m} style={{ ...thS, textAlign: 'left' }}>
                    <DotLabel color={moduleColors[m]} label={m} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableDates.map((date, i) => {
                const mods = newByDateMod[date] ?? {}
                const total = Object.values(mods).reduce((a, b) => a + b, 0)
                return (
                  <tr key={date} style={{ background: i % 2 === 1 ? '#f8fafc' : '#fff' }}>
                    <td style={{ ...tdS, fontWeight: 600 }}>{date}</td>
                    <td style={{ ...tdS, textAlign: 'center', fontWeight: 700, color: '#2563eb' }}>{total || '—'}</td>
                    {tableModules.map(m => (
                      <td key={m} style={{ ...tdS, textAlign: 'center' }}>
                        {mods[m]
                          ? <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 600, background: moduleColors[m] + '22', color: moduleColors[m] }}>{mods[m]}</span>
                          : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <RowNote shown={tableDates.length} total={allTableDates.length} />
        </Card>
      </div>
      <PageFooter label="New Scripts" />
    </div>
  )
}

// ── Root export ───────────────────────────────────────────────────────────────
export default function ReportContent({ cycles, failed, allTitles, triageColors }: Props) {
  const now = new Date().toLocaleString()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <Page1 cycles={cycles} failed={failed} triageColors={triageColors} now={now} />
      <Page2 cycles={cycles} now={now} />
      <Page3 cycles={cycles} failed={failed} triageColors={triageColors} now={now} />
      <Page4 cycles={cycles} allTitles={allTitles} now={now} />
    </div>
  )
}
