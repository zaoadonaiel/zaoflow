import { createServiceClient } from './supabase/server'
import type { ServerCompressionResult } from './image-compression-server'

/**
 * Persist a compressed buffer to Supabase storage and return its public URL.
 * The Node.js publish path uses this because the target site fetches the URL
 * itself and needs to reach the compressed file. WordPress uploads the bytes
 * directly to WP media, so it does not need the storage hop.
 *
 * Split from image-compression-server.ts so that file has no server-framework
 * imports and can be exercised by a plain Node script (see scripts/).
 */
export async function storeCompressedToStorage(
  userId: string,
  compressed: ServerCompressionResult,
): Promise<string> {
  const service = createServiceClient()
  const path = `${userId}/${Date.now()}-compressed.${compressed.ext}`
  const { error } = await service.storage
    .from('article-images')
    .upload(path, compressed.buffer, { contentType: compressed.mime, upsert: false })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
  const { data: { publicUrl } } = service.storage.from('article-images').getPublicUrl(path)
  return publicUrl
}
