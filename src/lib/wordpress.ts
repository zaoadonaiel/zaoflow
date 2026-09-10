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
  /** Value written to the `_location` post meta. Undefined skips the key;
   *  empty string writes it as an empty value. Consumed by theme/plugin
   *  templates on the WP side. */
  locationMeta?: string
  /** Page template slug — the value shown under Page Attributes → Template
   *  in the WP editor. Passed as `template` in the REST payload. Undefined
   *  leaves whatever the post already had; empty string forces "Default". */
  template?: string
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
  /** Set when one or more Yoast meta keys we asked for weren't reflected on
   *  the post after write (WP silently drops meta that isn't registered as
   *  `show_in_rest` for that post type, or that the connected user lacks
   *  permission to write). The post is live either way. */
  yoastWarning?: string
  /** Same idea as `yoastWarning`, but for non-Yoast custom meta (`_location`,
   *  ACF fields, theme-defined keys). Separated so a message about a theme
   *  custom field doesn't misread as "Yoast is broken". */
  metaWarning?: string
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
  title,
}: {
  siteUrl: string
  username: string
  appPassword: string
  imageUrl: string
  filename?: string
  /** Written onto the media item after upload; a failure here is not fatal. */
  altText?: string
  /**
   * WP media title, shown in the library and in Media details. Set
   * explicitly rather than relying on filename derivation — WP's own
   * sanitiser can lowercase and mangle filename-derived titles, and a
   * user-facing title should read the way the caller wrote it.
   */
  title?: string
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

  // Alt + title are a second call — the upload endpoint takes the bytes, not
  // the fields. An image on the page beats an image with a description, so a
  // failure here is swallowed rather than losing the upload that succeeded.
  if ((altText || title) && data.id) {
    try {
      const patch: Record<string, string> = {}
      if (altText) patch.alt_text = altText
      if (title) patch.title = title
      await fetch(`${baseUrl}/wp-json/wp/v2/media/${data.id}`, {
        method: 'POST',
        headers: {
          Authorization: getAuthHeader(username, appPassword),
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
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
  resource = 'posts',
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
  /**
   * Which WP REST collection to write to. Defaults to `posts` for
   * compatibility with articles; SEO Pages passes `pages` when the source
   * was a Page rather than a Post.
   */
  resource?: 'posts' | 'pages'
}): Promise<WPPostResult> {
  const baseUrl = normalizeUrl(siteUrl)

  const body: Record<string, unknown> = {
    title: post.title,
    content: post.content,
    status: post.status,
    // Every post this app publishes has comments off. Kept on the create *and*
    // update path so re-publishing an existing post with comments left open in
    // WP also closes them.
    comment_status: 'closed',
  }
  if (post.excerpt) body.excerpt = post.excerpt
  if (post.dateGmt) body.date_gmt = toWpGmt(post.dateGmt)
  else if (post.date) body.date = post.date
  if (post.categories?.length) body.categories = post.categories
  if (post.slug) body.slug = post.slug
  if (post.featuredMediaId) body.featured_media = post.featuredMediaId
  if (post.author) body.author = post.author
  if (post.template !== undefined) body.template = post.template

  const meta: Record<string, string> = {}
  if (post.focusKeyphrase) meta['_yoast_wpseo_focuskw'] = post.focusKeyphrase
  if (post.yoastMetaDescription) meta['_yoast_wpseo_metadesc'] = post.yoastMetaDescription
  if (post.yoastTitle) meta['_yoast_wpseo_title'] = post.yoastTitle
  if (post.keyphraseSynonyms) meta['_yoast_wpseo_keywordsynonyms'] = post.keyphraseSynonyms
  // Empty string is a valid value here — the flag decides content, not presence.
  if (post.locationMeta !== undefined) meta['_location'] = post.locationMeta
  if (Object.keys(meta).length > 0) body.meta = meta

  const res = await fetch(
    existingPostId
      ? `${baseUrl}/wp-json/wp/v2/${resource}/${existingPostId}`
      : `${baseUrl}/wp-json/wp/v2/${resource}`,
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
          resource,
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

  // Yoast + `_location` meta persistence.
  //
  // Sending `meta` alongside title/content/etc. in one call works when the
  // meta keys are registered as `show_in_rest`. On plenty of installs —
  // especially themes where Yoast registered underscore-prefixed keys only
  // for `post` and not `page`, or app-password users lacking
  // `edit_others_pages` — the meta object is silently dropped from a
  // combined request. WP's dedicated meta-update path is more forgiving, so
  // we retry meta by itself as a follow-up.
  //
  // No read-back verification: WordPress only surfaces meta over REST that
  // it's been told to expose via `show_in_rest`. On sites without that,
  // "read comes back empty" is not the same as "write didn't land" — the
  // verify pass produced false-positive warnings on every publish. If your
  // site needs the writes to work, install the `zaoflo-seo-meta.php`
  // mu-plugin from `docs/wordpress/` (registers the five keys we set).
  if (Object.keys(meta).length > 0 && data.id) {
    try {
      await fetch(`${baseUrl}/wp-json/wp/v2/${resource}/${data.id}`, {
        method: 'POST',
        headers: {
          Authorization: getAuthHeader(username, appPassword),
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ meta }),
        signal: AbortSignal.timeout(20000),
      })
    } catch {
      // Best-effort — the main publish already succeeded.
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
  resource = 'posts',
  force = true,
}: {
  siteUrl: string
  username: string
  appPassword: string
  postId: number
  resource?: 'posts' | 'pages'
  /** When true (default) the item is deleted permanently. When false WP
   *  moves it to Trash and it can be restored via `restorePost`. */
  force?: boolean
}): Promise<void> {
  const baseUrl = normalizeUrl(siteUrl)

  const url = `${baseUrl}/wp-json/wp/v2/${resource}/${postId}${force ? '?force=true' : ''}`
  const res = await fetch(url, {
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
 * Move a trashed item back to `draft` status. WordPress has no dedicated
 * restore endpoint — restoring is just a status update — but callers reading
 * this file shouldn't have to know that.
 */
export async function restorePost({
  siteUrl,
  username,
  appPassword,
  postId,
  resource = 'posts',
}: {
  siteUrl: string
  username: string
  appPassword: string
  postId: number
  resource?: 'posts' | 'pages'
}): Promise<{ id: number; status: string; link: string }> {
  const baseUrl = normalizeUrl(siteUrl)

  const res = await fetch(`${baseUrl}/wp-json/wp/v2/${resource}/${postId}`, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(username, appPassword),
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'draft' }),
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `WordPress restore failed: ${res.status}`)
  }

  const data = await res.json()
  return { id: data.id, status: data.status, link: data.link }
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
  /** Published date (or scheduled instant) in UTC. Some views want the
   *  original publish date rather than the last-modified stamp — Page Remover
   *  filters by it so a search on "before 2024" behaves like the user
   *  expects. */
  dateGmt?: string
}

export interface WPPageFull extends WPPageSummary {
  content: string
  excerpt: string
  featuredMediaId?: number
  featuredMediaUrl?: string
  /** Yoast SEO meta as it lives on the source. Blank when the site doesn't
   *  expose the fields over REST, or when the post never had them set. */
  yoastTitle?: string
  yoastMetaDescription?: string
  focusKeyphrase?: string
  keyphraseSynonyms?: string
  /** Page template file the source uses (e.g. `100-width.php`, `default`,
   *  or theme-defined slugs like Avada's Fusion templates). Empty string
   *  means the theme default. */
  template?: string
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

interface WPListItem {
  id: number
  slug: string
  title: { rendered?: string; raw?: string }
  link: string
  status: string
  modified_gmt?: string
  date_gmt?: string
}

function mapWpListItem(p: WPListItem): WPPageSummary {
  return {
    id: p.id,
    slug: p.slug,
    title: stripEntities(p.title?.raw || p.title?.rendered || p.slug),
    link: p.link,
    status: p.status,
    modifiedGmt: p.modified_gmt ? `${p.modified_gmt}Z` : undefined,
    dateGmt: p.date_gmt ? `${p.date_gmt}Z` : undefined,
  }
}

/**
 * List every post/page from a WordPress site — paginates through the REST
 * collection until exhausted so the caller isn't capped at the WP per-page
 * limit (100). Returns items ordered by last-modified desc so the freshest
 * pages float to the top of any picker UI. A search term shortcuts to a
 * single request since users don't usually need thousands of matches.
 */
export async function listPosts({
  siteUrl,
  username,
  appPassword,
  search,
  resource = 'posts',
  maxPages = 50,
  status = 'publish,draft,pending,private,future',
  afterGmt,
  beforeGmt,
  orderBy = 'modified',
  dateField = 'published',
}: {
  siteUrl: string
  username: string
  appPassword: string
  search?: string
  resource?: 'posts' | 'pages'
  /** Safety cap on paginated fetches (100 items per page) — 50 = 5,000 items. */
  maxPages?: number
  /** WP `status` query — comma-separated. Pass `'trash'` for Trash view. */
  status?: string
  /** ISO instant; WP filters items with date >= this value. */
  afterGmt?: string
  /** ISO instant; WP filters items with date <= this value. */
  beforeGmt?: string
  /** WP `orderby` — `'date'` sorts by publish date, `'modified'` by last edit. */
  orderBy?: 'date' | 'modified' | 'title' | 'slug' | 'id'
  /** Which date column `afterGmt`/`beforeGmt` filter against. `'published'`
   *  maps to WP's `after`/`before` (default), `'modified'` maps to
   *  `modified_after`/`modified_before` (WordPress 5.7+). Older WP silently
   *  ignores the modified variants, which just means the range has no
   *  effect on those sites — nothing breaks. */
  dateField?: 'published' | 'modified'
}): Promise<WPPageSummary[]> {
  const baseUrl = normalizeUrl(siteUrl)
  const headers = { Authorization: getAuthHeader(username, appPassword), 'User-Agent': USER_AGENT }

  function pageParams(page: number): URLSearchParams {
    const params = new URLSearchParams({
      per_page: '100',
      page: String(page),
      status,
      orderby: orderBy,
      order: 'desc',
      context: 'edit',
      _fields: 'id,slug,title,link,status,modified_gmt,date_gmt',
    })
    if (search) params.set('search', search)
    if (afterGmt) params.set(dateField === 'modified' ? 'modified_after' : 'after', afterGmt)
    if (beforeGmt) params.set(dateField === 'modified' ? 'modified_before' : 'before', beforeGmt)
    return params
  }

  async function fetchPage(page: number): Promise<{ items: WPPageSummary[]; totalPages: number }> {
    const res = await fetch(`${baseUrl}/wp-json/wp/v2/${resource}?${pageParams(page)}`, {
      headers,
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      // WP returns 400 rest_post_invalid_page_number once you walk past the
      // last page — treat that as "no more results" instead of throwing.
      if (res.status === 400) return { items: [], totalPages: page - 1 }
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.message || `WordPress list ${resource} failed: ${res.status}`)
    }
    const totalPages = Number(res.headers.get('x-wp-totalpages') || '1') || 1
    const data = await res.json()
    const items = Array.isArray(data) ? (data as WPListItem[]).map(mapWpListItem) : []
    return { items, totalPages }
  }

  const first = await fetchPage(1)
  const totalPages = Math.min(first.totalPages, maxPages)
  if (totalPages <= 1) return first.items

  // Fetch remaining pages with a small concurrency cap so we don't slam the
  // WP host — most shared hosts throttle bursty parallel REST requests.
  const remaining: number[] = []
  for (let p = 2; p <= totalPages; p++) remaining.push(p)

  const concurrency = 5
  const results: WPPageSummary[][] = new Array(remaining.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const idx = cursor++
      if (idx >= remaining.length) return
      const { items } = await fetchPage(remaining[idx])
      results[idx] = items
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, remaining.length) }, worker))

  return first.items.concat(...results.filter(Boolean))
}

export async function getPostFull({
  siteUrl,
  username,
  appPassword,
  postId,
  resource = 'posts',
}: {
  siteUrl: string
  username: string
  appPassword: string
  postId: number
  resource?: 'posts' | 'pages'
}): Promise<WPPageFull> {
  const baseUrl = normalizeUrl(siteUrl)

  const res = await fetch(`${baseUrl}/wp-json/wp/v2/${resource}/${postId}?context=edit`, {
    headers: { Authorization: getAuthHeader(username, appPassword), 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `WordPress read ${resource === 'pages' ? 'page' : 'post'} failed: ${res.status}`)
  }

  const data = await res.json()

  // context=edit returns raw for content/title/excerpt; fall back to rendered
  // if a plugin strips the raw field.
  const content: string = data.content?.raw ?? data.content?.rendered ?? ''
  const excerpt: string = data.excerpt?.raw ?? data.excerpt?.rendered ?? ''
  const title: string = stripEntities(data.title?.raw || data.title?.rendered || data.slug)

  // Yoast fields — two attempts.
  //
  // 1) Raw editable values from `data.meta._yoast_wpseo_*`. WordPress only
  //    includes a meta key here when it's registered with `show_in_rest`;
  //    Yoast normally registers these keys, but some sites (page post-type
  //    deregistered, security plugins that strip underscore-prefixed meta)
  //    return an empty `meta` object.
  //
  // 2) When the raw meta isn't available, fall back to `data.yoast_head_json.
  //    title` and `.description`. Yoast attaches this to every REST response
  //    without needing meta registration. It's the *rendered* output — any
  //    template placeholders (`%%sitename%%`, `%%sep%%`) are already
  //    substituted — which is what the user sees on the source page anyway.
  //    focusKeyphrase / keyphraseSynonyms don't have this fallback, so those
  //    only clone when raw meta is exposed.
  const meta = (data as { meta?: Record<string, unknown> }).meta ?? {}
  const readMeta = (key: string): string | undefined => {
    const v = meta[key]
    return typeof v === 'string' && v.length > 0 ? v : undefined
  }
  const head = (data as { yoast_head_json?: Record<string, unknown> }).yoast_head_json ?? {}
  const readHead = (key: string): string | undefined => {
    const v = head[key]
    return typeof v === 'string' && v.length > 0 ? v : undefined
  }

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
    yoastTitle: readMeta('_yoast_wpseo_title') ?? readHead('title'),
    yoastMetaDescription: readMeta('_yoast_wpseo_metadesc') ?? readHead('description'),
    focusKeyphrase: readMeta('_yoast_wpseo_focuskw'),
    keyphraseSynonyms: readMeta('_yoast_wpseo_keywordsynonyms'),
    template: typeof data.template === 'string' ? data.template : undefined,
  }
}

/**
 * Look up a published/draft/private/future WP item by slug. Returns null when
 * nothing matches — trash is excluded so a soft-deleted page doesn't block a
 * fresh publish. Used by the SEO Pages publish flow to detect that another
 * WordPress page already occupies the target slug (which WP would otherwise
 * silently suffix as `-2`).
 */
export async function findPostBySlug({
  siteUrl,
  username,
  appPassword,
  slug,
  resource = 'posts',
}: {
  siteUrl: string
  username: string
  appPassword: string
  slug: string
  resource?: 'posts' | 'pages'
}): Promise<{ id: number; slug: string; title: string; link: string; status: string } | null> {
  const baseUrl = normalizeUrl(siteUrl)
  const params = new URLSearchParams({
    slug,
    status: 'publish,draft,pending,private,future',
    per_page: '1',
    _fields: 'id,slug,title,link,status',
  })
  const res = await fetch(`${baseUrl}/wp-json/wp/v2/${resource}?${params}`, {
    headers: { Authorization: getAuthHeader(username, appPassword), 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `WordPress slug lookup failed: ${res.status}`)
  }
  const data = (await res.json()) as WPListItem[]
  if (!Array.isArray(data) || data.length === 0) return null
  const p = data[0]
  return {
    id: p.id,
    slug: p.slug,
    title: stripEntities(p.title?.raw || p.title?.rendered || p.slug),
    link: p.link,
    status: p.status,
  }
}

export async function updatePost({
  siteUrl,
  username,
  appPassword,
  postId,
  post,
  resource = 'posts',
}: {
  siteUrl: string
  username: string
  appPassword: string
  postId: number
  post: Partial<WPPost>
  resource?: 'posts' | 'pages'
}): Promise<WPPostResult> {
  const baseUrl = normalizeUrl(siteUrl)

  // `post` is the camelCase shape used across this file; WordPress wants its own
  // field names, so translate the ones we actually send on an update.
  const { dateGmt, featuredMediaId, ...rest } = post
  const body: Record<string, unknown> = { ...rest, comment_status: 'closed' }
  if (dateGmt) {
    body.date_gmt = toWpGmt(dateGmt)
    delete body.date
  }
  if (featuredMediaId) body.featured_media = featuredMediaId

  const res = await fetch(`${baseUrl}/wp-json/wp/v2/${resource}/${postId}`, {
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
