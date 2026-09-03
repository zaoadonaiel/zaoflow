import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ARCHIVE_MIGRATION_MESSAGE, isMissingTableError } from '@/lib/idea-archive'
import { isNoRowsError } from '@/lib/knowledge-base'

/** One archived idea, for the form that is about to write it. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: idea, error } = await supabase
    .from('archived_ideas')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (error && !isNoRowsError(error)) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ error: ARCHIVE_MIGRATION_MESSAGE }, { status: 503 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!idea) return NextResponse.json({ error: 'That idea is no longer in the archive' }, { status: 404 })

  return NextResponse.json({ idea })
}

/**
 * Takes an idea out of the archive.
 *
 * The only way out: an idea leaves when it is used, and there is no delete
 * anywhere in the UI. An archive you can empty by accident is not one you
 * would trust a topic to.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('archived_ideas')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
