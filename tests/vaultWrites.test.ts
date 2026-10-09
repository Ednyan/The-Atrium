// Files being written into the vault: read only once whole, and how far along.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setVaultWriteProgress, trackVaultWrite, vaultWriteDone, vaultWriteProgress, watchVaultWrites } from '../src/lib/vaultWrites.ts'

test('a read waits for its file to be whole, and only that file', async () => {
  let finish!: () => void
  trackVaultWrite('local://traces/L/a.pdf', new Promise<void>(resolve => { finish = resolve }))
  let read = false
  const reading = vaultWriteDone('local://traces/L/a.pdf').then(() => { read = true })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(read, false, 'not while it is being written')
  let other = false
  await vaultWriteDone('local://traces/L/b.png').then(() => { other = true })
  assert.equal(other, true, 'a file nothing writes is read at once')
  finish()
  await reading
  assert.equal(read, true)
  assert.equal(vaultWriteProgress('local://traces/L/a.pdf'), null, 'and forgotten once done')
})

test('progress is told as it moves, a percent at a time, and a failed write still ends', async () => {
  let fail!: (e: Error) => void
  trackVaultWrite('local://traces/L/v.mp4', new Promise<void>((_, reject) => { fail = reject }))
  let told = 0
  const stop = watchVaultWrites(() => { told++ })
  assert.equal(vaultWriteProgress('local://traces/L/v.mp4'), 0)
  setVaultWriteProgress('local://traces/L/v.mp4', 0.004)
  assert.equal(told, 0, 'under a percent: not told')
  setVaultWriteProgress('local://traces/L/v.mp4', 0.5)
  assert.equal(vaultWriteProgress('local://traces/L/v.mp4'), 0.5)
  assert.equal(told, 1)
  fail(new Error('disk full'))
  await vaultWriteDone('local://traces/L/v.mp4')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(vaultWriteProgress('local://traces/L/v.mp4'), null)
  stop()
})
