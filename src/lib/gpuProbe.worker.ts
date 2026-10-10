// Asked off the page (lib/gpuProbe): is WebGL here drawn by a graphics card?
// Creating a context is the costly part where it isn't -- the better part of a
// second, by the processor -- so that cost lands on this thread, not the page's.
//   'hardware' | 'software' | 'unknown' (no WebGL in a worker here to ask with)

let verdict = 'unknown'
try {
  const gl = new OffscreenCanvas(1, 1).getContext('webgl', { failIfMajorPerformanceCaveat: true }) as WebGLRenderingContext | null
  if (gl) {
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
    verdict = /swiftshader|llvmpipe|softpipe|software|basic render driver/i.test(renderer) ? 'software' : 'hardware'
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  } else {
    // Refused for the caveat, or no WebGL in workers at all: only a context
    // without the caveat tells the two apart.
    verdict = new OffscreenCanvas(1, 1).getContext('webgl') ? 'software' : 'unknown'
  }
} catch {
  verdict = 'unknown'
}
postMessage(verdict)
