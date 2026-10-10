// Whether WebGL here is drawn by a graphics card -- asked once a visit, in a
// worker (gpuProbe.worker), so the asking costs the page nothing even where
// the answer is no. 'unknown' where a worker can't say (no WebGL in workers,
// as in older Safari), or doesn't in time: the caller then finds out itself.

export type WebGLKind = 'hardware' | 'software' | 'unknown'

let answer: Promise<WebGLKind> | null = null

export function webglKind(): Promise<WebGLKind> {
  answer ??= new Promise<WebGLKind>(resolve => {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') { resolve('unknown'); return }
    let worker: Worker
    try {
      worker = new Worker(new URL('./gpuProbe.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      resolve('unknown')
      return
    }
    const done = (kind: WebGLKind) => { clearTimeout(timer); worker.terminate(); resolve(kind) }
    const timer = setTimeout(() => done('unknown'), 5000)
    worker.onmessage = e => done(e.data === 'hardware' || e.data === 'software' ? e.data : 'unknown')
    worker.onerror = () => done('unknown')
  })
  return answer
}
