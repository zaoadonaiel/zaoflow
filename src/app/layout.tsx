import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from 'react-hot-toast'
import ThemeProvider from '@/components/ui/ThemeProvider'

export const metadata: Metadata = {
  title: 'Zaoflo — AI WordPress Publishing Autopilot',
  description: 'Publish SEO-optimized content to multiple WordPress sites on autopilot. Connect your sites, choose an AI model, set a schedule.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 antialiased transition-colors duration-200">
        <ThemeProvider>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                borderRadius: '10px',
                background: '#1f2937',
                color: '#fff',
                fontSize: '14px',
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
