'use client'

import { Search } from 'lucide-react'

interface KeywordsTableProps {
  keywords: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>
  gscConnected: boolean
}

export default function KeywordsTable({ keywords, gscConnected }: KeywordsTableProps) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="font-semibold text-gray-900 dark:text-white">Search Keywords</h2>
      </div>

      {!gscConnected ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center px-6">
          <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
            <Search className="w-6 h-6 text-gray-400" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Connect Search Console to see keyword data
          </p>
        </div>
      ) : keywords.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-10 text-center">
          No keyword data for this range
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="px-5 py-2.5 border-b border-gray-50 dark:border-gray-800 min-w-[600px]">
            <div className="grid grid-cols-12 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide gap-4">
              <div className="col-span-5">Query</div>
              <div className="col-span-2 text-right">Clicks</div>
              <div className="col-span-2 text-right">Impressions</div>
              <div className="col-span-2 text-right">CTR</div>
              <div className="col-span-1 text-right">Pos.</div>
            </div>
          </div>
          {keywords.map((kw) => (
            <div
              key={kw.query}
              className="px-5 py-3 border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors min-w-[600px]"
            >
              <div className="grid grid-cols-12 gap-4 items-center">
                <div className="col-span-5">
                  <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{kw.query}</p>
                </div>
                <div className="col-span-2 text-right text-sm text-gray-900 dark:text-white">
                  {kw.clicks.toLocaleString()}
                </div>
                <div className="col-span-2 text-right text-sm text-gray-500 dark:text-gray-400">
                  {kw.impressions.toLocaleString()}
                </div>
                <div className="col-span-2 text-right text-sm text-gray-500 dark:text-gray-400">
                  {(kw.ctr * 100).toFixed(1)}%
                </div>
                <div className="col-span-1 text-right text-sm text-gray-500 dark:text-gray-400">
                  {kw.position.toFixed(1)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
