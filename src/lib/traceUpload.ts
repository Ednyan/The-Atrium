// Stores a dropped, pasted or picked file where a trace can point at it: in the
// vault on desktop, in Storage on the web. The one way a media file is saved,
// whether it came onto the canvas or through the Create Trace panel -- the
// panel once had a copy of this that never swapped a new trace over to its
// vault file and said nothing when the write failed.

import { supabase, isDesktop } from './supabase'
import { showToast } from './toast'
import { t } from './i18n'

export const inferFileExtension = (file: File) => {
  const fromName = file.name.split('.').pop()?.trim().toLowerCase()
  if (fromName) return fromName

  const mimeToExtension: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'video/quicktime': 'mov',
  }

  return mimeToExtension[file.type] || 'bin'
}

// The URL the trace stores: local://traces/... on desktop, a public Storage
// URL on the web, or the file as a data URL when neither is available.
export async function uploadTraceFile(file: File, lobbyId: string, userId: string): Promise<string> {
  const fileExt = inferFileExtension(file)
  const fileName = `${userId}_${Date.now()}.${fileExt}`
  const storagePath = `${lobbyId}/${fileName}`

  if (isDesktop && supabase) {
    const localUrl = `local://traces/${storagePath}`

    // Shown from the file the user dropped -- complete, and nothing is
    // writing to it -- until the vault copy exists (see preCacheLocalUrl).
    // Awaited so it is in place before the trace that will read it: a PDF
    // trace reads its own file straight back to render a page, and a cache
    // miss before the write lands would leave it unreadable.
    ;(await import('./localDb')).preCacheLocalUrl(localUrl, URL.createObjectURL(file))
    // Written in the background so the trace can appear immediately -- but
    // not ignored.
    //
    // This used to be a bare unawaited call. The trace row is inserted
    // straight afterwards pointing at local://, so when the write failed
    // there was a trace on the canvas referring to a file that had never
    // been created: fine for the rest of the session, because the blob URL
    // is cached in memory, and "Missing file" the next time the atrium was
    // opened. Nothing anywhere said a word. A background write may be
    // invisible while it works; it must not be invisible when it does not.
    void supabase.storage.from('traces').upload(storagePath, file)
      .then(({ error }: { error: any }) => {
        if (error) {
          console.error('[vault] failed to write media file:', storagePath, error)
          showToast(t('atrium.error.vaultSaveFailed', { name: file.name }))
          // Still announced as finished. It is not pending any more, and
          // leaving it pending would strand the trace saying "Preparing"
          // for the rest of the session rather than showing it is missing.
          window.dispatchEvent(new CustomEvent('atrium:vault-write-complete', {
            detail: { localUrl },
          }))
          return
        }
        // Hand the trace the real file now that there is one.
        //
        // Until this point it has been reading through a blob URL over the
        // file the user dropped, which is what let it appear instantly. That
        // blob is also being read, chunk by chunk, by the write that just
        // finished -- and a video asked to load while that was happening
        // could fail outright, with no retry and nothing to say so. It
        // stayed broken until the atrium was left and re-entered, which
        // remounts the trace and resolves the URL again from disk.
        //
        // Doing that swap here means the element gets a fresh, quiet source
        // the moment one exists, rather than only on the next visit.
        void import('./localDb')
          .then(m => m.refreshLocalUrl(localUrl))
          .then(() => {
            window.dispatchEvent(new CustomEvent('atrium:vault-write-complete', {
              detail: { localUrl },
            }))
          })
          .catch(() => {})
      })
      .catch((err: any) => {
        console.error('[vault] failed to write media file:', storagePath, err)
        showToast(t('atrium.error.vaultSaveFailed', { name: file.name }))
      })
    return localUrl
  }

  if (supabase) {
    const { error } = await supabase.storage.from('traces').upload(fileName, file)
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from('traces').getPublicUrl(fileName)
      return publicUrl
    }
    console.error('Supabase upload error:', error)
  }
  // Fallback to data URL
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}
