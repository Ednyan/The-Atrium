// TraceSlot keeps a trace's drawing while traceSignature(trace) is unchanged.
// That is only right if the signature covers everything the drawing depends
// on, and if the handlers inside it can't act on state that has moved on
// since. Both are checked here, from TraceOverlay's source: a new state read
// in renderTrace without the signature to match fails this, rather than
// leaving a trace drawn stale.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const FILE = 'src/components/TraceOverlay.tsx'
const sf = ts.createSourceFile(FILE, readFileSync(FILE, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

let overlay: ts.FunctionDeclaration | undefined
ts.forEachChild(sf, function find(n) {
  if (ts.isFunctionDeclaration(n) && n.name?.text === 'TraceOverlay') overlay = n
  ts.forEachChild(n, find)
})
assert.ok(overlay?.body, 'TraceOverlay found')

type Kind = 'prop' | 'state' | 'setter' | 'ref' | 'memo' | 'fn' | 'picked' | 'value'
const scope = new Map<string, { kind: Kind; node?: ts.Node }>()
const declare = (name: string, kind: Kind, node?: ts.Node) => { if (!scope.has(name)) scope.set(name, { kind, node }) }
// A setter -- from useState, the store or a prop -- keeps its identity, and so
// can't go stale: the store's actions and the setters passed down are named
// that way throughout.
const SETTER_NAME = /^(set|add|remove|mark|unmark|put|drop)[A-Z]/
for (const p of overlay!.parameters) {
  if (ts.isObjectBindingPattern(p.name)) {
    for (const el of p.name.elements) declare(el.name.getText(), SETTER_NAME.test(el.name.getText()) ? 'setter' : 'prop')
  }
}
for (const st of overlay!.body!.statements) {
  if (ts.isVariableStatement(st)) {
    for (const d of st.declarationList.declarations) {
      const init = d.initializer
      const text = init?.getText() ?? ''
      let kind: Kind = 'value'
      if (/^(React\.)?useCallback\(/.test(text) || (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)))) kind = 'fn'
      else if (/^(React\.)?useRef/.test(text)) kind = 'ref'
      else if (/^(React\.)?useMemo/.test(text)) kind = 'memo'
      else if (/^(React\.)?useState/.test(text)) kind = 'state'
      if (ts.isIdentifier(d.name)) declare(d.name.text, kind, init)
      else if (ts.isArrayBindingPattern(d.name)) {
        d.name.elements.forEach((el, i) => {
          if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) declare(el.name.text, i === 0 ? kind : 'setter', init)
        })
      } else {
        for (const el of d.name.elements) if (ts.isIdentifier(el.name)) declare(el.name.text, SETTER_NAME.test(el.name.text) ? 'setter' : 'picked', init)
      }
    }
  }
  if (ts.isFunctionDeclaration(st) && st.name) declare(st.name.text, 'fn', st)
}

// Is a function here run later -- by an event, a timer, a promise -- rather
// than while drawing?
const DEFERRING = new Set(['setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask'])
function runsLater(fn: ts.Node): boolean {
  const p = fn.parent
  if (ts.isParenthesizedExpression(p) && ts.isCallExpression(p.parent) && p.parent.expression === p) return false
  if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) return /^on[A-Z]/.test(p.parent.name.getText()) || p.parent.name.getText() === 'ref'
  if (ts.isCallExpression(p)) {
    if (DEFERRING.has(p.expression.getText())) return true
    if (ts.isPropertyAccessExpression(p.expression) && ['then', 'catch', 'finally', 'addEventListener'].includes(p.expression.name.text)) return true
  }
  return false
}

// Names read while drawing, and names read later; component functions called
// while drawing are followed into, except `skip`.
function reads(root: ts.Node, skip: Set<string>) {
  const now = new Map<string, Kind>(), later = new Map<string, Kind>()
  const followed = new Set<string>()
  const walk = (node: ts.Node, deferred: boolean) => {
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && runsLater(node)) deferred = true
    if (ts.isIdentifier(node) && scope.has(node.text)) {
      const p = node.parent
      const member = ts.isPropertyAccessExpression(p) && p.name === node
      const key = (ts.isPropertyAssignment(p) && p.name === node) || ts.isJsxAttribute(p)
      if (!member && !key) {
        const { kind, node: decl } = scope.get(node.text)!
        ;(deferred ? later : now).set(node.text, kind)
        const called = ts.isCallExpression(p) && p.expression === node
        if (!deferred && kind === 'fn' && called && decl && !followed.has(node.text) && !skip.has(node.text)) {
          followed.add(node.text)
          const fn = ts.isCallExpression(decl) ? decl.arguments[0] : decl
          ts.forEachChild(fn, c => walk(c, false))
        }
      }
    }
    ts.forEachChild(node, c => walk(c, deferred))
  }
  ts.forEachChild(root, c => walk(c, false))
  return { now, later }
}

const fnBody = (name: string) => {
  const decl = scope.get(name)?.node
  assert.ok(decl, `${name} found`)
  return decl!
}
// Paths are drawn afresh every time -- traceSignature returns a new object for
// them -- so what renderPathSvg reads needs no signature.
const drawing = reads(fnBody('renderTrace'), new Set(['renderPathSvg']))
const signature = reads(fnBody('traceSignature'), new Set())
const inSignature = new Set([...signature.now.keys()])
// `t` is one function whatever the language; the signature takes the language.
if (inSignature.has('language')) inSignature.add('t')

// Kinds whose change a trace would have to be drawn again for. Setters and
// refs never change identity; component functions are followed into.
const MATTERS: Kind[] = ['prop', 'state', 'memo', 'picked', 'value']

test('the signature covers everything a trace reads while drawing', () => {
  const missing = [...drawing.now].filter(([name, kind]) => MATTERS.includes(kind) && name !== 'on' && !inSignature.has(name))
  assert.deepEqual(missing.map(([name]) => name), [], 'add these to traceSignature')
})

test("a trace's handlers call component functions only through `on`", () => {
  const direct = [...drawing.later].filter(([name, kind]) => kind === 'fn').map(([name]) => name)
  assert.deepEqual(direct, [], 'pass these through useLatestHandlers and call them as on.name')
})

test("what a trace's handlers read later is in the signature, so it's current", () => {
  const stale = [...drawing.later].filter(([name, kind]) => MATTERS.includes(kind) && name !== 'on' && !inSignature.has(name))
  assert.deepEqual(stale.map(([name]) => name), [], 'add these to traceSignature, or read them from a ref')
})
