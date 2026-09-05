export interface WPPost {
  title: string
  content: string
  excerpt?: string
  status: 'draft' | 'publish' | 'future'
  date?: string
  /** UTC instant for a scheduled post. Preferred over `date`, which WordPress
   *  reads in the site's own timezone and so can land hours off. */
  dateGmt?: string
  categories?: number[]
  slug?: string
  featuredImageUrl?: string   // Supabase/external URL — will be downloaded and uploaded to WP
  focusKeyphrase?: string
  keyphraseSynonyms?: string
  yoastTitle?: string
  yoastMetaDescription?: string
  featuredMediaId?: number    // if already uploaded, use this directly
  /** WordPress user ID to attribute the post to — independent of whose
   *  Application Password is authenticating the request. Requires that user
   *  to have edit_others_posts (admin/editor) capability on the site. */
  author?: number
}

export interface WPAuthor {
  id: number
  name: string
}

export interface WPPostResult {
  id: number
  link: string
  status: string
  /** Category IDs WordPress actually has on the post after the call. */
  categories?: number[]
  /** Set when the requested category could not be applied — the post is live but in Uncategorized. */
  categoryWarning?: string
}

/** WordPress wants a naive ISO string for date_gmt — no trailing Z, no offset. */
function toWpGmt(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, '')
}

function getAuthHeader(username: string, appPassword: string): string {
  return 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64')
}

/** Managed WordPress hosts and WAFs routinely block the default Node fetch agent,
 *  so every call identifies itself. */
const USER_AGENT = `Zaoflo/1.0 (+${process.env.NEXT_PUBLIC_APP_URL || 'https://zaoflo.com'})`

/** WordPress error messages arrive as HTML. Toasts render text. */
function stripTags(message: string): string {
  return message.replace(/<[^>]*>/g, '').trim()
}

/** Unwraps the real reason out of a Node fetch failure — a bare `fetch failed`
 *  tells the user nothing they can act on. */
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown error'

  if (err.name === 'TimeoutError' || err.message.includes('timeout')) {
    return 'The site did not respond in time. It may be slow, or blocking requests from our servers.'
  }

  const cause = (err as Error & { cause?: unknown }).cause
  const code = (cause as { code?: string } | undefined)?.code

  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'That domain could not be resolved. Check the URL for typos.'
    case 'ECONNREFUSED':
    case 'ECONNRESET':
      return 'The server refused the connection. Check the URL and that the site is online.'
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return `The site's HTTPS certificate could not be verified (${code}).`
  }

  const causeMsg = cause instanceof Error ? cause.message : undefined
  return causeMsg ? `${err.message} — ${causeMsg}` : err.message
}

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '')
}


/**
 * The file extension to send an image up under.
 *
 * WordPress checks the name against the bytes and rejects a mismatch, so a
 * GIF named .jpg is not an untidy filename -- it is a failed upload. Guessed
 * from the URL because that is all the caller has before fetching it.
 */
export function extensionForImageUrl(url: string): string {
  const lower = url.toLowerCase()
  if (lower.includes('.png')) return '.png'
  if (lower.includes('.webp')) return '.webp'
  if (lower.includes('.gif')) return '.gif'
  return '.jpg'
}

