const STATE_STYLES: Record<string, string> = {
  passed:  'bg-green-100 text-green-800',
  failed:  'bg-red-100 text-red-800',
  pending: 'bg-yellow-100 text-yellow-800',
}

export default function StateBadge({ state }: { state: string | null }) {
  const s = state ?? 'unknown'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATE_STYLES[s] ?? 'bg-gray-100 text-gray-600'}`}>
      {s}
    </span>
  )
}
