'use client'

import Modal from '@/components/ui/Modal'

interface Props {
  open: boolean
  /** The line above the site name — what is about to be written, and for whom. */
  question: string
  siteName: string | null
  onConfirm: () => void
  /** Closes this and goes to pick a different site. */
  onChange: () => void
  onClose: () => void
}

/**
 * The site, said out loud, before anything is generated.
 *
 * Every generation costs money and lands on somebody's site, and the site is
 * picked once at the top of the page and then not looked at again — so the one
 * thing this asks is whether the name in the middle is the right one. Clicking
 * outside closes it: the answer is usually yes, and being sure should not cost
 * a second click.
 */
export default function ConfirmSiteModal({
  open, question, siteName, onConfirm, onChange, onClose,
}: Props) {
  return (
    <Modal open={open} onClose={onClose} title="" maxWidth="max-w-md">
      <div className="text-center pb-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">{question}</p>

        <p className="mt-3 mb-7 text-3xl font-bold text-gray-900 dark:text-white break-words">
          {siteName || 'No site selected'}
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onChange}
            className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Change
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="flex-1 px-4 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-semibold hover:bg-brand-700 transition-colors"
          >
            Yes
          </button>
        </div>
      </div>
    </Modal>
  )
}
