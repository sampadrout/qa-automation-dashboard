import JSZip from 'jszip'

export interface ParsedRow {
  row_num: number | null
  module: string | null
  file: string | null
  suites: string | null
  test_title: string | null
  full_title: string | null
  state: string
  duration_s: number | null
  error: string | null
  triage_type: string | null
  triage_desc: string | null
}

// Mirrors Python process_index_json
function processIndexJson(data: Record<string, unknown>, moduleName: string): ParsedRow[] {
  const rows: ParsedRow[] = []

  function pushTests(tests: Record<string, unknown>[], currentFile: string, suiteTitle: string) {
    for (const test of tests) {
      const duration = (test.duration as number) ?? 0
      const err = (test.err as Record<string, string>) ?? {}
      rows.push({
        row_num: null,
        module: moduleName,
        file: currentFile,
        suites: suiteTitle,
        test_title: (test.title as string) ?? null,
        full_title: (test.fullTitle as string) ?? null,
        state: (test.state as string) ?? '',
        duration_s: Math.round((duration / 1000) * 100) / 100,
        error: err.message ?? null,
        triage_type: null,
        triage_desc: null,
      })
    }
  }

  function extract(suites: Record<string, unknown>[], currentFile: string, suiteTitle: string) {
    for (const suite of suites) {
      const title = (suite.title as string) || suiteTitle
      pushTests((suite.tests ?? []) as Record<string, unknown>[], currentFile, title)
      extract((suite.suites ?? []) as Record<string, unknown>[], currentFile, title)
    }
  }

  for (const result of (data.results ?? []) as Record<string, unknown>[]) {
    const file = (result.file as string) ?? ''
    const resultTitle = (result.title as string) ?? ''
    // Process tests sitting directly on the result (rootEmpty=false case)
    pushTests((result.tests ?? []) as Record<string, unknown>[], file, resultTitle)
    // Process nested suites
    extract((result.suites ?? []) as Record<string, unknown>[], file, resultTitle)
  }
  return rows
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' || s.toLowerCase() === 'nan' ? null : s
}

// Minimal CSV parser that handles quoted fields
function parseCsv(text: string): ParsedRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim())
  // Resolve a column by any of its accepted header aliases (the app's CSV export uses
  // "#" / "Triage Type" / "Triage Desc"; older/importer format uses "Row #" / "TriageType" / "TriageDesc").
  const col = (...names: string[]) => {
    for (const n of names) { const i = headers.indexOf(n); if (i >= 0) return i }
    return -1
  }
  const idxRow      = col('Row #', '#')
  const idxModule   = col('Module')
  const idxFile     = col('File')
  const idxSuites   = col('Suites')
  const idxTitle    = col('Test Title')
  const idxFull     = col('Full Title')
  const idxState    = col('State')
  const idxDuration = col('Duration (s)')
  const idxError    = col('Error')
  const idxTriage   = col('TriageType', 'Triage Type')
  const idxDesc     = col('TriageDesc', 'Triage Desc')

  const valid = new Set(['passed', 'failed', 'pending', 'skipped'])
  const rows: ParsedRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // Split respecting quoted fields
    const cells: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue }
      if (ch === ',' && !inQ) { cells.push(cur); cur = ''; continue }
      cur += ch
    }
    cells.push(cur)

    const get = (i: number) => (i >= 0 ? str(cells[i]) : null)
    const state = (get(idxState) ?? '').toLowerCase()
    if (!valid.has(state)) continue

    rows.push({
      row_num: parseInt(cells[idxRow]) || i,
      module: get(idxModule),
      file: get(idxFile),
      suites: get(idxSuites),
      test_title: get(idxTitle),
      full_title: get(idxFull),
      state,
      duration_s: parseFloat(cells[idxDuration]) || null,
      error: get(idxError),
      triage_type: get(idxTriage),
      triage_desc: get(idxDesc),
    })
  }
  return rows
}

// Parse a raw CSV string into valid test rows (used for direct .csv uploads).
export function parseCsvRows(text: string): ParsedRow[] {
  const valid = new Set(['passed', 'failed', 'pending', 'skipped'])
  return parseCsv(text).filter(r => valid.has(r.state))
}

export async function extractZip(file: File): Promise<{ cycleName: string; rows: ParsedRow[]; startedAt: string | null }> {
  const cycleName = file.name.replace(/\.zip$/i, '')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  const all = Object.keys(zip.files)
  const csvFiles  = all.filter(f => f.endsWith('.csv')        && !zip.files[f].dir)
  const jsonFiles = all.filter(f => f.endsWith('index.json')  && !zip.files[f].dir)

  let rows: ParsedRow[] = []
  let startedAt: string | null = null

  if (csvFiles.length > 0) {
    const content = await zip.files[csvFiles[0]].async('string')
    rows = parseCsv(content)
  } else if (jsonFiles.length > 0) {
    for (const jf of jsonFiles) {
      const parts = jf.split('/')
      const moduleName = parts.length >= 2 ? parts[parts.length - 2] : 'unknown'
      const content = await zip.files[jf].async('string')
      const data = JSON.parse(content) as Record<string, unknown>
      const start = (data.stats as { start?: string } | undefined)?.start
      if (start && (!startedAt || start < startedAt)) startedAt = start
      rows.push(...processIndexJson(data, moduleName))
    }
    rows.forEach((r, i) => { r.row_num = i + 1 })
  } else {
    throw new Error('No CSV or index.json files found inside the ZIP')
  }

  const valid = new Set(['passed', 'failed', 'pending', 'skipped'])
  rows = rows.filter(r => valid.has(r.state))

  if (rows.length === 0) throw new Error('No valid test rows found in ZIP')
  return { cycleName, rows, startedAt }
}
