import { test } from 'node:test'
import assert from 'node:assert/strict'

import { wrapLines } from '../src/lib/textFit.ts'

// Every character, a space too, ten wide.
const ctx = { measureText: (s: string) => ({ width: s.length * 10 }) } as unknown as CanvasRenderingContext2D

test('a space at the end of a line hangs past it, as the page lets it', () => {
  // "let's so" is 80 wide, as wide as the line: the space after it doesn't
  // need room, and is no reason for a line of its own.
  assert.deepEqual(wrapLines(ctx, "let's so ", 80), ["let's so "])
  assert.deepEqual(wrapLines(ctx, "let's so it", 80), ["let's so ", 'it'])
})

test('spaces in a row only add their width', () => {
  assert.deepEqual(wrapLines(ctx, 'ab  cd', 60), ['ab  cd'])
  assert.deepEqual(wrapLines(ctx, 'ab  cd', 40), ['ab  ', 'cd'])
})

test('a word too long for any line is broken a character at a time', () => {
  assert.deepEqual(wrapLines(ctx, 'abcdefghij', 40), ['abcd', 'efgh', 'ij'])
})

test('lines of their own stay their own', () => {
  assert.deepEqual(wrapLines(ctx, 'ab\n\ncd', 80), ['ab', '', 'cd'])
})
