import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', user.id)
    .single()

  return (
    <div className="flex min-h-screen w-full bg-gray-50 dark:bg-gray-900 overflow-x-hidden">
      <Sidebar
        userEmail={profile?.email || user.email}
        userName={profile?.full_name || undefined}
      />
      <main className="flex-1 w-full md:ml-0 min-h-screen pt-14 md:pt-0 overflow-x-hidden">
        <div className="w-full max-w-full px-4 md:px-8 py-6 md:py-8 overflow-x-hidden">
          {children}
        </div>
      </main>
    </div>
  )
}
