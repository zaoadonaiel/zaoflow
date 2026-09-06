'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Globe,
  FileText,
  Calendar,
  BarChart3,
  Settings,
  LogOut,
  Sparkles,
  Menu,
  X,
  Clock,
  Server,
  Archive,
  Users,
  Image as ImageIcon,
  MapPin,
  Plus,
  Activity,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import ThemeToggle from '@/components/ui/ThemeToggle'
import OpenRouterCredits from '@/components/layout/OpenRouterCredits'
import toast from 'react-hot-toast'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/sites', label: 'Sites', icon: Globe },
  { href: '/nodejs-sites', label: 'Node JS Sites', icon: Server },
  { href: '/articles', label: 'Articles', icon: FileText },
  { href: '/seo-pages', label: 'SEO Pages', icon: MapPin },
  { href: '/schedules', label: 'Schedules', icon: Calendar },
  { href: '/images', label: 'Images', icon: ImageIcon },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/archive', label: 'Archive', icon: Archive },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/stats', label: 'Stats', icon: Activity },
  { href: '/history', label: 'History', icon: Clock },
]

interface SidebarProps {
  userEmail?: string
  userName?: string
}

const NEW_MENU_ITEMS = [
  { href: '/articles/new', label: 'Article', icon: FileText },
  { href: '/sites?new=1', label: 'Site', icon: Globe },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/seo-pages/new', label: 'SEO page', icon: MapPin },
]

export default function Sidebar({ userEmail, userName }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const newMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { setIsOpen(false); setNewMenuOpen(false) }, [pathname])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setIsOpen(false); setNewMenuOpen(false) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!newMenuOpen) return
    function onClickOutside(e: MouseEvent) {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setNewMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [newMenuOpen])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success('Signed out')
    router.push('/login')
  }

  const navContent = (
    <>
      {/* Logo */}
      <div className="h-16 flex items-center px-5 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2.5 flex-1">
          <img src="/logo.png" alt="Zao Flo" className="w-8 h-8 flex-shrink-0" />
          <span className="text-lg font-bold text-gray-900 dark:text-white">Zao Flo</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="md:hidden p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                  isActive
                    ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 border border-brand-100 dark:border-brand-800'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
                }`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 transition-colors ${isActive ? 'text-brand-600 dark:text-brand-400' : 'text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300'}`} />
                <span className="flex-1">{label}</span>
                {isActive && <div className="w-1.5 h-1.5 rounded-full bg-brand-600 dark:bg-brand-400" />}
              </Link>
            )
          })}
        </div>

        <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-0.5">
          <Link
            href="/settings"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
              pathname.startsWith('/settings')
                ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 border border-brand-100 dark:border-brand-800'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
            }`}
          >
            <Settings className={`w-4 h-4 flex-shrink-0 ${pathname.startsWith('/settings') ? 'text-brand-600 dark:text-brand-400' : 'text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300'}`} />
            Settings
          </Link>
        </div>

        {/* Live OpenRouter balance parked at the bottom of the nav so it
            scrolls with everything else instead of being pinned under the
            logo — a "no credits" state is still visible before a generation
            click, just without eating a permanent slot. */}
        <OpenRouterCredits />
      </nav>

      {/* User section */}
      <div className="border-t border-gray-100 dark:border-gray-800 p-3 flex-shrink-0">
        <div className="flex items-center gap-2 px-2 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          <div className="w-8 h-8 bg-brand-100 dark:bg-brand-900/40 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-brand-700 dark:text-brand-400 text-xs font-bold uppercase">
              {(userName || userEmail || 'U').charAt(0)}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            {userName && <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{userName}</p>}
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{userEmail}</p>
          </div>
          <ThemeToggle />
          <button
            onClick={handleSignOut}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors p-1 rounded"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 h-14 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 flex items-center px-4 gap-3">
        <button
          onClick={() => setIsOpen(true)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Zao Flo" className="w-6 h-6" />
          <span className="font-bold text-gray-900 dark:text-white">Zao Flo</span>
        </div>
        {/* Quick-create menu sits next to the theme toggle so a new article,
            site, SEO page, or analytics jump is one tap away from anywhere
            in the app — it used to be an article-only shortcut, which meant
            everything else required opening the drawer first. */}
        <div className="ml-auto flex items-center gap-1">
          <div className="relative" ref={newMenuRef}>
            <button
              type="button"
              onClick={() => setNewMenuOpen((v) => !v)}
              title="New"
              aria-label="New"
              aria-expanded={newMenuOpen}
              aria-haspopup="menu"
              className="flex items-center justify-center w-9 h-9 rounded-full bg-brand-600 text-white hover:bg-brand-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
            {newMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-44 rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1 z-40"
              >
                {NEW_MENU_ITEMS.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    role="menuitem"
                    onClick={() => setNewMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <Icon className="w-4 h-4 text-gray-400" />
                    {label}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <ThemeToggle />
        </div>
      </div>

      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 bottom-0 w-60 bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800 flex flex-col z-50 transition-transform duration-200
          md:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        {navContent}
      </aside>
    </>
  )
}
