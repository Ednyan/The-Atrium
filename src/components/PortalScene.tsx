// The portal, live: the atrium's mark as the Blender scene makes it
// (digitalatrium_orb_animation.blend), drawn with WebGL. The wireframe
// wormhole turns slowly under its orb; the orb sheds little orbs, which an
// attractor inside the wormhole's base pulls down through its neck, where
// they settle on its grid as traces -- what someone knows, or information as
// a whole, coming in bit by bit and taking shape in an atrium. A cone of
// light falls from the orb. On a pale page it's ink instead of light.
//
// The wormhole's geometry is the .blend's, modifiers applied
// (public/portal/vessel.bin.gz: int16 positions, uint16 triangles); everything
// else -- the orb, the little orbs, the light -- is drawn here. Its lines fade
// with depth, as the scene's material does.
//
// Still, for anyone who asked for less motion; paused while out of view; the
// still picture of it where WebGL isn't there -- or is there only drawn by the
// processor, with no graphics card behind it. There, setting it up (the
// context, the shaders) took seconds of a slow phone's main thread, and every
// frame after that more of it: PageSpeed's phone, which has no graphics card,
// measured fifteen seconds of the page blocked.

import { useEffect, useRef, useState } from 'react'
import { webglKind } from '../lib/gpuProbe'

// ---- The scene, in Blender's space (Z up) ---------------------------------------

const CONTROLLER = { z: 0.2425, tilt: 0.3915 }
const VESSEL = { scale: 0.5556, turn: 3.4034 }
const ORB = { x: 0, y: -0.1823, z: 0.7337, radius: 0.1022 }
// The attractor: the force field inside the wormhole's base, in the
// controller's space (the vessel's (0, 0.141, -0.155), scaled; on its axis).
const SINK = { x: 0, y: 0, z: -0.086 }
// One turn of the wormhole (s). The .blend's is 5 s; at this size, calmer.
const TURN_SECONDS = 26
// Little orbs: how often one is born, how long they live, how hard the sink pulls.
const BIRTHS_PER_SECOND = 3.4
const LIFE = 1.4
const PULL = 1.45
// Where a little orb that reaches the wormhole settles: a trace, on the grid
// of its base (the vessel's own space, before its scale), for a moment.
const TRACE_LIFE = 1.6
const CAMERA_DISTANCE = 7.627

type Vec3 = [number, number, number]
type Mat4 = Float32Array

const identity = (): Mat4 => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m }
function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  }
  return o
}
const translate = (x: number, y: number, z: number) => { const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m }
const scale = (s: number) => { const m = identity(); m[0] = m[5] = m[10] = s; return m }
const rotX = (a: number) => { const m = identity(); const c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m }
const rotZ = (a: number) => { const m = identity(); const c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m }
// Blender's Z-up to GL's Y-up: (x, y, z) -> (x, z, -y).
const zUpToYUp = (() => { const m = new Float32Array(16); m[0] = 1; m[6] = -1; m[9] = 1; m[15] = 1; return m })()
function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2), m = new Float32Array(16)
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = (2 * far * near) / (near - far)
  return m
}
const apply = (m: Mat4, [x, y, z]: Vec3): Vec3 => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
]

// WebGL drawn by the processor, with no graphics card behind it (SwiftShader,
// Mesa's llvmpipe, Windows' Basic Render Driver).
function drawnBySoftware(gl: WebGLRenderingContext): boolean {
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
  return /swiftshader|llvmpipe|softpipe|software|basic render driver/i.test(renderer)
}

// ---- The wormhole's geometry -------------------------------------------------------

interface Vessel { positions: Int16Array; indices: Uint16Array; extent: number }
let vesselFile: Promise<Vessel> | null = null
function loadVessel(): Promise<Vessel> {
  // Gzipped, as the host won't compress a .bin (a third smaller); unpacked
  // here -- unless something on the way already did. Where the browser can't
  // unpack it, the portal falls back to its video, as for any failure.
  vesselFile ??= fetch('/portal/vessel.bin.gz').then(r => {
    if (!r.ok) throw new Error(`vessel ${r.status}`)
    return r.arrayBuffer()
  }).then(packed => {
    const head = new Uint8Array(packed, 0, 2)
    if (head[0] !== 0x1f || head[1] !== 0x8b) return packed
    return new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  }).then(buffer => {
    const view = new DataView(buffer)
    if (view.getUint32(0, true) !== 0x31565441) throw new Error('not a vessel file') // 'ATV1'
    const verts = view.getUint32(4, true), count = view.getUint32(8, true), extent = view.getFloat32(12, true)
    const positions = new Int16Array(buffer, 16, verts * 3)
    const indexStart = 16 + verts * 6 + (verts % 2 ? 2 : 0)
    return { positions, indices: new Uint16Array(buffer, indexStart, count), extent }
  })
  vesselFile.catch(() => { vesselFile = null })
  return vesselFile
}

