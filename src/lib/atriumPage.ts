// The whole atrium as one web page anyone can look around (the atrium menu's
// Export as web page): its picture drawn from the data as SVG (lib/
// exportImage), so it stays sharp however close one looks, in a page that
// pans and zooms as the atrium does -- drag, wheel, pinch, keys -- and flies
// to its locations. One file: opened anywhere, offline, or put up on any site
// as it is. Looked at, never edited.

import type { LobbyLocation, Trace, Layer } from '../types/database'
import type { TraceLink } from './traceLinks'
import { exportImage } from './exportImage'
import { base64, escape } from './presentationExport'

export async function atriumPageOf(
  traces: Trace[], links: TraceLink[], layers: Layer[], locations: LobbyLocation[], title: string, background: string,
): Promise<Blob> {
  const picture = await exportImage(traces, links, layers, { format: 'svg', scale: 1, background })
  const svg = new Uint8Array(await picture.blob.arrayBuffer())
  // Each location's middle on the picture, and its zoom.
  const spots = [...locations].sort((a, b) => a.orderIndex - b.orderIndex)
    .map(location => ({ name: location.name, x: location.positionX - picture.x, y: location.positionY - picture.y, zoom: location.zoom }))
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="The Digital Atrium">
<title>${escape(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; background: ${escape(background)}; color: #e8e8e8; font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; overflow: hidden; }
  #space { position: fixed; inset: 0; cursor: grab; touch-action: none; }
  #space.held { cursor: grabbing; }
  #space img { position: absolute; left: 0; top: 0; transform-origin: 0 0; user-select: none; -webkit-user-drag: none; }
  .moving img { will-change: transform; }
  header { position: fixed; left: 16px; top: 14px; display: flex; flex-direction: column; gap: 8px; max-width: min(320px, 70vw); }
  h1 { font-size: 12px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; background: rgb(0 0 0 / .45); padding: 7px 10px; }
  nav { display: flex; flex-direction: column; background: rgb(0 0 0 / .45); max-height: 50vh; overflow: auto; }
  nav button, footer button { background: none; border: 0; color: inherit; font: inherit; text-align: left; padding: 6px 10px; cursor: pointer; letter-spacing: .08em; }
  nav button:hover, footer button:hover { background: rgb(255 255 255 / .1); }
  footer { position: fixed; right: 16px; bottom: 16px; display: flex; background: rgb(0 0 0 / .45); border: 1px solid rgb(255 255 255 / .2); }
  footer button { padding: 7px 12px; }
  small { position: fixed; left: 16px; bottom: 16px; opacity: .55; letter-spacing: .1em; }
</style>
</head>
<body>
<main id="space" aria-label="${escape(title)}"><img id="atrium" alt="${escape(title)}" draggable="false" src="data:image/svg+xml;base64,${base64(svg)}"></main>
<header><h1>${escape(title)}</h1>${spots.length ? `<nav aria-label="Locations">${spots.map((spot, i) => `<button type="button" data-spot="${i}">${escape(spot.name)}</button>`).join('')}</nav>` : ''}</header>
<footer><button type="button" data-zoom="-1" aria-label="Zoom out">&minus;</button><button type="button" id="fit">Fit</button><button type="button" data-zoom="1" aria-label="Zoom in">+</button></footer>
<small>Made with The Digital Atrium</small>
<script>
  var W = ${picture.width}, H = ${picture.height}, spots = ${JSON.stringify(spots)}
  var space = document.getElementById('space'), img = document.getElementById('atrium')
  img.style.width = W + 'px'; img.style.height = H + 'px'
  var view = { x: 0, y: 0, k: 1 }, least = 0.05, most = 8, settle = 0, flight = 0
  function draw() {
    img.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')'
    // Moving, kept as one layer; still, drawn again at its scale -- sharp.
    space.classList.add('moving'); clearTimeout(settle); settle = setTimeout(function () { space.classList.remove('moving') }, 160)
  }
  function fitted() {
    var k = Math.min(innerWidth / W, innerHeight / H) * 0.92
    return { k: k, x: (innerWidth - W * k) / 2, y: (innerHeight - H * k) / 2 }
  }
  function zoomAt(px, py, factor) {
    var k = Math.max(least, Math.min(most, view.k * factor))
    view.x = px - (px - view.x) * (k / view.k); view.y = py - (py - view.y) * (k / view.k); view.k = k
    draw()
  }
  function fly(to) {
    cancelAnimationFrame(flight)
    var from = { x: view.x, y: view.y, k: view.k }, start = performance.now()
    var step = function (now) {
      var t = Math.min(1, (now - start) / 700), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      view.x = from.x + (to.x - from.x) * e; view.y = from.y + (to.y - from.y) * e; view.k = from.k + (to.k - from.k) * e
      draw()
      if (t < 1) flight = requestAnimationFrame(step)
    }
    flight = requestAnimationFrame(step)
  }
  function fit() { fly(fitted()) }
  function spot(i) { var s = spots[i], k = Math.max(least, Math.min(most, s.zoom)); fly({ k: k, x: innerWidth / 2 - s.x * k, y: innerHeight / 2 - s.y * k }) }
  var pointers = new Map(), pinch = null
  space.addEventListener('pointerdown', function (e) { space.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); space.classList.add('held'); cancelAnimationFrame(flight) })
  space.addEventListener('pointermove', function (e) {
    var was = pointers.get(e.pointerId); if (!was) return
    var now = { x: e.clientX, y: e.clientY }
    if (pointers.size === 2) {
      var other = [...pointers.entries()].find(function (p) { return p[0] !== e.pointerId })[1]
      var before = Math.hypot(was.x - other.x, was.y - other.y), after = Math.hypot(now.x - other.x, now.y - other.y)
      if (before > 0) zoomAt((now.x + other.x) / 2, (now.y + other.y) / 2, after / before)
    } else { view.x += now.x - was.x; view.y += now.y - was.y; draw() }
    pointers.set(e.pointerId, now)
  })
  var up = function (e) { pointers.delete(e.pointerId); if (!pointers.size) space.classList.remove('held') }
  space.addEventListener('pointerup', up); space.addEventListener('pointercancel', up)
  addEventListener('wheel', function (e) {
    e.preventDefault(); cancelAnimationFrame(flight)
    // A pinch or a mouse's wheel zooms; two fingers on a trackpad pan.
    if (e.ctrlKey || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40)) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
    else { view.x -= e.deltaX; view.y -= e.deltaY; draw() }
  }, { passive: false })
  addEventListener('keydown', function (e) {
    var c = { x: innerWidth / 2, y: innerHeight / 2 }
    if (e.key === '+' || e.key === '=') zoomAt(c.x, c.y, 1.25)
    else if (e.key === '-') zoomAt(c.x, c.y, 0.8)
    else if (e.key === '0') fit()
    else if (e.key.indexOf('Arrow') === 0) { var d = 80; view.x += e.key === 'ArrowLeft' ? d : e.key === 'ArrowRight' ? -d : 0; view.y += e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0; draw() }
    else return
    e.preventDefault()
  })
  document.querySelectorAll('[data-zoom]').forEach(function (b) { b.addEventListener('click', function () { zoomAt(innerWidth / 2, innerHeight / 2, b.dataset.zoom === '1' ? 1.25 : 0.8) }) })
  document.querySelectorAll('[data-spot]').forEach(function (b) { b.addEventListener('click', function () { spot(Number(b.dataset.spot)) }) })
  document.getElementById('fit').addEventListener('click', fit)
  var start = fitted(); view = start; least = Math.min(0.05, start.k / 2); draw()
</script>
</body>
</html>
`
  return new Blob([page], { type: 'text/html' })
}
