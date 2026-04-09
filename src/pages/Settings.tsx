import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Check, X, Loader2, ShieldAlert, GripVertical } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTriageTypes, useIsAdmin, type TriageTypeRow } from '@/lib/hooks'

const COLOR_PALETTE = [
  '#9ca3af', '#fbbf24', '#f59e0b', '#ef4444', '#dc2626',
  '#f97316', '#fb923c', '#a855f7', '#ec4899', '#f472b6',
  '#3b82f6', '#6366f1', '#22c55e', '#14b8a6', '#64748b',
]

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {COLOR_PALETTE.map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${value === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}

export default function Settings() {
  const isAdmin = useIsAdmin()
  const { rows } = useTriageTypes()
  const queryClient = useQueryClient()

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#9ca3af')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['triage-types'] })
  }

  async function handleAdd() {
    if (!newName.trim()) return
    setSaving(true)
    setError(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('triage_types').insert({
        name: newName.trim(),
        color: newColor,
        sort_order: rows.length,
      })
      if (error) throw error
      setAdding(false)
      setNewName('')
      setNewColor('#9ca3af')
      invalidate()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add')
    } finally {
      setSaving(false)
    }
  }

  function startEdit(row: TriageTypeRow) {
    setEditId(row.id)
    setEditName(row.name)
    setEditColor(row.color)
    setError(null)
  }

  async function handleSaveEdit() {
    if (!editName.trim() || !editId) return
    setSaving(true)
    setError(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('triage_types').update({
        name: editName.trim(),
        color: editColor,
      }).eq('id', editId)
      if (error) throw error
      setEditId(null)
      invalidate()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row: TriageTypeRow) {
    if (!confirm(`Delete "${row.name}"? Existing triaged results will keep this label.`)) return
    setDeletingId(row.id)
    setError(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('triage_types').delete().eq('id', row.id)
      if (error) throw error
      invalidate()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setDeletingId(null)
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <ShieldAlert size={40} className="text-gray-300 mb-3" />
        <p className="text-gray-500 font-medium">Admin access required</p>
        <p className="text-sm text-gray-400 mt-1">
          Ask an admin to add your user ID to the <code className="bg-gray-100 px-1 rounded">admin_users</code> table.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Triage Type Configuration</h1>
          <p className="text-sm text-gray-500 mt-1">Add, rename, or remove triage types used across all cycles</p>
        </div>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setError(null) }}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            Add Type
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100">
        {/* Add form */}
        {adding && (
          <div className="px-5 py-4 bg-blue-50 border-b border-blue-100">
            <p className="text-sm font-medium text-gray-700 mb-2">New triage type</p>
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
              placeholder="Type name…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <ColorPicker value={newColor} onChange={setNewColor} />
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleAdd}
                disabled={saving || !newName.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Add
              </button>
              <button
                onClick={() => { setAdding(false); setNewName(''); setNewColor('#9ca3af') }}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors"
              >
                <X size={14} />
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Type list */}
        {rows.map(row => (
          <div key={row.id} className="px-5 py-3.5">
            {editId === row.id ? (
              /* Edit mode */
              <div>
                <input
                  autoFocus
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setEditId(null) }}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <ColorPicker value={editColor} onChange={setEditColor} />
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleSaveEdit}
                    disabled={saving || !editName.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    Save
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <X size={14} />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* View mode */
              <div className="flex items-center gap-3">
                <GripVertical size={14} className="text-gray-300 flex-shrink-0" />
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0"
                  style={{ background: row.color + '25', color: row.color, border: `1px solid ${row.color}55` }}
                >
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: row.color }} />
                  {row.name}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => startEdit(row)}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  {row.name !== 'Untriaged' && (
                    <button
                      onClick={() => handleDelete(row)}
                      disabled={deletingId === row.id}
                      className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                      title="Delete"
                    >
                      {deletingId === row.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  )}
                </span>
              </div>
            )}
          </div>
        ))}

        {rows.length === 0 && !adding && (
          <div className="px-5 py-10 text-center text-gray-400 text-sm">
            No triage types yet. Click <strong>Add Type</strong> to create one.
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-gray-400">
        To make a user an admin, run in Supabase SQL editor:{' '}
        <code className="bg-gray-100 px-1 py-0.5 rounded">
          INSERT INTO admin_users (user_id) VALUES ('&lt;user-id&gt;');
        </code>
      </p>
    </div>
  )
}
