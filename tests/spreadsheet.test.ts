import { test } from 'node:test'
import assert from 'node:assert/strict'

import { asSheetFile, formatNumber, isDateFormat, parseCsv } from '../src/lib/spreadsheet.ts'

test('csv: the separator the first line has most of; quotes hold separators, doubled quotes and line breaks', () => {
  assert.deepEqual(parseCsv('a;b;c\n1;"x;y";"he said ""hi"""\r\n2;;"two\nlines"\n'), [['a', 'b', 'c'], ['1', 'x;y', 'he said "hi"'], ['2', '', 'two\nlines']])
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']])
})

test('numbers show as their format says', () => {
  assert.equal(formatNumber(0.1234, '0.00%'), '12.34%')
  assert.equal(formatNumber(1234.5, '#,##0.00', 'en'), '1,234.50')
  assert.equal(formatNumber(3.14159, '0.0'), '3.1')
  assert.equal(formatNumber(0.1 + 0.2, undefined), '0.3')
  assert.equal(formatNumber(43200, 'yyyy-mm-dd', 'en'), '04/10/2018')
  assert.ok(isDateFormat('m/d/yyyy') && isDateFormat('[$-409]d-mmm') && !isDateFormat('#,##0.00') && !isDateFormat('0%'))
})

test('a file read back is set right: only numbers, text and #rrggbb colours get through', () => {
  const chart = asSheetFile({
    v: 1, kind: 'chart', type: 'line', text: 'red" onload="x', background: 'url(javascript:1)', legend: 'left',
    series: [{ name: 42, color: '"/><script>', values: [1, '2', null, Infinity], width: '9', trend: '#00ff00' }],
  })
  assert.ok(chart && chart.kind === 'chart')
  assert.deepEqual(chart.series[0], { name: '42', color: '#4472c4', values: [1, null, null, null], width: 2, trend: '#00ff00' })
  assert.equal(chart.text, '#595959')
  assert.equal(chart.background, undefined)
  assert.equal(chart.legend, null)

  const sheet = asSheetFile({ v: 1, kind: 'sheet', cells: [['a', 7, null], 'not a row'], widths: ['100" onclick="x', 5000], rowHeight: '22' })
  assert.ok(sheet && sheet.kind === 'sheet')
  assert.deepEqual(sheet.cells, [['a', '7', ''], []])
  assert.deepEqual(sheet.widths, [72, 2000, 72])
  assert.equal(sheet.rowHeight, 22)

  assert.equal(asSheetFile({ v: 2, kind: 'sheet' }), null)
  assert.equal(asSheetFile({ v: 1, kind: 'chart', type: 'radar', series: [{ values: [1] }] }), null)
  assert.equal(asSheetFile('{}'), null)
})
