'use client'

interface TopPagesTableProps {
  topPages: Array<{ path: string; views: number }>
}

export default function TopPagesTable({ topPages }: TopPagesTableProps) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="font-semibold text-gray-900 dark:text-white">Top Pages</h2>
      </div>

      {topPages.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-10 text-center">No page data</p>
      ) : (
        <div>
          <div className="px-5 py-2.5 border-b border-gray-50 dark:border-gray-800">
            <div className="grid grid-cols-12 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide gap-4">
              <div className="col-span-9">Page</div>
              <div className="col-span-3 text-right">Views</div>
            </div>
          </div>
          {topPages.map((page) => (
            <div
              key={page.path}
              className="px-5 py-3 border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <div className="grid grid-cols-12 gap-4 items-center">
                <div className="col-span-9">
                  <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{page.path}</p>
                </div>
                <div className="col-span-3 text-right">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {page.views.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
