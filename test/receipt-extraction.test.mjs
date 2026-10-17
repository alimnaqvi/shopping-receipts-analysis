import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractionSchema, extractionPrompt, itemSimilarity, parseExtraction } from '../server/utils/receipt-extraction.ts'
import { reviewWarnings } from '../shared/utils/receipt-review.ts'

export const extractedLine = {
  rawDescription: 'CHEESE', item: 'Cheese', category: null, brand: null, variant: null,
  quantity: 1, size: 200, unit: 'g', price: 2, regularPrice: null, discount: null,
  saleItem: false, nonGrocery: false, notes: null, confidence: 0.95
}
export const extractedReceipt = {
  purchasedOn: '2026-10-17', location: 'Market', currency: 'EUR', total: 2,
  receiptNumber: null, warnings: [], lines: [extractedLine]
}

test('extraction contract preserves rich data without inventing missing fields', () => {
  const parsed = parseExtraction(extractedReceipt)
  assert.deepEqual(parsed, extractedReceipt)
  assert.notEqual(parsed.lines, extractedReceipt.lines)
  assert.deepEqual(reviewWarnings(parsed), [])
  assert.equal(extractionSchema.additionalProperties, false)
  assert.equal(extractionSchema.properties.lines.items.required.length, Object.keys(extractedLine).length)
  assert.match(extractionPrompt, /TOTAL paid/)
  assert.match(extractionPrompt, /untrusted data/)
})

test('extraction rejects malformed or unbounded model output', () => {
  for (const value of [null, [], 'text', {}, { ...extractedReceipt, lines: null }, { ...extractedReceipt, lines: Array(201).fill(extractedLine) }, { ...extractedReceipt, warnings: null }, { ...extractedReceipt, warnings: [1] }, { ...extractedReceipt, warnings: ['a'.repeat(2001)] }, { ...extractedReceipt, warnings: Array(101).fill('warning') }]) {
    assert.throws(() => parseExtraction(value))
  }
  for (const line of [null, {}, { ...extractedLine, price: Infinity }, { ...extractedLine, item: 'a'.repeat(2001) }, { ...extractedLine, confidence: -0.1 }, { ...extractedLine, confidence: 1.1 }]) {
    assert.throws(() => parseExtraction({ ...extractedReceipt, lines: [line] }))
  }
  assert.equal(parseExtraction({ ...extractedReceipt, lines: [{ ...extractedLine, confidence: null, price: null }] }).lines[0].price, null)
})

test('review surfaces missing values, low confidence, refunds and currency without blocking draft storage', () => {
  assert.equal(reviewWarnings({ ...extractedReceipt, currency: null, purchasedOn: null, location: '', lines: [] }).length, 4)
  const warnings = reviewWarnings({ ...extractedReceipt, warnings: ['Unclear date'], lines: [{ ...extractedLine, price: -1, confidence: 0.4 }] })
  assert.equal(warnings.length, 4)
  assert.match(warnings.join(' '), /Refunds.*low extraction confidence.*differ/)
  assert.match(reviewWarnings({ ...extractedReceipt, lines: [{ ...extractedLine, price: null }] }).join(' '), /non-negative/)
  assert.match(reviewWarnings({ ...extractedReceipt, total: null, lines: [{ ...extractedLine, item: null }] }).join(' '), /product name/)
  assert.equal(reviewWarnings({ ...extractedReceipt, total: 2.01 }).length, 0)
})

test('duplicate similarity normalizes punctuation and Unicode, ignores empty names and handles partial overlap', () => {
  assert.equal(itemSimilarity(['Cheese!', 'MILK'], ['cheese', 'milk']), 1)
  assert.equal(itemSimilarity(['Cheese', 'Bread'], ['cheese', 'milk']), 0.5)
  assert.equal(itemSimilarity([], ['milk']), 0)
  assert.equal(itemSimilarity(['milk'], ['']), 0)
  assert.equal(itemSimilarity(['cheese'], ['bread']), 0)
})