import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  knowledgeBaseLimitError,
  isMissingColumnError,
  isNoRowsError,
  MIGRATION_REQUIRED_MESSAGE,
} from '@/lib/knowledge-base'

/**
 * The site knowledge base, on its own endpoint rather than through the generic
 * site PATCH — the article page reads and writes it without ever holding the
 * rest of the site row.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // select('*') so a database still waiting on migration 015 returns the site
  // with the column simply absent, rather than failing the read.
  const { data: site, error } = await supabase
    .from('sites')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (error && !isNoRowsError(error)) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  // The row came back but has no such field: the column does not exist yet.
  // Said plainly here, because an empty box is indistinguishable from an empty
  // knowledge base and would send you writing one that cannot save.
  const migrationRequired = !('knowledge_base' in site)

  return NextResponse.json({
    site_id: site.id,
    site_name: site.name,
    knowledge_base: site.knowledge_base || '',
    migration_required: migrationRequired,
    ...(migrationRequired ? { warning: MIGRATION_REQUIRED_MESSAGE } : {}),
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const knowledgeBase =
    typeof body.knowledge_base === 'string' ? body.knowledge_base.trim() : ''

  const limitError = knowledgeBaseLimitError(knowledgeBase)
  if (limitError) return NextResponse.json({ error: limitError }, { status: 400 })

  const { data: site, error } = await supabase
    .from('sites')
    .update({ knowledge_base: knowledgeBase, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('id, name, knowledge_base')
    .single()

  // Nothing to fall back to on a write — say which migration is missing rather
  // than passing Postgres's "column does not exist" through to the user.
  if (isMissingColumnError(error)) {
    return NextResponse.json({ error: MIGRATION_REQUIRED_MESSAGE }, { status: 503 })
  }
  if (error && !isNoRowsError(error)) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  return NextResponse.json({
    site_id: site.id,
    site_name: site.name,
    knowledge_base: site.knowledge_base || '',
  })
}
