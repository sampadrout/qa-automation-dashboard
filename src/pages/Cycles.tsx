import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, RefreshCw, CheckCircle2, XCircle, Clock, Loader2, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Cycle } from '@/lib/types'

function StatusIcon({ status }: { status: string }) {
  if (status === 'ready')      return <CheckCircle2 size={16} className="text-green-500" />
  if (status === 'error')      return <XCircle size={16} className="text-red-500" />
  if (status === 'processing') return <Loader2 size={16} className="text-yellow-500 animate-spin" />
  return <Clock size={16} className="text-gray-400" />
}

export default function Cycles() {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const { data: cycles = [], isLoading } = useQuery<Cycle[]>({
    queryKey: ['cycles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cycles')
        .select('*')
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return data
    },
    refetchInterval: 5000, // poll while processing
  })

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.zip')) {
      setUploadError('Only .zip files are accepted.')
      return
    }

    setUploading(true)
    setUploadError(null)

    try {
      // Send ZIP directly to the edge function as FormData — no Storage needed.
      const formData = new FormData()
      formData.append('file', file)

      const { error: fnErr } = await supabase.functions.invoke('process-zip', {
        body: formData,
      })
      if (fnErr) throw new Error((fnErr as { message?: string }).message ?? 'Processing failed')

      queryClient.invalidateQueries({ queryKey: ['cycles'] })
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const passRate = (c: Cycle) =>
    c.total_tests > 0 ? Math.round((c.passed / c.total_tests) * 100) : 0

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Test Cycles</h1>
          <p className="text-sm text-gray-500 mt-1">Upload a ZIP to create a new cycle</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['cycles'] })}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className="text-gray-500" />
          </button>
          <label className={`flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg cursor-pointer transition-colors ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {uploading ? 'Uploading…' : 'Upload ZIP'}
            <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={handleUpload} disabled={uploading} />
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
      ) : cycles.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Upload size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No cycles yet. Upload a ZIP to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 shadow-sm">
          {cycles.map(c => (
            <Link
              key={c.id}
              to={`/cycles/${c.id}`}
              className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group"
            >
              <StatusIcon status={c.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{c.name}</span>
                  {c.status === 'error' && (
                    <span className="text-xs text-red-500 truncate max-w-xs">{c.error_message}</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(c.uploaded_at).toLocaleString()}
                </p>
              </div>
              {c.status === 'ready' && (
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-500">{c.total_tests} tests</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full"
                        style={{ width: `${passRate(c)}%` }}
                      />
                    </div>
                    <span className={`font-medium ${passRate(c) >= 90 ? 'text-green-600' : passRate(c) >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {passRate(c)}%
                    </span>
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
      )}
    </div>
  )
}
