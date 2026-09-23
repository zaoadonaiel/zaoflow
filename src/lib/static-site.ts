/**
 * Static-site publisher — pushes an article into a JSON file inside a
 * GitHub repo, letting whatever CI hangs off that repo (Cloudflare
 * Pages, Netlify, Vercel) rebuild the site.
 *
 * The receiving JSON is expected to be shaped:
 *   { "es": { "articles": [...] }, "en": { "articles": [...] } }
 * with each article an object of { title, excerpt, slug, published_date, body }.
 * A slug that already exists in the target language bucket is replaced
 * in place rather than duplicated — this lets a re-publish behave like
 * an edit instead of adding a second entry.
 */

export interface StaticArticleEntry {
  title: string
  excerpt: string
  slug: string
  published_date: string
  body: string
  category?: string
}

export interface StaticPostResult {
  id: string
  url: string
  status: string
}

interface GitHubFile {
  content: string
  sha: string
  encoding: string
}

interface ArticlesJson {
  [language: string]: { articles: StaticArticleEntry[] }
}

const GITHUB_API = 'https://api.github.com'

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function encodeBase64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64')
}

function decodeBase64(s: string): string {
  return Buffer.from(s.replace(/\n/g, ''), 'base64').toString('utf8')
}

export async function testStaticConnection({
  repo,
  token,
  branch = 'main',
  contentPath = 'content/articles.json',
}: {
  repo: string
  token: string
  branch?: string
  contentPath?: string
}): Promise<{ success: boolean; error?: string; fileExists?: boolean }> {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${repo}`, {
      headers: ghHeaders(token),
      signal: AbortSignal.timeout(10000),
    })

    if (res.status === 401 || res.status === 403) {
      return { success: false, error: 'Invalid GitHub token or missing contents:write permission.' }
    }
    if (res.status === 404) {
      return { success: false, error: `Repo "${repo}" not found or token lacks access.` }
    }
    if (!res.ok) {
      return { success: false, error: `GitHub returned status ${res.status}.` }
    }

    // Check whether articles.json exists on that branch. Missing is
    // fine — the first publish will create it — but the caller may
    // want to know so it can warn about repo layout.
    const fileRes = await fetch(
      `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(contentPath)}?ref=${encodeURIComponent(branch)}`,
      { headers: ghHeaders(token), signal: AbortSignal.timeout(10000) },
    )

    return { success: true, fileExists: fileRes.ok }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: msg }
  }
}

async function fetchArticlesJson({
  repo,
  token,
  branch,
  contentPath,
}: {
  repo: string
  token: string
  branch: string
  contentPath: string
}): Promise<{ parsed: ArticlesJson; sha: string | null }> {
  const res = await fetch(
    `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(contentPath)}?ref=${encodeURIComponent(branch)}`,
    { headers: ghHeaders(token), signal: AbortSignal.timeout(15000) },
  )

  // Missing is fine — the file gets created on the first publish.
  if (res.status === 404) return { parsed: {}, sha: null }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `GitHub read failed: ${res.status}`)
  }

  const file = (await res.json()) as GitHubFile
  const decoded = decodeBase64(file.content)

  let parsed: ArticlesJson
  try {
    parsed = JSON.parse(decoded) as ArticlesJson
  } catch {
    throw new Error(`Existing ${contentPath} is not valid JSON. Fix or delete it and retry.`)
  }
  return { parsed, sha: file.sha }
}

function upsertEntry(
  parsed: ArticlesJson,
  language: string,
  entry: StaticArticleEntry,
): ArticlesJson {
  const bucket = parsed[language] ?? { articles: [] }
  const existingIdx = bucket.articles.findIndex((a) => a.slug === entry.slug)

  if (existingIdx >= 0) {
    bucket.articles[existingIdx] = entry
  } else {
    bucket.articles.unshift(entry)
  }

  return { ...parsed, [language]: bucket }
}

export async function publishStaticPost({
  repo,
  token,
  branch = 'main',
  contentPath = 'content/articles.json',
  language,
  siteUrl,
  entry,
}: {
  repo: string
  token: string
  branch?: string
  contentPath?: string
  language: string
  siteUrl: string
  entry: StaticArticleEntry
}): Promise<StaticPostResult> {
  const { parsed, sha } = await fetchArticlesJson({ repo, token, branch, contentPath })
  const merged = upsertEntry(parsed, language, entry)
  const nextContent = JSON.stringify(merged, null, 2) + '\n'

  const body: Record<string, unknown> = {
    message: `zaoflo: publish "${entry.title}" (${language})`,
    content: encodeBase64(nextContent),
    branch,
  }
  if (sha) body.sha = sha

  const res = await fetch(
    `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(contentPath)}`,
    {
      method: 'PUT',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    },
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    // 409 = the sha we sent is stale. Rare here (single writer per
    // repo) but surfaces clearly if two publishes race.
    if (res.status === 409) {
      throw new Error('The articles.json file changed underneath the publish. Try again.')
    }
    throw new Error(err?.message || `GitHub write failed: ${res.status}`)
  }

  const cleanBase = siteUrl.replace(/\/$/, '')
  return {
    id: entry.slug,
    url: `${cleanBase}/articles/${entry.slug}`,
    status: 'publish',
  }
}