export async function uploadMedia({
  siteUrl,
  username,
  appPassword,
  imageUrl,
  filename,
  altText,
}: {
  siteUrl: string
  username: string
  appPassword: string
  imageUrl: string
  filename?: string
  /** Written onto the media item after upload; a failure here is not fatal. */
  altText?: string
}): Promise<number> {
  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) {
    throw new Error(`Failed to download image from ${imageUrl}: ${imgRes.status}`)
  }

  const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
  const mimeBase = contentType.split(';')[0].trim()

  const extMap: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    // Uploaded images can be GIFs. Without this one the file would go up named
    // .jpg while declaring image/gif, and WordPress rejects that mismatch.
    'image/gif': '.gif',
  }
  const ext = extMap[mimeBase] ?? '.jpg'

  const arrayBuffer = await imgRes.arrayBuffer()

  const baseUrl = normalizeUrl(siteUrl)
  const res = await fetch(`${baseUrl}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(username, appPassword),
      'User-Agent': USER_AGENT,
      'Content-Type': mimeBase,
      'Content-Disposition': `attachment; filename="${filename || 'featured' + ext}"`,
    },
    body: arrayBuffer,
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `WordPress media upload failed: ${res.status}`)
  }

  const data = await res.json()

  // Alt text is a second call — the upload endpoint takes the bytes, not the
  // fields. An image on the page beats an image with a description, so a
  // failure here is swallowed rather than losing the upload that succeeded.
  if (altText && data.id) {
    try {
      await fetch(`${baseUrl}/wp-json/wp/v2/media/${data.id}`, {
        method: 'POST',
        headers: {
          Authorization: getAuthHeader(username, appPassword),
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ alt_text: altText }),
        signal: AbortSignal.timeout(15000),
      })
    } catch {
      // Left without a description; the image itself is up.
    }
  }

  return data.id
}

export async function testWordPressConnection({
  siteUrl,
  username,
  appPassword,
}: {
  siteUrl: string
  username: string
  appPassword: string
}): Promise<{ success: boolean; error?: string; siteName?: string }> {
  const baseUrl = normalizeUrl(siteUrl)

  // Test credentials
  let userRes: Response
  try {
    userRes = await fetch(`${baseUrl}/wp-json/wp/v2/users/me`, {
      headers: { Authorization: getAuthHeader(username, appPassword), 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000),
    })
  } catch (err) {
    return { success: false, error: describeFetchError(err) }
  }

  // A cross-origin hop (http→https, example.com→www.example.com) makes fetch drop
  // the Authorization header, so the credentials never arrive and WordPress answers
  // 401 no matter how correct they are. Name the URL it actually serves instead.
  const redirectedTo = crossOriginRedirect(baseUrl, userRes.url)
  if (redirectedTo) {
    return {
      success: false,
      error: `${baseUrl} redirects to ${redirectedTo}, and the redirect strips the login. Use ${redirectedTo} as the site URL.`,
    }
  }

  if (!userRes.ok) {
    const body = (await userRes.json().catch(() => null)) as { message?: string } | null
    const detail = body?.message ? ` WordPress said: "${stripTags(body.message)}"` : ''

    if (userRes.status === 401 || userRes.status === 403) {
      return {
        success: false,
        error: `WordPress rejected the credentials (${userRes.status}).${detail || ' Check the username and application password — and that the host is not stripping the Authorization header.'}`,
      }
    }
    if (userRes.status === 404) {
      return {
        success: false,
        error: 'No WordPress REST API at that address (404). Check the URL, and that a security plugin has not disabled the REST API.',
      }
    }
    return { success: false, error: `WordPress returned status ${userRes.status}.${detail}` }
  }

  // Get site name. The credentials already checked out, so a miss here is cosmetic.
  let siteName = siteUrl
  try {
    const siteRes = await fetch(`${baseUrl}/wp-json`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000),
    })
    const siteData = (await siteRes.json().catch(() => ({}))) as { name?: string }
    siteName = siteData.name || siteUrl
  } catch {
    // keep the URL as the name
  }

  return { success: true, siteName }
}

/**
 * Users the connected account is allowed to attribute posts to.
 *
 * `context=edit` lists every user (needed to see authors with no posts yet),
 * but only an admin/editor-capable account can request it — a lower-role
 * connection falls back to the public author listing instead of erroring out.
 */
export async function getAuthors({
  siteUrl,
  username,
  appPassword,
}: {
  siteUrl: string
  username: string
  appPassword: string
}): Promise<WPAuthor[]> {
  const baseUrl = normalizeUrl(siteUrl)
  const headers = { Authorization: getAuthHeader(username, appPassword), 'User-Agent': USER_AGENT }

  for (const context of ['edit', 'view'] as const) {
    try {
      const res = await fetch(`${baseUrl}/wp-json/wp/v2/users?context=${context}&per_page=100`, {
        headers,
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) continue
      const data = (await res.json()) as Array<{ id: number; name: string }>
      if (Array.isArray(data)) return data.map((u) => ({ id: u.id, name: u.name }))
    } catch {
      // try the next context
    }
  }

  return []
}

/** The origin fetch landed on, when it differs from the one we asked for. */
function crossOriginRedirect(requested: string, landedOn: string): string | null {
  try {
    const from = new URL(requested).origin
    const to = new URL(landedOn).origin
    return from === to ? null : to
  } catch {
    return null
  }
}

export async function publishPost({
  siteUrl,
  username,
  appPassword,
  post,
  existingPostId,
}: {
  siteUrl: string
  username: string
  appPassword: string
  post: WPPost
  /**
   * Rewrite this post instead of creating another one. Without it, saving a
   * scheduled article twice leaves two posts on WordPress — and the first one,
   * now orphaned from our row, still publishes on its original date.
   */
  existingPostId?: number
}): Promise<WPPostResult> {
  const baseUrl = normalizeUrl(siteUrl)

  const body: Record<string, unknown> = {
    title: post.title,
    content: post.content,
    status: post.status,
  }
  if (post.excerpt) body.excerpt = post.excerpt
  if (post.dateGmt) body.date_gmt = toWpGmt(post.dateGmt)
  else if (post.date) body.date = post.date
  if (post.categories?.length) body.categories = post.categories
  if (post.slug) body.slug = post.slug
  if (post.featuredMediaId) body.featured_media = post.featuredMediaId
  if (post.author) body.author = post.author

  const meta: Record<string, string> = {}
  if (post.focusKeyphrase) meta['_yoast_wpseo_focuskw'] = post.focusKeyphrase
  if (post.yoastMetaDescription) meta['_yoast_wpseo_metadesc'] = post.yoastMetaDescription
  if (post.yoastTitle) meta['_yoast_wpseo_title'] = post.yoastTitle
  if (Object.keys(meta).length > 0) body.meta = meta

  const res = await fetch(
    existingPostId
      ? `${baseUrl}/wp-json/wp/v2/posts/${existingPostId}`
      : `${baseUrl}/wp-json/wp/v2/posts`,
    {
      method: existingPostId ? 'PUT' : 'POST',
      headers: {
        Authorization: getAuthHeader(username, appPassword),
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    }
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const failure = new Error(err?.message || `WordPress publish failed: ${res.status}`)
    // Tagged so the caller can tell "the post we meant to rewrite is gone" from
    // a real failure, and create a fresh one instead of dead-ending.
    if (existingPostId && res.status === 404) {
      ;(failure as Error & { postMissing?: boolean }).postMissing = true
    }
    throw failure
  }

  const data = await res.json()
  const result: WPPostResult = {
    id: data.id,
    link: data.link,
    status: data.status,
    categories: toCategoryIds(data.categories),
  }

  // WordPress silently falls back to Uncategorized whenever it does not apply the
  // terms we sent (a security/SEO plugin filtering the payload, a role without
  // assign_terms, a term id that does not exist on the site). Confirm the category
  // landed, retry once against the created post, and report it if it still didn't.
  const requested = post.categories ?? []
  if (requested.length) {
    let missing = missingCategories(requested, result.categories)

    if (missing.length) {
      try {
        const retry = await updatePost({
          siteUrl,
          username,
          appPassword,
          postId: data.id,
          post: { categories: requested },
        })
        result.categories = retry.categories
        missing = missingCategories(requested, retry.categories)
      } catch (err) {
        result.categoryWarning = err instanceof Error ? err.message : 'Category assignment failed'
      }
    }

    if (missing.length && !result.categoryWarning) {
      result.categoryWarning =
        `WordPress did not apply category ${missing.join(', ')} — the post is in Uncategorized. ` +
        `Check that the category still exists on the site and that the connected user can assign categories.`
    }
  }

  return result
}

function toCategoryIds(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map(Number).filter((n) => Number.isFinite(n))
}

function missingCategories(requested: number[], applied: number[] | undefined): number[] {
  // An absent categories field means the site did not tell us — don't cry wolf.
  if (!applied) return []
  return requested.filter((id) => !applied.includes(id))
}

export async function deletePost({
  siteUrl,
  username,
  appPassword,
  postId,
}: {
  siteUrl: string
  username: string
  appPassword: string
  postId: number
}): Promise<void> {
  const baseUrl = normalizeUrl(siteUrl)

  const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${postId}?force=true`, {
    method: 'DELETE',
    headers: { Authorization: getAuthHeader(username, appPassword), 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `WordPress delete failed: ${res.status}`)
  }
}

