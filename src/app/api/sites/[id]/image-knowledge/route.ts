import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  imageKnowledgeLimitError,
  isMissingImageKbColumnError,
  isMissingReferenceTableError,
  IMAGE_KB_MIGRATION_MESSAGE,
} from '@/lib/image-knowledge'
import { isNoRowsError } from '@/lib/knowledge-base'

/**
 * Per-site image guidance: the text rules ("no residential doors", "the owner
 * is a white woman") plus the list of reference images uploaded for the site.
 * Kept on its own endpoint like /knowledge so the image-generator modal reads
 * and writes it without loading the whole site row.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // select('*') so a database still waiting on migration 043 returns the row
  // with the column absent rather than failing the read.
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

  const migrationRequired = !('image_knowledge_base' in site)

  const { data: refs, error: refsError } = await supabase
    .from('site_reference_images')
    .select('id, kind, label, description, url, storage_path, created_at, bytes')
    .eq('site_id', params.id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const refsMissing = isMissingReferenceTableError(refsError)

  return NextResponse.json({
    site_id: site.id,
    site_name: site.name,
    image_knowledge_base: site.image_knowledge_base || '',
    references: refsMissing ? [] : refs || [],
    migration_required: migrationRequired || refsMissing,
    ...(migrationRequired || refsMissing ? { warning: IMAGE_KB_MIGRATION_MESSAGE } : {}),
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
  const value =
    typeof body.image_knowledge_base === 'string' ? body.image_knowledge_base.trim() : ''

  const limitError = imageKnowledgeLimitError(value)
  if (limitError) return NextResponse.json({ error: limitError }, { status: 400 })

  const { data: site, error } = await supabase
    .from('sites')
    .update({ image_knowledge_base: value, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('id, name, image_knowledge_base')
    .single()

  if (isMissingImageKbColumnError(error)) {
    return NextResponse.json({ error: IMAGE_KB_MIGRATION_MESSAGE }, { status: 503 })
  }
  if (error && !isNoRowsError(error)) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  return NextResponse.json({
    site_id: site.id,
    site_name: site.name,
    image_knowledge_base: site.image_knowledge_base || '',
  })
}
