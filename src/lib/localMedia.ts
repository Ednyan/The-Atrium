// A vault file's address (local://) as one the page can load, streamed from
// the vault rather than read into memory (localDb resolveLocalStreamUrl).
// Through a lazy import, so the web build never loads the vault's Tauri
// modules; anything else comes back as it is.
export async function resolveLocalStreamUrl(url: string): Promise<string> {
  if (!url.startsWith('local://')) return url
  const mod = await import('./localDb')
  return mod.resolveLocalStreamUrl(url)
}