/**
 * Reads a post's current state from WordPress.
 *
 * Needed because WordPress, not this app, publishes scheduled posts — so our
 * stored status goes stale the moment a slot fires. Anything about to change a
 * post has to ask what it actually is first.
 */
export async function getPost({
  siteUrl,
  username,
  appPassword,
  postId,
}: {
  siteUrl: string
  username: string
  appPassword: string
  postId: number
}): Promise<{ id: number; status: string; link: string; dateGmt?: string }> {
  const baseUrl = normalizeUrl(siteUrl)

  const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${postId}?context=edit`, {
    headers: { Authorization: getAuthHeader(username, appPassword), 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `WordPress read failed: ${res.status}`)
  }

  const data = await res.json()
  return {
    id: data.id,
    status: data.status,
    link: data.link,
    dateGmt: data.date_gmt ? `${data.date_gmt}Z` : undefined,
  }
}

/**
 * Post fetching used by the SEO Pages tool to clone an existing post for a
 * new city and publish it as a fresh post. Same shapes as pages, kept under
 * the WPPage* names for compatibility with existing callers.
 */

export interface WPPageSummary {
  id: number
  slug: string
  title: string
  link: string
  status: string
  modifiedGmt?: string
}

export interface WPPageFull extends WPPageSummary {
  content: string
  excerpt: string
  featuredMediaId?: number
  featuredMediaUrl?: string
}

/** WP renders titles/excerpts as HTML; the picker wants text. */
function stripEntities(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#8211;/g, '–')
    .replace(/&#038;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

export async function listPosts({
  siteUrl,
  username,
  appPassword,
  perPage = 100,
  search,
}: {
  siteUrl: string
  username: string
  appPassword: string
  perPage?: number
  search?: string
}): Promise<WPPageSummary[]> {
  const baseUrl = normalizeUrl(siteUrl)
  // Include drafts + published so the picker sees everything the user has.
  const params = new URLSearchParams({
    per_page: String(Math.min(perPage, 100)),
    status: 'publish,draft,pending,private,future',
    orderby: 'modified',
    order: 'desc',
    context: 'edit',
    _fields: 'id,slug,title,link,status,modified_gmt',
  })
  if (search) params.set('search', search)

  const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts?${params}`, {
    headers: { Authorization: getAuthHeader(username, appPassword), 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `WordPress list posts failed: ${res.status}`)
  }

  const data = await res.json()
  if (!Array.isArray(data)) return []

  return data.map((p: {
    id: number
    slug: string
    title: { rendered?: string; raw?: string }
    link: string
    status: string
    modified_gmt?: string
  }) => ({
    id: p.id,
    slug: p.slug,
    title: stripEntities(p.title?.raw || p.title?.rendered || p.slug),
    link: p.link,
    status: p.status,
    modifiedGmt: p.modified_gmt ? `${p.modified_gmt}Z` : undefined,
  }))
}

