import { createClient } from '@/lib/supabase/server'
import { Globe, FileText, Calendar, BarChart3, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import Badge, { statusToBadgeVariant } from '@/components/ui/Badge'
import Header from '@/components/layout/Header'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [
    { count: sitesCount },
    { count: articlesCount },
    { count: schedulesCount },
    { data: recentArticles },
    { count: publishedCount },
  ] = await Promise.all([
    supabase.from('sites').select('*', { count: 'exact', head: true }).eq('user_id', user!.id),
    supabase.from('articles').select('*', { count: 'exact', head: true }).eq('user_id', user!.id),
    supabase.from('schedules').select('*', { count: 'exact', head: true }).eq('user_id', user!.id).eq('is_active', true),
    supabase.from('articles').select('id, title, status, created_at, sites(name)').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(5),
    supabase.from('articles').select('*', { count: 'exact', head: true }).eq('user_id', user!.id).eq('status', 'published'),
  ])

  const stats = [
    { label: 'Connected Sites', value: sitesCount ?? 0, icon: Globe, href: '/sites', color: 'text-blue-600 bg-blue-50' },
    { label: 'Total Articles', value: articlesCount ?? 0, icon: FileText, href: '/articles', color: 'text-brand-600 bg-brand-50' },
    { label: 'Active Schedules', value: schedulesCount ?? 0, icon: Calendar, href: '/schedules', color: 'text-green-600 bg-green-50' },
    { label: 'Published Posts', value: publishedCount ?? 0, icon: BarChart3, href: '/analytics', color: 'text-orange-600 bg-orange-50' },
  ]

  return (
    <div>
      {/* The shared header, so the plus that makes an article or a site — and
          the notifications beside it — are in the same place here as on every
          other page. */}
      <Header
        title="Dashboard"
        subtitle="Overview of your content publishing activity"
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map(({ label, value, icon: Icon, href, color }) => (
          <Link
            key={label}
            href={href}
            className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 hover:border-gray-200 dark:hover:border-gray-600 hover:shadow-sm transition-all group"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{label}</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
            <div className="flex items-center gap-1 mt-3 text-xs text-gray-400 dark:text-gray-500 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
              View all <ArrowRight className="w-3 h-3" />
            </div>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent articles */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="font-semibold text-gray-900 dark:text-white">Recent Articles</h2>
            <Link href="/articles" className="text-sm text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {recentArticles && recentArticles.length > 0 ? (
            <div className="divide-y divide-gray-50 dark:divide-gray-700">
              {recentArticles.map((article) => (
                <Link
                  key={article.id}
                  href={`/articles/${article.id}`}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{article.title}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {/* @ts-expect-error supabase join typing */}
                      {article.sites?.name} · {format(new Date(article.created_at), 'MMM d, yyyy')}
                    </p>
                  </div>
                  <Badge variant={statusToBadgeVariant(article.status)}>
                    {article.status}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
                <FileText className="w-6 h-6 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">No articles yet</p>
              <Link
                href="/articles/new"
                className="text-sm text-brand-600 dark:text-brand-400 font-medium hover:underline"
              >
                Write your first article →
              </Link>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h2>
            <div className="space-y-2">
              {[
                { href: '/articles/new', label: 'Write new article', icon: FileText },
                { href: '/sites', label: 'Add a WordPress site', icon: Globe },
                { href: '/schedules', label: 'Set up auto-publishing', icon: Calendar },
                { href: '/settings', label: 'Add OpenRouter API key', icon: BarChart3 },
              ].map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white group"
                >
                  <div className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center group-hover:bg-brand-50 dark:group-hover:bg-brand-900/30 transition-colors">
                    <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400 group-hover:text-brand-600 dark:group-hover:text-brand-400" />
                  </div>
                  {label}
                  <ArrowRight className="w-3.5 h-3.5 ml-auto text-gray-300 dark:text-gray-600 group-hover:text-brand-500 dark:group-hover:text-brand-400" />
                </Link>
              ))}
            </div>
          </div>

          <div className="bg-brand-600 rounded-2xl p-5 text-white">
            <h3 className="font-semibold mb-1">Set up autopilot</h3>
            <p className="text-sm text-brand-100 mb-4">Schedule recurring AI content publishing and let Zao Flo run on its own.</p>
            <Link
              href="/schedules"
              className="inline-flex items-center gap-2 bg-white text-brand-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-50 transition-colors"
            >
              Create schedule <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
