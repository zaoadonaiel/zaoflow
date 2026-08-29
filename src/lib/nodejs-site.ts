export interface NodePost {
  title: string
  slug?: string
  content: string
  excerpt?: string
  metaDescription?: string
  featuredImageUrl?: string
  status: 'publish' | 'draft'
  publishedAt?: string
}

export interface NodePostResult {
  id: string
  url: string
  status: string
}

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '')
}

function authHeader(apiKey: string): string {
  return `Bearer ${apiKey}`
}

export async function testNodeConnection({
  apiUrl,
  apiKey,
}: {
  apiUrl: string
  apiKey: string
}): Promise<{ success: boolean; error?: string; siteName?: string }> {
  try {
    const baseUrl = normalizeUrl(apiUrl)

    const res = await fetch(`${baseUrl}/api/zaoflo/health`, {
      headers: { Authorization: authHeader(apiKey) },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { success: false, error: 'Invalid API key.' }
      }
      return { success: false, error: `Site returned status ${res.status}.` }
    }

    const data = await res.json().catch(() => ({}))
    return { success: true, siteName: data.siteName || data.name || apiUrl }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('timeout') || msg.includes('fetch')) {
      return { success: false, error: 'Could not reach the Node.js site. Check the URL.' }
    }
    return { success: false, error: msg }
  }
}

export async function publishPost({
  apiUrl,
  apiKey,
  post,
}: {
  apiUrl: string
  apiKey: string
  post: NodePost
}): Promise<NodePostResult> {
  const baseUrl = normalizeUrl(apiUrl)

  const body: Record<string, unknown> = {
    title: post.title,
    content: post.content,
    status: post.status,
  }
  if (post.slug) body.slug = post.slug
  if (post.excerpt) body.excerpt = post.excerpt
  if (post.metaDescription) body.metaDescription = post.metaDescription
  if (post.featuredImageUrl) body.featuredImageUrl = post.featuredImageUrl
  if (post.publishedAt) body.publishedAt = post.publishedAt

  const res = await fetch(`${baseUrl}/api/zaoflo/posts`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error || `Node.js publish failed: ${res.status}`)
  }

  const data = await res.json()
  return {
    id: String(data.id),
    url: data.url,
    status: data.status,
  }
}

export async function updatePost({
  apiUrl,
  apiKey,
  postId,
  post,
}: {
  apiUrl: string
  apiKey: string
  postId: string
  post: Partial<NodePost>
}): Promise<NodePostResult> {
  const baseUrl = normalizeUrl(apiUrl)

  const res = await fetch(`${baseUrl}/api/zaoflo/posts/${postId}`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(post),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error || `Node.js update failed: ${res.status}`)
  }

  const data = await res.json()
  return {
    id: String(data.id),
    url: data.url,
    status: data.status,
  }
}

export async function deletePost({
  apiUrl,
  apiKey,
  postId,
}: {
  apiUrl: string
  apiKey: string
  postId: string
}): Promise<void> {
  const baseUrl = normalizeUrl(apiUrl)

  const res = await fetch(`${baseUrl}/api/zaoflo/posts/${postId}`, {
    method: 'DELETE',
    headers: {
      Authorization: authHeader(apiKey),
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error || `Node.js delete failed: ${res.status}`)
  }
}
