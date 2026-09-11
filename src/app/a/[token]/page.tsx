import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { formatInZone } from '@/lib/timezone'

/**
 * Public single-article preview.
 *
 * The Articles list on the dashboard offers an "eye" icon that links here so
 * the team can send a client a plain read of an article before it publishes.
 * No auth, no code gate — the long random `preview_token` in the URL is
 * unguessable enough that a leaked link is the same risk as a leaked
 * private-page URL anywhere else, and revoking a link is a single row update.
 *
 * Server-rendered from the service client, since a visitor has no session and
 * RLS on the articles table would otherwise return zero rows.
 */

export const dynamic = 'force-dynamic'

interface PreviewArticle {
  title: string
  content: string
  featured_image_url: string | null
  featured_image_alt: string | null
  status: string
  scheduled_at: string | null
  scheduled_tz: string | null
  published_at: string | null
  sites: { name: string | null } | null
}

async function loadPreview(token: string): Promise<PreviewArticle | null> {
  // Very cheap sanity check on the shape — a 24-byte hex token is 48 chars.
  // Anything else is not one of ours and does not need to hit the database.
  if (!/^[a-f0-9]{16,128}$/i.test(token)) return null

  const supabase = createServiceClient()
  const { data } = await supabase
    .from('articles')
    .select(
      'title, content, featured_image_url, featured_image_alt, ' +
        'status, scheduled_at, scheduled_tz, published_at, sites(name)',
    )
    .eq('preview_token', token)
    .maybeSingle()

  if (!data) return null
  return data as unknown as PreviewArticle
}

/**
 * The date banner at the top: what the client is looking at is either
 * already live, going out at a specific time, or still a draft with no
 * committed slot yet.
 */
function scheduleLine(a: PreviewArticle): string {
  if (a.status === 'published' && a.published_at) {
    return `Published ${formatInZone(a.published_at, a.scheduled_tz || 'PST', 'long')}`
  }
  if (a.scheduled_at) {
    return `Scheduled for ${formatInZone(a.scheduled_at, a.scheduled_tz || 'PST', 'long')}`
  }
  return 'Not yet scheduled'
}

export default async function ArticlePreviewPage({
  params,
}: {
  params: { token: string }
}) {
  const article = await loadPreview(params.token)
  if (!article) notFound()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Scheduled-date banner. Sits above the article so the client sees
          when this goes out before they scroll into the body. */}
      <div className="bg-brand-600 text-white text-center py-3 px-4 text-sm font-medium">
        {scheduleLine(article)}
        {article.sites?.name && (
          <span className="opacity-80"> · {article.sites.name}</span>
        )}
      </div>

      <article className="mx-auto max-w-3xl px-5 sm:px-8 py-10 sm:py-14">
        {article.featured_image_url && (
          <div className="mb-8 overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-800">
            {/* Plain <img> rather than next/image: the URL is remote and set
                by the team, and configuring next.config's remotePatterns for
                every WP host would trade a preview page for a config edit. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={article.featured_image_url}
              alt={article.featured_image_alt || article.title}
              className="w-full h-auto object-cover"
            />
          </div>
        )}

        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white leading-tight">
          {article.title}
        </h1>

        {/* Uses the same base styles the in-app editor uses, so the preview
            reads like the composed article rather than like unstyled HTML. */}
        <div
          className="article-editor mt-8 text-gray-800 dark:text-gray-200"
          dangerouslySetInnerHTML={{ __html: article.content }}
        />
      </article>

      <footer className="pb-10 text-center text-xs text-gray-400 dark:text-gray-600">
        Preview · not for public distribution
      </footer>
    </div>
  )
}
