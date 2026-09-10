import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import WebSocket from 'ws'

/**
 * Realtime transport for supabase-js.
 *
 * The RealtimeClient inside supabase-js is constructed eagerly on client
 * creation and warns when it cannot find a native WebSocket. Trigger.dev
 * still ships Node 21 (no native `WebSocket` global), so every service-client
 * init logged a "Node.js 21 detected without native WebSocket support"
 * warning even though the tasks only ever do DB reads/writes and never call
 * `.channel()`. Supabase-js has no way to disable realtime, so we hand it a
 * real transport (`ws`) once, and both clients pick it up.
 *
 * Vercel serverless (Node 20 at the time of writing) is in the same boat, so
 * the request-scoped `createClient` gets the same treatment.
 *
 * The cast is because supabase-js types the transport as the browser
 * `WebSocket` constructor -- `ws`'s implementation is API-compatible but
 * declares a different constructor signature.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const realtimeTransport = { transport: WebSocket as any }

export function createClient() {
  const cookieStore = cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              cookieStore.set(name, value, options as any)
            )
          } catch {
            // Ignore — setAll called from Server Component
          }
        },
      },
      realtime: realtimeTransport,
    }
  )
}

export function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() { return [] },
        setAll() {},
      },
      realtime: realtimeTransport,
    }
  )
}
