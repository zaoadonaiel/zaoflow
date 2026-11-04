import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
import { SIDEBAR_STORAGE_KEY } from '@/lib/sidebar-state'

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
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Restores the collapsed sidebar before first paint, so a reload does
          not flash the wide one. The Sidebar owns the toggle. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `try{if(localStorage.getItem('${SIDEBAR_STORAGE_KEY}')==='collapsed')document.documentElement.dataset.sidebar='collapsed'}catch(e){}`,
        }}
      />
      <Sidebar
        userEmail={profile?.email || user.email}
        userName={profile?.full_name || undefined}
      />
      <main className="flex-1 min-h-screen pt-14 md:pt-0 md:ml-60 md:[html[data-sidebar=collapsed]_&]:ml-16 transition-[margin] duration-200 overflow-x-hidden">
        <div className="w-full px-4 md:px-8 py-6 md:py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
