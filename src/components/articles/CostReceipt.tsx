'use client'

import { Receipt } from 'lucide-react'
import { money, tokens } from '@/lib/format'
import type { UsageRecord } from '@/lib/ai-cost'

const STEP_LABEL: Record<UsageRecord['step'], string> = {
  idea: 'Idea',
  article: 'Article body',
  seo: 'SEO / Yoast',
  image: 'Image',
}

interface Props {
  records: UsageRecord[]
}

/**
 * Every AI call attributed to this article, itemised with a running total.
 *
 * Costs of the calls that produced the article on screen — idea, body, SEO,
 * each image — with the sum at the foot. A missing price shows as an em dash
 * rather than $0.00 so a model absent from the OpenRouter catalogue does not
 * silently register as free.
 */
export default function CostReceipt({ records }: Props) {
  if (records.length === 0) return null

  const priced = records.filter((r) => r.cost_usd !== null && r.cost_usd !== undefined)
  const total = priced.length ? priced.reduce((n, r) => n + (r.cost_usd ?? 0), 0) : null
  const missingPrice = records.length - priced.length

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
        <Receipt className="w-4 h-4 text-gray-500" />
        Cost receipt
      </h3>

      <ul className="space-y-1.5">
        {records.map((r) => (
          <li key={r.id} className="grid grid-cols-[auto,1fr,auto] gap-x-3 items-baseline text-xs">
            <span className="font-medium text-gray-700 dark:text-gray-300 min-w-[6rem]">
              {STEP_LABEL[r.step] ?? r.step}
            </span>
            <span className="text-gray-500 dark:text-gray-400 truncate" title={r.model}>
              <span className="font-mono">{r.model}</span>
              {r.total_tokens > 0 && (
                <span className="ml-2 text-gray-400">
                  {tokens(r.prompt_tokens)} in · {tokens(r.completion_tokens)} out
                </span>
              )}
            </span>
            <span className="text-gray-900 dark:text-white font-medium tabular-nums">
              {r.cost_usd === null || r.cost_usd === undefined
                ? <span className="text-gray-400 font-normal">—</span>
                : money(r.cost_usd)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">Total</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
          {total === null
            ? <span className="text-gray-400 font-normal">—</span>
            : money(total)}
        </span>
      </div>

      {missingPrice > 0 && (
        <p className="mt-2 text-[11px] text-gray-400">
          {missingPrice} {missingPrice === 1 ? 'call has' : 'calls have'} no catalogue price — not counted in the total.
        </p>
      )}
    </div>
  )
}
