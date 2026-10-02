// A file for the person to keep: downloaded on the web; on desktop, saved
// where they choose in the system's save dialog. False if they cancel it.

import { isDesktop } from './supabase'

export async function saveFile(blob: Blob, name: string, filter: { name: string; extensions: string[] }): Promise<boolean> {
  if (isDesktop) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const path = await save({ defaultPath: name, filters: [filter] })
    if (!path) return false
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
    return true
  }
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoked on a delay: revoked at once, some browsers cancel the download
  // before it has read the file.
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return true
}

// A name for a file from an atrium's: letters, digits, - and _.
export const fileNameOf = (name: string) => String(name).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40) || 'atrium'
