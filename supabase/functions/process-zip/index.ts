import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import JSZip from 'npm:jszip@3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TestRow {
  row_num: number
  module: string
  file: string
  suites: string
  test_title: string
  full_title: string
  state: string
  duration_s: number
  error: string
  triage_type: string
  triage_desc: string
}

// Parse the index.json format (mirrors Python process_index_json)
function processIndexJson(content: string, moduleName: string): TestRow[] {
  const data = JSON.parse(content)
  const rows: TestRow[] = []

  function extractTests(suites: unknown[], currentFile: string, currentSuiteTitle: string) {
    for (const suite of suites as Record<string, unknown>[]) {
      const suiteTitle = (suite.title as string) || currentSuiteTitle
      for (const test of (suite.tests ?? []) as Record<string, unknown>[]) {
        const duration = (test.duration as number) ?? 0
        const err = (test.err as Record<string, string>) ?? {}
        rows.push({
          row_num: 0,
          module: moduleName,
          file: currentFile,
          suites: suiteTitle,
          test_title: (test.title as string) ?? '',
          full_title: (test.fullTitle as string) ?? '',
          state: (test.state as string) ?? '',
          duration_s: Math.round((duration / 1000) * 100) / 100,
          error: err.message ?? '',
          triage_type: '',
          triage_desc: '',
        })
      }
      extractTests((suite.suites ?? []) as unknown[], currentFile, suiteTitle)
    }
  }

  for (const result of (data.results ?? []) as Record<string, unknown>[]) {
    extractTests((result.suites ?? []) as unknown[], (result.file as string) ?? '', '')
  }
  return rows
}

// Minimal CSV parser for the known column structure
function parseCsv(text: string): TestRow[] {
  const lines = text.split(/\r?\n/)
  if (lines.length < 2) return []

  // Strip BOM
  const rawHeader = lines[0].replace(/^\uFEFF/, '')
  const headers = rawHeader.split(',').map(h => h.trim().replace(/^"|"$/g, ''))

  const idx = (name: string) => headers.indexOf(name)
  const rows: TestRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // Simple CSV split (handles quoted fields with commas)
    const cells: string[] = []
    let cur = ''
    let inQuote = false
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]
      if (ch === '"') { inQuote = !inQuote; continue }
      if (ch === ',' && !inQuote) { cells.push(cur); cur = ''; continue }
      cur += ch
    }
    cells.push(cur)

    const get = (name: string) => (cells[idx(name)] ?? '').trim()
    const rowNum = parseInt(get('Row #')) || i
    const state = get('State').toLowerCase()
    if (!['passed', 'failed', 'pending'].includes(state)) continue

    rows.push({
      row_num: rowNum,
      module: get('Module'),
      file: get('File'),
      suites: get('Suites'),
      test_title: get('Test Title'),
      full_title: get('Full Title'),
      state,
      duration_s: parseFloat(get('Duration (s)')) || 0,
      error: get('Error'),
      triage_type: get('TriageType'),
      triage_desc: get('TriageDesc'),
    })
  }
  return rows
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')!
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { storage_path, filename } = await req.json() as { storage_path: string; filename: string }
    const cycleName = filename.replace(/\.zip$/i, '')

    // ── Create cycle row (status=processing) ──────────────────────────────────
    const { data: cycleData, error: cycleInsertErr } = await supabase
      .from('cycles')
      .insert({ name: cycleName, status: 'processing' })
      .select('id')
      .single()

    if (cycleInsertErr) throw cycleInsertErr
    const cycleId = cycleData.id

    try {
      // ── Download ZIP from storage ──────────────────────────────────────────
      const { data: fileData, error: dlErr } = await supabase.storage
        .from('test-zips')
        .download(storage_path)
      if (dlErr) throw dlErr

      const arrayBuffer = await fileData.arrayBuffer()
      const zip = await JSZip.loadAsync(arrayBuffer)

      // ── Detect content type ────────────────────────────────────────────────
      const allFiles = Object.keys(zip.files)
      const csvFiles = allFiles.filter(f => f.endsWith('.csv') && !zip.files[f].dir)
      const jsonFiles = allFiles.filter(f => f.endsWith('index.json') && !zip.files[f].dir)

      let rows: TestRow[] = []

      if (csvFiles.length > 0) {
        const csvContent = await zip.files[csvFiles[0]].async('string')
        rows = parseCsv(csvContent)
      } else if (jsonFiles.length > 0) {
        for (const jsonFile of jsonFiles) {
          const parts = jsonFile.split('/')
          const moduleName = parts.length >= 2 ? parts[parts.length - 2] : 'unknown'
          const content = await zip.files[jsonFile].async('string')
          rows.push(...processIndexJson(content, moduleName))
        }
        // Assign row numbers
        rows.forEach((r, i) => { r.row_num = i + 1 })
      } else {
        throw new Error('No CSV or index.json files found inside the ZIP')
      }

      if (rows.length === 0) throw new Error('ZIP processed but no test rows were extracted')

      // ── Insert test_results in batches ─────────────────────────────────────
      const BATCH = 500
      const insertRows = rows.map(r => ({ ...r, cycle_id: cycleId }))
      for (let i = 0; i < insertRows.length; i += BATCH) {
        const { error: insErr } = await supabase
          .from('test_results')
          .insert(insertRows.slice(i, i + BATCH))
        if (insErr) throw insErr
      }

      // ── Update cycle stats ─────────────────────────────────────────────────
      const passed  = rows.filter(r => r.state === 'passed').length
      const failed  = rows.filter(r => r.state === 'failed').length
      const pending = rows.filter(r => r.state === 'pending').length

      await supabase.from('cycles').update({
        status: 'ready',
        total_tests: rows.length,
        passed,
        failed,
        pending,
      }).eq('id', cycleId)

      return new Response(JSON.stringify({ ok: true, cycle_id: cycleId, total: rows.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch (err) {
      await supabase.from('cycles').update({
        status: 'error',
        error_message: err instanceof Error ? err.message : String(err),
      }).eq('id', cycleId)
      throw err
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
