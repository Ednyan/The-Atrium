// A trace dragged on the canvas, carried into the Layer panel.
//
// While the pointer is over the panel, the trace goes back to where the drag
// started and a card of it is placed in the panel's list instead, between rows
// or into a group. Let go there, and only its group and place in the order
// change; its position stays. Out of the panel again, the card goes and the
// trace follows the pointer as before.
//
// TraceOverlay drives it from its drag; the Layer panel, while open, is the
// target. They don't share a parent that could pass this between them, and it
// only lives for one drag, so it sits here.

export interface PanelDropTarget {
  rect(): DOMRect | null
  // The pointer at (x, y), over the panel, carrying these traces.
  hover(traceIds: string[], x: number, y: number): void
  // Let go there. True when they went somewhere.
  drop(traceIds: string[], x: number, y: number): boolean
  // Carried back out, or the drag ended some other way.
  leave(): void
}

export const panelDrop: { current: PanelDropTarget | null } = { current: null }

export function overPanel(x: number, y: number): boolean {
  const r = panelDrop.current?.rect()
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}
