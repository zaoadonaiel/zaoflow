'use client'

import { useRef, useCallback, useEffect, useState } from 'react'
import {
  Bold,
  Italic,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link2,
  Undo,
  Redo,
  AlignLeft,
} from 'lucide-react'

interface ArticleEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  /** Overrides the default `min-h-[400px]`, e.g. to clamp+scroll when collapsed. */
  bodyHeightClass?: string
}

export default function ArticleEditor({
  value,
  onChange,
  placeholder = 'Start writing...',
  bodyHeightClass = 'min-h-[400px]',
}: ArticleEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)

  function updateCounts(el: HTMLDivElement) {
    const text = el.innerText || ''
    setCharCount(text.length)
    setWordCount(text.trim() ? text.trim().split(/\s+/).length : 0)
  }

  useEffect(() => {
    const el = editorRef.current
    if (el && el.innerHTML !== value) {
      el.innerHTML = value
      updateCounts(el)
    }
  }, [value])

  const execCommand = useCallback((command: string, val?: string) => {
    document.execCommand(command, false, val)
    editorRef.current?.focus()
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML)
    }
  }, [onChange])

  function handleInput() {
    const el = editorRef.current
    if (el) {
      onChange(el.innerHTML)
      updateCounts(el)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault()
      execCommand('insertText', '    ')
    }
  }

  function insertHeading(level: 'h2' | 'h3') {
    execCommand('formatBlock', level)
  }

  function insertLink() {
    const url = window.prompt('Enter URL:')
    if (url) execCommand('createLink', url)
  }

  const tools = [
    { icon: Bold, action: () => execCommand('bold'), title: 'Bold (Ctrl+B)' },
    { icon: Italic, action: () => execCommand('italic'), title: 'Italic (Ctrl+I)' },
    null,
    { icon: Heading2, action: () => insertHeading('h2'), title: 'Heading 2' },
    { icon: Heading3, action: () => insertHeading('h3'), title: 'Heading 3' },
    null,
    { icon: List, action: () => execCommand('insertUnorderedList'), title: 'Bullet list' },
    { icon: ListOrdered, action: () => execCommand('insertOrderedList'), title: 'Numbered list' },
    null,
    { icon: Quote, action: () => execCommand('formatBlock', 'blockquote'), title: 'Quote' },
    { icon: Link2, action: insertLink, title: 'Insert link' },
    { icon: AlignLeft, action: () => execCommand('formatBlock', 'p'), title: 'Paragraph' },
    null,
    { icon: Undo, action: () => execCommand('undo'), title: 'Undo' },
    { icon: Redo, action: () => execCommand('redo'), title: 'Redo' },
  ]

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-800">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-3 py-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 flex-wrap">
        {tools.map((tool, i) =>
          tool === null ? (
            <div key={i} className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />
          ) : (
            <button
              key={i}
              type="button"
              onClick={tool.action}
              title={tool.title}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            >
              <tool.icon className="w-4 h-4" />
            </button>
          )
        )}
      </div>

      {/* Editable area */}
      {/* Writing assistants (Grammarly et al.) inject their own nodes into
          contentEditable regions before React hydrates, which fails hydration
          for the whole root. Opt out, and don't fail on what still slips in. */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        suppressHydrationWarning
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        data-placeholder={!value ? placeholder : ''}
        className={`article-editor p-5 ${bodyHeightClass} text-gray-800 dark:text-gray-100 text-sm outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400 dark:empty:before:text-gray-500`}
        style={{ whiteSpace: 'pre-wrap' }}
      />

      {/* Word / char count bar */}
      <div className="flex items-center justify-end gap-4 px-5 py-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          <span className={`font-medium ${wordCount > 0 ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
            {wordCount.toLocaleString()}
          </span>{' '}
          words
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          <span className={`font-medium ${charCount > 0 ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
            {charCount.toLocaleString()}
          </span>{' '}
          characters
        </span>
      </div>
    </div>
  )
}
