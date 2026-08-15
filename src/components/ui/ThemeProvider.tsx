'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'light',
  toggle: () => {},
})

export function useTheme() {
  return useContext(ThemeCtx)
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    const saved = localStorage.getItem('zaoflo_theme') as Theme | null
    if (saved === 'dark' || saved === 'light') {
      setTheme(saved)
      document.documentElement.classList.toggle('dark', saved === 'dark')
    } else {
      // Respect OS setting when no saved preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      setTheme(prefersDark ? 'dark' : 'light')
      document.documentElement.classList.toggle('dark', prefersDark)
    }

    // Listen for OS-level changes (only when no saved preference)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function onSystemChange(e: MediaQueryListEvent) {
      if (!localStorage.getItem('zaoflo_theme')) {
        setTheme(e.matches ? 'dark' : 'light')
        document.documentElement.classList.toggle('dark', e.matches)
      }
    }
    mq.addEventListener('change', onSystemChange)
    return () => mq.removeEventListener('change', onSystemChange)
  }, [])

  function toggle() {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem('zaoflo_theme', next)
      document.documentElement.classList.toggle('dark', next === 'dark')
      return next
    })
  }

  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>
}
