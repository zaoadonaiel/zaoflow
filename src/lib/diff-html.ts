/**
 * Showing what changed between two versions of an article.
 *
 * The colours are computed here, at render time, and never written into the
 * article. That is the whole design: the stored content stays clean HTML, so
 * what goes to WordPress is the article and not a marked-up copy of it. There
 * is no step that has to remember to strip the highlighting, because nothing
 * ever put it in.
 */

type Token = { tag: boolean; value: string }

/**
 * Tags and words, kept apart.
 *
 * Tags are whole tokens so a changed attribute registers as a change rather
 * than half a tag being wrapped in a span, which would produce broken HTML.
 */
function tokenize(html: string): Token[] {
  const out: Token[] = []
  for (const part of html.split(/(<[^>]+>)/g)) {
    if (!part) continue
    if (part.startsWith('<') && part.endsWith('>')) {
      out.push({ tag: true, value: part })
      continue
    }
    // Whitespace rides along with the word before it, so re-joining the tokens
    // reproduces the original exactly.
    for (const word of part.split(/(\s+)/g)) {
      if (word) out.push({ tag: false, value: word })
    }
  }
  return out
}

/**
 * The cap on the quadratic part.
 *
 * A full article is a few thousand tokens, and the table is tokens squared. An
 * edit is almost always local, so trimming the shared start and end usually
 * leaves very little to compare — but a rewrite leaves everything, and that is
 * the case this bounds. Past the cap the diff is abandoned rather than run.
 */
const MAX_DIFF_TOKENS = 1200

/** Insertion runs in `next` relative to `prev`, as [start, end) token indices. */
function insertedRanges(prev: Token[], next: Token[]): [number, number][] {
  let head = 0
  const maxHead = Math.min(prev.length, next.length)
  while (head < maxHead && prev[head].value === next[head].value) head++

  let tail = 0
  const maxTail = Math.min(prev.length, next.length) - head
  while (
    tail < maxTail &&
    prev[prev.length - 1 - tail].value === next[next.length - 1 - tail].value
  ) tail++

  const a = prev.slice(head, prev.length - tail)
  const b = next.slice(head, next.length - tail)

  if (!b.length) return []
  // Nothing in common to reason from, or too much to compare: treat the whole
  // middle as new rather than pretending to know which words moved.
  if (!a.length || a.length > MAX_DIFF_TOKENS || b.length > MAX_DIFF_TOKENS) {
    return [[head, head + b.length]]
  }

  // Longest common subsequence, over the trimmed middle only.
  const rows = a.length + 1
  const cols = b.length + 1
  const lcs = new Int32Array(rows * cols)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * cols + j] = a[i].value === b[j].value
        ? lcs[(i + 1) * cols + (j + 1)] + 1
        : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + (j + 1)])
    }
  }

  const ranges: [number, number][] = []
  let runStart = -1
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i].value === b[j].value) {
      if (runStart >= 0) { ranges.push([runStart, head + j]); runStart = -1 }
      i++; j++
    } else if (lcs[(i + 1) * cols + j] >= lcs[i * cols + (j + 1)]) {
      i++   // dropped from the old version — nothing to mark
    } else {
      if (runStart < 0) runStart = head + j
      j++
    }
  }
  if (j < b.length && runStart < 0) runStart = head + j
  if (runStart >= 0) ranges.push([runStart, head + b.length])

  return ranges
}

/**
 * `next`, with everything it added since `prev` wrapped for highlighting.
 *
 * Only text is wrapped. An inserted tag is emitted untouched — a span around
 * an opening tag would land inside nothing and unbalance the document.
 */
export function highlightChanges(prev: string, next: string, className: string): string {
  if (!prev) return next
  if (prev === next) return next

  const prevTokens = tokenize(prev)
  const nextTokens = tokenize(next)
  const ranges = insertedRanges(prevTokens, nextTokens)
  if (!ranges.length) return next

  const inserted = new Uint8Array(nextTokens.length)
  for (const [from, to] of ranges) {
    for (let k = from; k < to; k++) inserted[k] = 1
  }

  let out = ''
  let open = false
  for (let k = 0; k < nextTokens.length; k++) {
    const t = nextTokens[k]
    const mark = inserted[k] === 1 && !t.tag

    if (mark && !open) { out += `<span class="${className}">`; open = true }
    if (!mark && open) { out += '</span>'; open = false }
    out += t.value
  }
  if (open) out += '</span>'

  return out
}

interface Version {
  id: string
  author_side: string
  author_name: string
  content: string
}

/** Marked-up HTML, and whose changes are marked in it. */
interface Marked {
  html: string
  side: string | null
  author: string | null
}

/**
 * The version being read, with the changes that produced it marked.
 *
 * "What changed" always means the same thing here: this version against the
 * one before it. Which version that is depends on what is on screen, and
 * getting it wrong would attribute somebody's words to the wrong person, so
 * the choice is made once, here, and both sides render from it.
 */
export function versionHtml(
  drafts: Version[],
  selectedId: string | null,
  currentContent: string
): Marked {
  if (selectedId) {
    return draftHtml(drafts, selectedId) || { html: currentContent, side: null, author: null }
  }

  if (!drafts.length) return { html: currentContent, side: null, author: null }

  const newest = drafts[drafts.length - 1]

  // The article has moved on since the last version. Only the team can write
  // without producing one -- the portal always drafts -- so the difference is
  // theirs by elimination.
  if (newest.content !== currentContent) {
    return {
      html: highlightChanges(newest.content, currentContent, EDIT_CLASS_BY_SIDE('team')),
      side: 'team',
      author: null,
    }
  }

  // The current article *is* the newest version, so showing "what changed"
  // means showing what that version changed.
  const base = drafts.length > 1 ? drafts[drafts.length - 2].content : ''
  return {
    html: highlightChanges(base, newest.content, EDIT_CLASS_BY_SIDE(newest.author_side)),
    side: newest.author_side,
    author: newest.author_name,
  }
}

/**
 * One stored version against the one before it.
 *
 * Split out from `versionHtml` because it is the only branch that does not
 * depend on the article's live content, and the caller showing an old version
 * beside an editor would otherwise re-diff on every keystroke for an answer
 * that cannot have changed.
 */
export function draftHtml(drafts: Version[], selectedId: string): Marked | null {
  const i = drafts.findIndex((d) => d.id === selectedId)
  if (i < 0) return null
  const d = drafts[i]
  return {
    html: highlightChanges(i > 0 ? drafts[i - 1].content : '', d.content, EDIT_CLASS_BY_SIDE(d.author_side)),
    side: d.author_side,
    author: d.author_name,
  }
}

function EDIT_CLASS_BY_SIDE(side: string): string {
  return side === 'team' ? 'edit-team' : 'edit-client'
}
