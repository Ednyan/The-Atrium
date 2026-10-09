// Special themes' windows of the year: which one a new atrium starts in.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inSeason, isMonthDay, seasonalTheme, shownOn } from '../src/lib/season.ts'

const day = (month: number, date: number) => new Date(2026, month - 1, date, 12)
const spooky = { name: 'spooky', startsOn: '10-15', endsOn: '11-01' }
const winter = { name: 'winter', startsOn: '12-01', endsOn: '02-28' }
const newYear = { name: 'new year', startsOn: '12-30', endsOn: '01-02' }

test('a window holds both its days, and nothing outside them', () => {
  assert.equal(inSeason(spooky, day(10, 14)), false)
  assert.equal(inSeason(spooky, day(10, 15)), true)
  assert.equal(inSeason(spooky, day(10, 31)), true)
  assert.equal(inSeason(spooky, day(11, 1)), true)
  assert.equal(inSeason(spooky, day(11, 2)), false)
})

test('a window can run over the new year', () => {
  assert.equal(inSeason(winter, day(12, 25)), true)
  assert.equal(inSeason(winter, day(1, 15)), true)
  assert.equal(inSeason(winter, day(3, 1)), false)
  assert.equal(inSeason(winter, day(11, 30)), false)
})

test('of several in season, the one begun most recently', () => {
  const all = [winter, spooky, newYear]
  assert.equal(seasonalTheme(all, day(10, 20))?.name, 'spooky')
  assert.equal(seasonalTheme(all, day(12, 31))?.name, 'new year')
  assert.equal(seasonalTheme(all, day(1, 1))?.name, 'new year')
  assert.equal(seasonalTheme(all, day(1, 3))?.name, 'winter')
  assert.equal(seasonalTheme(all, day(6, 1)), null)
})

test('only real months and days count', () => {
  assert.equal(isMonthDay('10-15'), true)
  for (const bad of ['13-01', '00-10', '10-32', '1-5', '2026-10-15', 5]) assert.equal(isMonthDay(bad), false)
})

test('people see a theme in its window or all year, and never while it is hidden', () => {
  const always = { name: 'always', startsOn: null, endsOn: null }
  const hidden = { ...spooky, name: 'hidden', hidden: true }
  const all = [spooky, always, hidden, { ...always, name: 'hidden always', hidden: true }]
  assert.deepEqual(shownOn(all, day(10, 9)).map(s => s.name), ['always'])
  assert.deepEqual(shownOn(all, day(10, 20)).map(s => s.name), ['spooky', 'always'])
  assert.equal(seasonalTheme([hidden, always], day(10, 20)), null)
  assert.equal(inSeason(always, day(10, 20)), false)
})
