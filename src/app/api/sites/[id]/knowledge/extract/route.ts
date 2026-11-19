import { NextRequest, NextResponse } from 'next/server'
import mammoth from 'mammoth'
import { extractText, getDocumentProxy } from 'unpdf'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

/** The host rejects request bodies over ~4.5 MB, so stay under it. */
const MAX_BYTES = 4 * 1024 * 1024

/**
 * Turns an uploaded Word, PDF or text file into plain text for the site
 * knowledge base. Nothing is saved here — the text goes back to the editor,
 * where it can be reviewed and trimmed before the normal (code-gated) save.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: site } = await supabase
    .from('sites').select('id').eq('id', params.id).eq('user_id', user.id).single()
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Choose a file to upload' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 4 MB.` },
      { status: 413 },
    )
  }

  const name = file.name.toLowerCase()
  const buf = Buffer.from(await file.arrayBuffer())
  let text = ''

  try {
    if (name.endsWith('.docx')) {
      text = (await mammoth.extractRawText({ buffer: buf })).value
    } else if (name.endsWith('.pdf')) {
      const pdf = await getDocumentProxy(new Uint8Array(buf))
      text = (await extractText(pdf, { mergePages: true })).text
    } else if (name.endsWith('.txt') || name.endsWith('.md')) {
      text = buf.toString('utf8')
    } else if (name.endsWith('.doc')) {
      return NextResponse.json(
        { error: 'Old .doc files are not supported — save it as .docx (or PDF) and upload that.' },
        { status: 415 },
      )
    } else {
      return NextResponse.json(
        { error: 'Upload a .docx, .pdf, .txt or .md file.' },
        { status: 415 },
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unreadable file'
    return NextResponse.json({ error: `Could not read that file: ${msg}` }, { status: 400 })
  }

  // Tidy: normalise newlines, drop trailing spaces, collapse runs of blank lines.
  text = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!text) {
    return NextResponse.json(
      { error: 'No readable text found. A scanned PDF (just images) can\'t be read — use a text-based file.' },
      { status: 422 },
    )
  }

  return NextResponse.json({ text, filename: file.name })
}
