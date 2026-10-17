import assert from 'node:assert/strict'
import { test } from 'node:test'
import { familyPriceRows } from '../shared/utils/product-family.ts'

const purchase = { id: '1', purchasedOn: '2026-10-01', item: 'Ja! Milk 1.5%', brand: 'Ja!', variant: '1.5%', location: 'REWE', price: '1.2', size: '1', unit: 'L', costPerUnit: null, saleItem: false }

test('family comparisons preserve separate brands/variants and commensurate unit bases', () => {
  const rows = familyPriceRows([purchase, { ...purchase, id: '2', item: 'Ja! Milk 3%', variant: '3%' },
    { ...purchase, id: '3', item: 'Milsani Milk 1.5%', brand: 'Milsani' }, { ...purchase, id: '4', unit: 'g', size: '1000' }])
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.filter(row => row.item === purchase.item).map(row => row.basis), ['mass', 'volume'])
  assert.equal(rows[0].purchases, 1)
  assert.equal(rows.find(row => row.basis === 'volume').latestNormalized, 0.12)
})

test('paid promotions, historical lows, regular references and total line amounts stay distinct', () => {
  const rows = familyPriceRows([{ ...purchase, id: '10', purchasedOn: '2026-10-02', price: '1.5', size: '2', saleItem: true, regularPrice: '2.4' }, purchase,
    { ...purchase, id: '2', price: '1.00', saleItem: true }, { ...purchase, id: '11', purchasedOn: '2026-10-03', brand: null, variant: null, price: '0.90', saleItem: true }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].purchases, 4)
  assert.equal(rows[0].totalSpent, 4.6)
  assert.equal(rows[0].latestNormalized, 0.09)
  assert.equal(rows[0].lowestNormalized, 0.075)
  assert.equal(rows[0].regularNormalized, 0.12)
  assert.equal(rows[0].brand, 'Ja!')
})

test('missing sizes are visible but do not produce invented unit prices or regular references', () => {
  const rows = familyPriceRows([{ ...purchase, size: null, unit: null, saleItem: true, brand: null, variant: null }])
  assert.equal(rows[0].basis, 'unknown')
  assert.equal(rows[0].latestNormalized, null)
  assert.equal(rows[0].lowestNormalized, null)
  assert.equal(rows[0].regularNormalized, null)
  assert.deepEqual(familyPriceRows([]), [])
})