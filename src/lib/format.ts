/**
 * Shared number formatting for figures the user reads rather than computes.
 *
 * The rule these share: never round a real quantity down to nothing. A cost of
 * a hundredth of a cent is not $0.00, and a file that exists is not 0 MB.
 */

/** "$1.11", and "$0.000165" rather than rounding a real cost away to $0.00. */
export function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (v === 0) return '$0.00'
  // Anything real but below what six decimals can show is reported as
  // "less than", never rounded down to $0 — that would read as free.
  if (v < 0.000001) return '<$0.000001'
  if (v < 0.01) return `$${v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
  return `$${v.toFixed(2)}`
}

const MB = 1024 * 1024
const GB = MB * 1024

/** Megabytes, or gigabytes once there are enough of them. */
export function fileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes === 0) return '0 MB'
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`
  const mb = bytes / MB
  // A 4 KB file is not 0.00 MB. Below what two decimals can show, say so.
  if (mb < 0.01) return '<0.01 MB'
  return `${mb.toFixed(2)} MB`
}

/** "1,024", or an em dash when the count was never recorded. */
export function tokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString()
}