// ---- Shaders ------------------------------------------------------------------------

const VESSEL_VS = `
attribute vec3 aPos;
uniform mat4 uModelView, uProjection;
uniform float uExtent;
varying float vDepth;
void main() {
  vec4 p = uModelView * vec4(aPos * uExtent, 1.0);
  vDepth = -p.z;
  gl_Position = uProjection * p;
}`
const VESSEL_FS = `
precision mediump float;
uniform vec3 uInk;
uniform float uFront, uBack, uBackAlpha;
varying float vDepth;
void main() {
  float a = mix(1.0, uBackAlpha, smoothstep(uFront, uBack, vDepth));
  gl_FragColor = vec4(uInk * a, a);
}`
// A disc with its glow, for the orb and each little orb: a quad around a
// point, sized in clip space.
const GLOW_VS = `
attribute vec2 aCorner;
uniform vec4 uCenter;   // clip space
uniform vec2 uRadius;   // clip units, x and y
uniform mediump float uReach;   // the quad's half-size, in radii (mediump: shared with the fragment shader)
varying vec2 vUv;
void main() {
  vUv = aCorner * uReach;
  gl_Position = uCenter + vec4(aCorner * uRadius * uReach * uCenter.w, 0.0, 0.0);
}`
const GLOW_FS = `
precision mediump float;
uniform vec3 uCore, uHalo;
uniform float uGlow, uAlpha, uReach, uSquare;
varying vec2 vUv;
void main() {
  // A disc -- or, for a trace, a square's corner marks -- and its glow,
  // gone before the quad's edge.
  float d = length(vUv);
  float core;
  if (uSquare > 0.5) {
    vec2 q = abs(vUv);
    float edge = max(q.x, q.y);
    float frame = step(0.82, edge) * step(edge, 1.0);
    float corner = step(0.45, min(q.x, q.y));
    core = frame * corner + step(edge, 0.82) * 0.12;
    d = edge;
  } else {
    core = 1.0 - smoothstep(0.92, 1.04, d);
  }
  float halo = uGlow * exp(-max(d - 1.0, 0.0) * 1.6) * (1.0 - core) * (1.0 - smoothstep(uReach * 0.55, uReach, d));
  vec3 c = uCore * core + uHalo * halo;
  float a = clamp(core + halo, 0.0, 1.0) * uAlpha;
  gl_FragColor = vec4(c * uAlpha, a);
}`
// The light falling from the orb: a soft cone, widening downwards.
const CONE_VS = `
attribute vec2 aCorner;
varying vec2 vPos;
void main() { vPos = aCorner; gl_Position = vec4(aCorner, 0.0, 1.0); }`
const CONE_FS = `
precision mediump float;
uniform vec2 uOrb;      // pixels
uniform vec2 uSize;     // pixels
uniform vec3 uLight;
uniform float uStrength;
varying vec2 vPos;
void main() {
  vec2 p = (vPos * 0.5 + 0.5) * uSize - uOrb;
  float down = -p.y;
  if (down <= 0.0) { gl_FragColor = vec4(0.0); return; }
  float spread = abs(p.x) / (down * 0.42 + 28.0);
  float beam = (1.0 - smoothstep(0.0, 1.0, spread)) * exp(-down / (uSize.y * 0.75)) * smoothstep(0.0, 60.0, down);
  // Gone by the canvas's foot rather than cut off by it: the title sits there.
  float foot = smoothstep(0.0, uSize.y * 0.25, (vPos.y * 0.5 + 0.5) * uSize.y);
  float a = beam * foot * uStrength;
  gl_FragColor = vec4(uLight * a, a);
}`

function program(gl: WebGLRenderingContext, vs: string, fs: string) {
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, source)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
    return s
  }
  const p = gl.createProgram()!
  gl.attachShader(p, shader(gl.VERTEX_SHADER, vs))
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program')
  const u = (name: string) => gl.getUniformLocation(p, name)
  return { p, u, a: (name: string) => gl.getAttribLocation(p, name) }
}

