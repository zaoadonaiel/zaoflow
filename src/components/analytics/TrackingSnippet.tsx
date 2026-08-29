'use client'

import { Copy, Code2 } from 'lucide-react'
import toast from 'react-hot-toast'

interface TrackingSnippetProps {
  measurementId: string | null
  onConnectClick?: () => void
}

export default function TrackingSnippet({ measurementId, onConnectClick }: TrackingSnippetProps) {
  const snippet = measurementId
    ? `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${measurementId}');
</script>`
    : ''

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(snippet)
      toast.success('Snippet copied to clipboard')
    } catch {
      toast.error('Could not copy snippet')
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Code2 className="w-4 h-4 text-gray-400" />
          Tracking Snippet
        </h2>
        {measurementId && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy snippet
          </button>
        )}
      </div>

      {measurementId ? (
        <pre className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-xs font-mono text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre">
          {snippet}
        </pre>
      ) : (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            Select a GA4 property for this site to get its tracking snippet.
          </p>
          {onConnectClick && (
            <button
              onClick={onConnectClick}
              className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
            >
              Connect Analytics
            </button>
          )}
        </div>
      )}
    </div>
  )
}
