// What localDb stands on: the desktop app's own (Tauri's SQL plugin, its file
// system and native commands) or, in a browser, the same answered from the
// browser's private file system (lib/browserPlatform). localDb itself is the
// same either way.

import TauriDatabase from '@tauri-apps/plugin-sql'
import { invoke as tauriInvoke, convertFileSrc } from '@tauri-apps/api/core'
import { appDataDir as tauriAppDataDir, join as tauriJoin } from '@tauri-apps/api/path'
import { mkdir as tauriMkdir, exists as tauriExists } from '@tauri-apps/plugin-fs'
import { isDesktop } from './supabase'
import * as browser from './browserPlatform'

export type Database = TauriDatabase
export const Database = (isDesktop ? TauriDatabase : browser.BrowserDatabase) as unknown as typeof TauriDatabase
export const invoke = (isDesktop ? tauriInvoke : browser.invoke) as typeof tauriInvoke
export const appDataDir = isDesktop ? tauriAppDataDir : browser.appDataDir
export const join = isDesktop ? tauriJoin : browser.join
export const mkdir = (isDesktop ? tauriMkdir : browser.mkdir) as typeof tauriMkdir
export const exists = (isDesktop ? tauriExists : browser.exists) as typeof tauriExists
/** A file to show, by its path: the desktop's asset URL, or a blob. */
export const fileUrl = async (path: string): Promise<string> => (isDesktop ? convertFileSrc(path) : browser.fileUrl(path))