// ---- The component ------------------------------------------------------------------

interface Mote { born: number; life: number; size: number; pos: Vec3; vel: Vec3 }
interface Settled { born: number; at: Vec3; size: number }

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function PortalScene({ ink = false, className = '' }: { ink?: boolean; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inkRef = useRef(ink)
  inkRef.current = ink
  const [failed, setFailed] = useState(false)
  // Set up only once a worker has said a graphics card draws WebGL here
  // (lib/gpuProbe) -- or couldn't say, when this finds out itself, below.
  const [ready, setReady] = useState(false)
  const redrawRef = useRef<() => void>(() => {})

  useEffect(() => { redrawRef.current() }, [ink])

  useEffect(() => {
    let live = true
    void webglKind().then(kind => { if (live) { if (kind === 'software') setFailed(true); else setReady(true) } })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!ready) return
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, failIfMajorPerformanceCaveat: true })
    if (!gl) { setFailed(true); return }
    // Asked outright too: not every browser counts a software renderer as the
    // caveat above. Before any shader is compiled, which is where the seconds go.
    if (drawnBySoftware(gl)) { gl.getExtension('WEBGL_lose_context')?.loseContext(); setFailed(true); return }
    let alive = true
    let frame = 0
    const still = reducedMotion()

    let vessel: { buffer: WebGLBuffer; index: WebGLBuffer; count: number; extent: number } | null = null
    let progs: ReturnType<typeof setup> | null = null
    function setup(g: WebGLRenderingContext) {
      const quad = g.createBuffer()!
      g.bindBuffer(g.ARRAY_BUFFER, quad)
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW)
      return { vessel: program(g, VESSEL_VS, VESSEL_FS), glow: program(g, GLOW_VS, GLOW_FS), cone: program(g, CONE_VS, CONE_FS), quad }
    }
    try { progs = setup(gl) } catch (e) { console.warn('[portal] no shaders:', e); setFailed(true); return }

    loadVessel().then(v => {
      if (!alive) return
      const buffer = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, v.positions, gl.STATIC_DRAW)
      const index = gl.createBuffer()!
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, v.indices, gl.STATIC_DRAW)
      vessel = { buffer, index, count: v.indices.length, extent: v.extent }
      redraw()
      start()
    }).catch(e => { console.warn('[portal] no vessel:', e); if (alive) setFailed(true) })

    // The pointer leans the scene a little, eased.
    const lean = { x: 0, y: 0, tx: 0, ty: 0 }
    const onPointer = (e: PointerEvent) => {
      lean.tx = (e.clientX / window.innerWidth) * 2 - 1
      lean.ty = (e.clientY / window.innerHeight) * 2 - 1
    }
    if (!still) window.addEventListener('pointermove', onPointer, { passive: true })

    const motes: Mote[] = []
    const settled: Settled[] = []
    let lastBirth = 0
    let lastTime = 0
    // The scene's own clock, in ms: it runs only while the scene is drawn
    // moving. Out of view or in a hidden tab, the scene is paused, not
    // falling behind -- on the wall's clock it came back owing every birth it
    // had missed, and let them all out at once.
    let clock = 0

    function draw(frameTime: number) {
      if (!gl || !progs || !vessel || !canvas) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      gl.viewport(0, 0, w, h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      const dt = Math.min(0.05, lastTime ? (frameTime - lastTime) / 1000 : 0)
      lastTime = frameTime
      clock += dt * 1000
      const now = clock, t = now / 1000
      lean.x += (lean.tx - lean.x) * Math.min(1, dt * 2.2)
      lean.y += (lean.ty - lean.y) * Math.min(1, dt * 2.2)
      const inkNow = inkRef.current
      const fg: Vec3 = inkNow ? [0.086, 0.078, 0.07] : [1, 1, 1]

      // The controller (the scene's tilt, leaned by the pointer), the
      // wormhole turning inside it; the camera looks at the middle of it all.
      const controller = multiply(translate(0, 0, CONTROLLER.z), multiply(rotZ(lean.x * 0.32), rotX(CONTROLLER.tilt + lean.y * 0.12)))
      const spin = still ? 0.6 : (t / TURN_SECONDS) * Math.PI * 2
      const model = multiply(controller, multiply(rotZ(VESSEL.turn + spin), scale(VESSEL.scale)))
      const focusZ = 0.5
      const view = multiply(translate(0, -focusZ, -CAMERA_DISTANCE), zUpToYUp)
      const aspect = w / h
      // Fit the whole of it -- wormhole, orb and its glow -- by height, or
      // by width where the canvas is narrow.
      const halfH = 0.62, halfW = 0.66
      const fovY = 2 * Math.atan(Math.max(halfH, halfW / aspect) / CAMERA_DISTANCE)
      const projection = perspective(fovY, aspect, 0.1, 50)

      // The light falling from the orb.
      const orbWorld = apply(controller, [ORB.x, ORB.y, ORB.z])
      const orbView = apply(view, orbWorld)
      const clip = (p: Vec3): [number, number, number, number] => {
        const x = projection[0] * p[0], y = projection[5] * p[1], z = projection[10] * p[2] + projection[14], wc = -p[2]
        return [x, y, z, wc]
      }
      const orbClip = clip(orbView)
      const orbPx: [number, number] = [((orbClip[0] / orbClip[3]) * 0.5 + 0.5) * w, ((orbClip[1] / orbClip[3]) * 0.5 + 0.5) * h]
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.disable(gl.DEPTH_TEST)
      if (!inkNow) {
        const c = progs.cone
        gl.useProgram(c.p)
        gl.bindBuffer(gl.ARRAY_BUFFER, progs.quad)
        gl.enableVertexAttribArray(c.a('aCorner'))
        gl.vertexAttribPointer(c.a('aCorner'), 2, gl.FLOAT, false, 0, 0)
        gl.uniform2f(c.u('uOrb'), orbPx[0], orbPx[1])
        gl.uniform2f(c.u('uSize'), w, h)
        gl.uniform3f(c.u('uLight'), 1, 0.94, 0.84)
        gl.uniform1f(c.u('uStrength'), 0.13 * (still ? 1 : 0.88 + 0.12 * Math.sin(t * 0.7)))
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }

      // The wormhole.
      const v = progs.vessel
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.useProgram(v.p)
      gl.bindBuffer(gl.ARRAY_BUFFER, vessel.buffer)
      gl.enableVertexAttribArray(v.a('aPos'))
      gl.vertexAttribPointer(v.a('aPos'), 3, gl.SHORT, true, 0, 0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vessel.index)
      gl.uniformMatrix4fv(v.u('uModelView'), false, multiply(view, model))
      gl.uniformMatrix4fv(v.u('uProjection'), false, projection)
      gl.uniform1f(v.u('uExtent'), vessel.extent)
      gl.uniform3f(v.u('uInk'), fg[0], fg[1], fg[2])
      gl.uniform1f(v.u('uFront'), CAMERA_DISTANCE - 0.25)
      gl.uniform1f(v.u('uBack'), CAMERA_DISTANCE + 0.4)
      gl.uniform1f(v.u('uBackAlpha'), inkNow ? 0.28 : 0.22)
      gl.enable(gl.CULL_FACE)
      gl.drawElements(gl.TRIANGLES, vessel.count, gl.UNSIGNED_SHORT, 0)
      gl.disable(gl.CULL_FACE)
      gl.disable(gl.DEPTH_TEST)

      // Little orbs: born on the orb, pulled down into the wormhole.
      if (!still) {
        while (now - lastBirth > 1000 / BIRTHS_PER_SECOND) {
          lastBirth = lastBirth ? lastBirth + 1000 / BIRTHS_PER_SECOND * (0.6 + Math.random() * 0.8) : now
          const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u)
          motes.push({
            born: now, life: LIFE * (0.82 + Math.random() * 0.36), size: 0.006 + Math.pow(Math.random(), 2) * 0.03,
            pos: [ORB.x + Math.cos(a) * s * ORB.radius, ORB.y + Math.sin(a) * s * ORB.radius, ORB.z + u * ORB.radius], vel: [0, 0, 0],
          })
        }
        for (const m of motes) {
          const d: Vec3 = [SINK.x - m.pos[0], SINK.y - m.pos[1], SINK.z - m.pos[2]]
          const len = Math.hypot(d[0], d[1], d[2]) || 1
          for (let i = 0; i < 3; i++) {
            m.vel[i] += (d[i] / len) * PULL * dt
            m.vel[i] *= 1 - 0.2 * dt
            m.pos[i] += m.vel[i] * dt
          }
        }
        for (let i = motes.length - 1; i >= 0; i--) {
          const m = motes[i]
          const landed = m.pos[2] < SINK.z + 0.06
          if (!landed && (now - m.born) / 1000 <= m.life) continue
          motes.splice(i, 1)
          // It settles on the grid of the wormhole's base, as a trace, and
          // turns with it.
          if (landed) {
            const a = Math.random() * Math.PI * 2, r = 0.42 + Math.random() * 0.22
            settled.push({ born: now, at: [Math.cos(a) * r, Math.sin(a) * r, 0.04 + Math.random() * 0.12], size: 0.012 + m.size * 0.6 })
          }
        }
        for (let i = settled.length - 1; i >= 0; i--) if ((now - settled[i].born) / 1000 > TRACE_LIFE) settled.splice(i, 1)
      }

      const g = progs.glow
      gl.useProgram(g.p)
      gl.bindBuffer(gl.ARRAY_BUFFER, progs.quad)
      gl.enableVertexAttribArray(g.a('aCorner'))
      gl.vertexAttribPointer(g.a('aCorner'), 2, gl.FLOAT, false, 0, 0)
      const disc = (center: Vec3, radius: number, reach: number, glow: number, alpha: number, space = controller, square = false) => {
        const p = apply(view, apply(space, center))
        const c = clip(p)
        gl.uniform4f(g.u('uCenter'), c[0], c[1], c[2], c[3])
        gl.uniform2f(g.u('uRadius'), (radius * projection[0]) / c[3], (radius * projection[5]) / c[3])
        gl.uniform1f(g.u('uReach'), reach)
        gl.uniform1f(g.u('uSquare'), square ? 1 : 0)
        gl.uniform1f(g.u('uGlow'), glow)
        gl.uniform1f(g.u('uAlpha'), alpha)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }
      gl.uniform3f(g.u('uCore'), fg[0], fg[1], fg[2])
      gl.uniform3f(g.u('uHalo'), ...(inkNow ? [0.086, 0.078, 0.07] as Vec3 : [1, 0.93, 0.8] as Vec3))
      for (const m of motes) {
        const age = (now - m.born) / 1000 / m.life
        const alpha = Math.min(1, age * 6) * (1 - Math.max(0, age - 0.8) * 5)
        disc(m.pos, m.size, 3.2, inkNow ? 0.1 : 0.55, Math.max(0, alpha))
      }
      for (const trace of settled) {
        const age = (now - trace.born) / 1000 / TRACE_LIFE
        const alpha = Math.min(1, age * 8) * (1 - Math.max(0, age - 0.35) / 0.65)
        disc(trace.at, trace.size, 2.4, inkNow ? 0.05 : 0.35, Math.max(0, alpha), model, true)
      }
      // The orb, breathing.
      disc([ORB.x, ORB.y, ORB.z], ORB.radius, 7, (inkNow ? 0.16 : 0.75) * (still ? 1 : 0.9 + 0.1 * Math.sin(t * 1.3)), 1)
    }

    function loop(now: number) {
      if (!alive) return
      draw(now)
      frame = requestAnimationFrame(loop)
    }
    let visible = true
    function start() {
      if (still || frame || !visible || document.hidden || !vessel) return
      lastTime = 0
      frame = requestAnimationFrame(loop)
    }
    function stop() { cancelAnimationFrame(frame); frame = 0 }
    // Drawn again as it stands (resized, or the theme changed), time stopped.
    function redraw() { lastTime = 0; draw(performance.now()) }
    redrawRef.current = () => { if (!frame) redraw() }

    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) start(); else stop() })
    io.observe(canvas)
    const onVisibility = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVisibility)
    const resize = new ResizeObserver(() => { if (!frame) redraw() })
    resize.observe(canvas)
    const onLost = (e: Event) => { e.preventDefault(); stop(); setFailed(true) }
    canvas.addEventListener('webglcontextlost', onLost)

    return () => {
      alive = false
      stop()
      io.disconnect()
      resize.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointermove', onPointer)
      canvas.removeEventListener('webglcontextlost', onLost)
      redrawRef.current = () => {}
    }
  }, [ready])

  // A picture of it, where it can't be drawn: its own still frame, taken from
  // this scene (public/portal/still*.webp), so it looks as it does live and
  // costs nothing -- an animation by the processor is the very thing a device
  // without a graphics card can least afford.
  if (failed) return <img src={ink ? '/portal/still-ink.webp' : '/portal/still.webp'} alt="" aria-hidden="true" decoding="async" className={`block object-contain pointer-events-none select-none ${className}`} />
  return <canvas ref={canvasRef} aria-hidden="true" className={`block pointer-events-none select-none ${className}`} />
}
