'use client'

import { Users, MousePointerClick, FileText, Activity } from 'lucide-react'

interface SummaryCardsProps {
  summary: {
    sessions: number
    users: number
    pageviews: number
    engagementRate: number
  }
}

export default function SummaryCards({ summary }: SummaryCardsProps) {
  const cards = [
    {
      label: 'Sessions',
      value: summary.sessions.toLocaleString(),
      icon: MousePointerClick,
      color: 'text-brand-600 bg-brand-50 dark:bg-brand-500/10',
    },
    {
      label: 'Users',
      value: summary.users.toLocaleString(),
      icon: Users,
      color: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10',
    },
    {
      label: 'Page Views',
      value: summary.pageviews.toLocaleString(),
      icon: FileText,
      color: 'text-purple-600 bg-purple-50 dark:bg-purple-500/10',
    },
    {
      label: 'Engagement Rate',
      value: `${(summary.engagementRate * 100).toFixed(1)}%`,
      icon: Activity,
      color: 'text-green-600 bg-green-50 dark:bg-green-500/10',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ label, value, icon: Icon, color }) => (
        <div
          key={label}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
              <Icon className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
        </div>
      ))}
    </div>
  )
}
