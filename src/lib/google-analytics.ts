// Server-only helpers for Google OAuth, GA4 (Analytics Data/Admin API), and
// Search Console (Webmasters API). Never import this from a client component.

import type { SupabaseClient } from '@supabase/supabase-js'

const GOOGLE_SCOPES =
  'https://www.googleapis.com/auth/analytics.edit https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly'

export function getGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI!,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
    include_granted_scopes: 'true',
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type?: string
}

async function parseGoogleError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    return body?.error?.message || body?.error_description || body?.error || fallback
  } catch {
    return fallback
  }
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }),
  })

  if (!res.ok) {
    throw new Error(await parseGoogleError(res, 'Failed to exchange authorization code'))
  }

  return res.json()
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    throw new Error(await parseGoogleError(res, 'Failed to refresh Google access token'))
  }

  return res.json()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getValidAccessToken(userId: string, supabase: SupabaseClient<any>): Promise<string> {
  const { data: connection, error } = await supabase
    .from('google_connections')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !connection) {
    throw new Error('Google account not connected')
  }

  const expiresAt = new Date(connection.expires_at).getTime()
  const fiveMinutes = 5 * 60 * 1000

  if (expiresAt - Date.now() < fiveMinutes) {
    const refreshed = await refreshAccessToken(connection.refresh_token)
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()

    await supabase
      .from('google_connections')
      .update({
        access_token: refreshed.access_token,
        expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    return refreshed.access_token
  }

  return connection.access_token
}

async function googleFetch(url: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })

  if (!res.ok) {
    throw new Error(await parseGoogleError(res, `Google API request failed (${res.status})`))
  }

  return res.json()
}

export interface GA4Property {
  propertyId: string
  displayName: string
  accountName: string
}

export async function listGA4Properties(accessToken: string): Promise<GA4Property[]> {
  const data = await googleFetch(
    'https://analyticsadmin.googleapis.com/v1beta/accountSummaries',
    accessToken
  )

  const properties: GA4Property[] = []
  for (const account of data.accountSummaries || []) {
    for (const property of account.propertySummaries || []) {
      properties.push({
        // propertySummaries[].property is like "properties/123456"
        propertyId: (property.property || '').replace('properties/', ''),
        displayName: property.displayName || property.property,
        accountName: account.displayName || '',
      })
    }
  }

  return properties
}

export async function getGA4MeasurementId(
  accessToken: string,
  propertyId: string
): Promise<string | null> {
  const normalizedId = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`

  const data = await googleFetch(
    `https://analyticsadmin.googleapis.com/v1beta/${normalizedId}/dataStreams`,
    accessToken
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webStream = (data.dataStreams || []).find((s: any) => s.webStreamData)

  return webStream?.webStreamData?.measurementId ?? null
}

export interface GA4Account {
  accountId: string // e.g. "accounts/123456"
  displayName: string
}

export async function listGA4Accounts(accessToken: string): Promise<GA4Account[]> {
  const data = await googleFetch('https://analyticsadmin.googleapis.com/v1beta/accounts', accessToken)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data.accounts || []) as any[]).map((a) => ({
    accountId: a.name,
    displayName: a.displayName || a.name,
  }))
}

export async function createGA4Property(
  accessToken: string,
  accountId: string,
  displayName: string
): Promise<{ propertyId: string }> {
  const normalizedAccount = accountId.startsWith('accounts/') ? accountId : `accounts/${accountId}`

  const data = await googleFetch(
    'https://analyticsadmin.googleapis.com/v1beta/properties',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        parent: normalizedAccount,
        displayName,
        timeZone: 'America/New_York',
        currencyCode: 'USD',
      }),
    }
  )

  return { propertyId: (data.name || '').replace('properties/', '') }
}

export async function createGA4WebDataStream(
  accessToken: string,
  propertyId: string,
  displayName: string,
  websiteUrl: string
): Promise<{ measurementId: string | null }> {
  const normalizedId = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`

  const data = await googleFetch(
    `https://analyticsadmin.googleapis.com/v1beta/${normalizedId}/dataStreams`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        type: 'WEB_DATA_STREAM',
        displayName,
        webStreamData: { defaultUri: websiteUrl },
      }),
    }
  )

  return { measurementId: data.webStreamData?.measurementId ?? null }
}

export interface SearchConsoleSite {
  siteUrl: string
  permissionLevel: string
}

export async function listSearchConsoleSites(accessToken: string): Promise<SearchConsoleSite[]> {
  const data = await googleFetch('https://www.googleapis.com/webmasters/v3/sites', accessToken)

  return (data.siteEntry || []).filter(
    (site: SearchConsoleSite) => site.permissionLevel !== 'siteUnverifiedUser'
  )
}

export interface GA4Report {
  summary: {
    sessions: number
    users: number
    pageviews: number
    engagementRate: number
  }
  trend: Array<{ date: string; sessions: number; users: number }>
  topPages: Array<{ path: string; views: number }>
  countries: Array<{ country: string; sessions: number }>
}

async function runReport(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  const normalizedId = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`

  return googleFetch(
    `https://analyticsdata.googleapis.com/v1beta/${normalizedId}:runReport`,
    accessToken,
    { method: 'POST', body: JSON.stringify(body) }
  )
}

function numFromRow(row: { metricValues?: Array<{ value: string }> }, idx: number): number {
  const raw = row.metricValues?.[idx]?.value
  return raw !== undefined ? Number(raw) : 0
}

export async function runGA4Report(
  accessToken: string,
  propertyId: string,
  startDate: string,
  endDate: string
): Promise<GA4Report> {
  const dateRanges = [{ startDate, endDate }]

  const [trendData, pagesData, countriesData] = await Promise.all([
    runReport(accessToken, propertyId, {
      dateRanges,
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'screenPageViews' },
        { name: 'engagementRate' },
      ],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    }),
    runReport(accessToken, propertyId, {
      dateRanges,
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 10,
    }),
    runReport(accessToken, propertyId, {
      dateRanges,
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    }),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trendRows: any[] = trendData.rows || []
  let totalSessions = 0
  let totalUsers = 0
  let totalPageviews = 0
  let engagementSum = 0

  const trend = trendRows.map((row) => {
    const dateRaw = row.dimensionValues?.[0]?.value || ''
    // GA4 returns dates as YYYYMMDD
    const date =
      dateRaw.length === 8
        ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
        : dateRaw

    const sessions = numFromRow(row, 0)
    const users = numFromRow(row, 1)
    const pageviews = numFromRow(row, 2)
    const engagementRate = numFromRow(row, 3)

    totalSessions += sessions
    totalUsers += users
    totalPageviews += pageviews
    engagementSum += engagementRate

    return { date, sessions, users }
  })

  const summary = {
    sessions: totalSessions,
    users: totalUsers,
    pageviews: totalPageviews,
    engagementRate: trendRows.length ? engagementSum / trendRows.length : 0,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topPages = ((pagesData.rows || []) as any[]).map((row) => ({
    path: row.dimensionValues?.[0]?.value || '',
    views: numFromRow(row, 0),
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const countries = ((countriesData.rows || []) as any[]).map((row) => ({
    country: row.dimensionValues?.[0]?.value || '',
    sessions: numFromRow(row, 0),
  }))

  return { summary, trend, topPages, countries }
}

export interface SearchConsoleKeyword {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export async function runSearchConsoleQuery(
  accessToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string
): Promise<SearchConsoleKeyword[]> {
  const data = await googleFetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['query'],
        rowLimit: 25,
      }),
    }
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data.rows || []) as any[]).map((row) => ({
    query: row.keys?.[0] || '',
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }))
}
