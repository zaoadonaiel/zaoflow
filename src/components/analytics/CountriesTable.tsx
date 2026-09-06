'use client'

interface CountriesTableProps {
  countries: Array<{ country: string; sessions: number }>
}

export default function CountriesTable({ countries }: CountriesTableProps) {
  const max = countries.length ? Math.max(...countries.map((c) => c.sessions)) : 0

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 sm:p-5">
      <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Top Countries</h2>

      {countries.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-6 text-center">No country data</p>
      ) : (
        <div className="space-y-3">
          {countries.map((c) => (
            <div key={c.country}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-gray-700 dark:text-gray-300">{c.country || 'Unknown'}</span>
                <span className="text-gray-500 dark:text-gray-400 font-medium">
                  {c.sessions.toLocaleString()}
                </span>
              </div>
              <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full"
                  style={{ width: max ? `${(c.sessions / max) * 100}%` : '0%' }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
