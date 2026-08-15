export interface WPPost {
  title: string
  content: string
  excerpt?: string
  status: 'draft' | 'publish' | 'future'
  date?: string
  categories?: number[]
  slug?: string
  featuredImageUrl?: string   // Supabase/external URL — will be downloaded and uploaded to WP
  focusKeyphrase?: string
  keyphraseSynonyms?: string
  yoastTitle?: string
  yoastMetaDescription?: string
  featuredMediaId?: number    // if already uploaded, use this directly
}

export interface WPPostResult {
  id: number
  link: string
  status: string
}

function getAuthHeader(username: string, appPassword: string): string {
  return 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64')
}

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '')
}

export async function uploadMedia({
  siteUrl,
  username,
  appPassword,
  imageUrl,
  filename,
}: {
  siteUrl: string
  username: string
  appPassword: string
  imageUrl: string
  filename?: string
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
  }
  const ext = extMap[mimeBase] ?? '.jpg'

  const arrayBuffer = await imgRes.arrayBuffer()

  const baseUrl = normalizeUrl(siteUrl)
  const res = await fetch(`${baseUrl}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(username, appPassword),
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
  try {
    const baseUrl = normalizeUrl(siteUrl)

    // Test credentials
    const userRes = await fetch(`${baseUrl}/wp-json/wp/v2/users/me`, {
      headers: { Authorization: getAuthHeader(username, appPassword) },
      signal: AbortSignal.timeout(10000),
    })

    if (!userRes.ok) {
      if (userRes.status === 401 || userRes.status === 403) {
        return { success: false, error: 'Invalid username or application password.' }
      }
      return { success: false, error: `WordPress returned status ${userRes.status}.` }
    }

    // Get site name
    const siteRes = await fetch(`${baseUrl}/wp-json`, {
      signal: AbortSignal.timeout(10000),
    })
    const siteData = await siteRes.json().catch(() => ({}))

    return { success: true, siteName: siteData.name || siteUrl }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('timeout') || msg.includes('fetch')) {
      return { success: false, error: 'Could not reach the WordPress site. Check the URL.' }
    }
    return { success: false, error: msg }
  }
}

export async function publishPost({
  siteUrl,
  username,
  appPassword,
  post,
}: {
  siteUrl: string
  username: string
  appPassword: string
  post: WPPost
}): Promise<WPPostResult> {
  const baseUrl = normalizeUrl(siteUrl)

  const body: Record<string, unknown> = {
    title: post.title,
    content: post.content,
    status: post.status,
  }
  if (post.excerpt) body.excerpt = post.excerpt
  if (post.date) body.date = post.date
  if (post.categories?.length) body.categories = post.categories
  if (post.slug) body.slug = post.slug
  if (post.featuredMediaId) body.featured_media = post.featuredMediaId

  const meta: Record<string, string> = {}
  if (post.focusKeyphrase) meta['_yoast_wpseo_focuskw'] = post.focusKeyphrase
  if (post.yoastMetaDescription) meta['_yoast_wpseo_metadesc'] = post.yoastMetaDescription
  if (post.yoastTitle) meta['_yoast_wpseo_title'] = post.yoastTitle
  if (Object.keys(meta).length > 0) body.meta = meta

  const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts`, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(username, appPassword),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `WordPress publish failed: ${res.status}`)
  }

  const data = await res.json()
  return { id: data.id, link: data.link, status: data.status }
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
    headers: { Authorization: getAuthHeader(username, appPassword) },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `WordPress delete failed: ${res.status}`)
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

  const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${postId}`, {
    method: 'PUT',
    headers: {
      Authorization: getAuthHeader(username, appPassword),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(post),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `WordPress update failed: ${res.status}`)
  }

  const data = await res.json()
  return { id: data.id, link: data.link, status: data.status }
}