export async function getPostFull({
  siteUrl,
  username,
  appPassword,
  postId,
}: {
  siteUrl: string
  username: string
  appPassword: string
  postId: number
}): Promise<WPPageFull> {
  const baseUrl = normalizeUrl(siteUrl)

  const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${postId}?context=edit`, {
    headers: { Authorization: getAuthHeader(username, appPassword), 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `WordPress read post failed: ${res.status}`)
  }

  const data = await res.json()

  // context=edit returns raw for content/title/excerpt; fall back to rendered
  // if a plugin strips the raw field.
  const content: string = data.content?.raw ?? data.content?.rendered ?? ''
  const excerpt: string = data.excerpt?.raw ?? data.excerpt?.rendered ?? ''
  const title: string = stripEntities(data.title?.raw || data.title?.rendered || data.slug)

  return {
    id: data.id,
    slug: data.slug,
    title,
    link: data.link,
    status: data.status,
    modifiedGmt: data.modified_gmt ? `${data.modified_gmt}Z` : undefined,
    content,
    excerpt,
    featuredMediaId: typeof data.featured_media === 'number' && data.featured_media > 0 ? data.featured_media : undefined,
  }
}

export async function updatePost({
  siteUrl,
  username,
  appPassword,
  postId,
  post,
}: {
  siteUrl: string
  username: string
  appPassword: string
  postId: number
  post: Partial<WPPost>
}): Promise<WPPostResult> {
  const baseUrl = normalizeUrl(siteUrl)

  // `post` is the camelCase shape used across this file; WordPress wants its own
  // field names, so translate the ones we actually send on an update.
  const { dateGmt, featuredMediaId, ...rest } = post
  const body: Record<string, unknown> = { ...rest }
  if (dateGmt) {
    body.date_gmt = toWpGmt(dateGmt)
    delete body.date
  }
  if (featuredMediaId) body.featured_media = featuredMediaId

  const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${postId}`, {
    method: 'PUT',
    headers: {
      Authorization: getAuthHeader(username, appPassword),
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `WordPress update failed: ${res.status}`)
  }

  const data = await res.json()
  return {
    id: data.id,
    link: data.link,
    status: data.status,
    categories: toCategoryIds(data.categories),
  }
}
