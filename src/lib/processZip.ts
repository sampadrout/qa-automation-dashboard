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
function processIndexJson(content: string, moduleName: string): ParsedRow[] {
  const data = JSON.parse(content)
  const rows: ParsedRow[] = []

  function extract(suites: Record<string, unknown>[], currentFile: string, suiteTitle: string) {
    for (const suite of suites) {
      const title = (suite.title as string) || suiteTitle
      for (const test of (suite.tests ?? []) as Record<string, unknown>[]) {
        const duration = (test.duration as number) ?? 0
        const err = (test.err as Record<string, string>) ?? {}
        rows.push({
          row_num: null,
          module: moduleName,
          file: currentFile,
          suites: title,
          test_title: (test.title as string) ?? null,
          full_title: (test.fullTitle as string) ?? null,
          state: (test.state as string) ?? '',
          duration_s: Math.round((duration / 1000) * 100) / 100,
          error: err.message ?? null,
          triage_type: null,
          triage_desc: null,
        })
      }
      extract((suite.suites ?? []) as Record<string, unknown>[], currentFile, title)
    }
  }

  for (const result of (data.results ?? []) as Record<string, unknown>[]) {
    extract((result.suites ?? []) as Record<string, unknown>[], (result.file as string) ?? '', '')
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
  const idx = (name: string) => headers.indexOf(name)
  const valid = new Set(['passed', 'failed', 'pending'])
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

    const get = (name: string) => str(cells[idx(name)])
    const state = (get('State') ?? '').toLowerCase()
    if (!valid.has(state)) continue

    rows.push({
      row_num: parseInt(cells[idx('Row #')]) || i,
      module: get('Module'),
      file: get('File'),
      suites: get('Suites'),
      test_title: get('Test Title'),
      full_title: get('Full Title'),
      state,
      duration_s: parseFloat(cells[idx('Duration (s)')]) || null,
      error: get('Error'),
      triage_type: get('TriageType'),
      triage_desc: get('TriageDesc'),
    })
  }
  return rows
}

export async function extractZip(file: File): Promise<{ cycleName: string; rows: ParsedRow[] }> {
  const cycleName = file.name.replace(/\.zip$/i, '')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  const all = Object.keys(zip.files)
  const csvFiles  = all.filter(f => f.endsWith('.csv')        && !zip.files[f].dir)
  const jsonFiles = all.filter(f => f.endsWith('index.json')  && !zip.files[f].dir)

  let rows: ParsedRow[] = []

  if (csvFiles.length > 0) {
    const content = await zip.files[csvFiles[0]].async('string')
    rows = parseCsv(content)
  } else if (jsonFiles.length > 0) {
    for (const jf of jsonFiles) {
      const parts = jf.split('/')
      const moduleName = parts.length >= 2 ? parts[parts.length - 2] : 'unknown'
      const content = await zip.files[jf].async('string')
      rows.push(...processIndexJson(content, moduleName))
    }
    rows.forEach((r, i) => { r.row_num = i + 1 })
  } else {
    throw new Error('No CSV or index.json files found inside the ZIP')
  }

  const valid = new Set(['passed', 'failed', 'pending'])
  rows = rows.filter(r => valid.has(r.state))

  if (rows.length === 0) throw new Error('No valid test rows found in ZIP')
  return { cycleName, rows }
}
