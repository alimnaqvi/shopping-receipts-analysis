import assert from 'node:assert/strict'
import { test } from 'node:test'
import { familyPriceRows, familyTrendSeries } from '../shared/utils/product-family.ts'

const purchase = { id: '1', purchasedOn: '2026-10-01', item: 'Ja! Milk 1.5%', brand: 'Ja!', variant: '1.5%', location: 'REWE', price: '1.2', size: '1', unit: 'L', costPerUnit: null, saleItem: false }

test('family comparisons preserve separate brands/variants, commensurate unit bases, and price diff vs cheapest', () => {
  const rows = familyPriceRows([
    purchase,
    { ...purchase, id: '2', item: 'Ja! Milk 3%', variant: '3%', price: '1.50' },
    { ...purchase, id: '3', item: 'Milsani Milk 1.5%', brand: 'Milsani', location: 'ALDI', price: '1.20' },
    { ...purchase, id: '4', unit: 'g', size: '1000' }
  ])
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.filter(row => row.item === purchase.item).map(row => row.basis), ['mass', 'volume'])
  assert.equal(rows[0].purchases, 1)
  const volumeMilk15 = rows.find(row => row.item === 'Ja! Milk 1.5%' && row.basis === 'volume')
  const volumeMilk30 = rows.find(row => row.item === 'Ja! Milk 3%' && row.basis === 'volume')
  assert.equal(volumeMilk15.latestNormalized, 0.12)
  assert.equal(volumeMilk15.diffFromCheapestPercent, 0)
  assert.deepEqual(volumeMilk15.stores, ['REWE'])
  assert.equal(volumeMilk30.latestNormalized, 0.15)
  assert.equal(volumeMilk30.diffFromCheapestPercent, 25)
})

test('paid promotions, historical lows, averages, highs, regular references and total line amounts stay distinct', () => {
  const rows = familyPriceRows([{ ...purchase, id: '10', purchasedOn: '2026-10-02', price: '1.5', size: '2', saleItem: true, regularPrice: '2.4' }, purchase,
    { ...purchase, id: '2', price: '1.00', saleItem: true }, { ...purchase, id: '11', purchasedOn: '2026-10-03', brand: null, variant: null, price: '0.90', saleItem: true }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].purchases, 4)
  assert.equal(rows[0].totalSpent, 4.6)
  assert.equal(rows[0].latestNormalized, 0.09)
  assert.equal(rows[0].lowestNormalized, 0.075)
  assert.equal(rows[0].highestNormalized, 0.12)
  assert.equal(rows[0].averageNormalized, 0.0963)
  assert.equal(rows[0].regularNormalized, 0.12)
  assert.equal(rows[0].brand, 'Ja!')
})

test('missing sizes are visible but do not produce invented unit prices or regular references', () => {
  const rows = familyPriceRows([{ ...purchase, size: null, unit: null, saleItem: true, brand: null, variant: null }])
  assert.equal(rows[0].basis, 'unknown')
  assert.equal(rows[0].latestNormalized, null)
  assert.equal(rows[0].averageNormalized, null)
  assert.equal(rows[0].lowestNormalized, null)
  assert.equal(rows[0].highestNormalized, null)
  assert.equal(rows[0].regularNormalized, null)
  assert.equal(rows[0].diffFromCheapestPercent, null)
  assert.deepEqual(familyPriceRows([]), [])
})

test('familyTrendSeries summarizes chronological family price trends and variant price spread per basis', () => {
  const trends = familyTrendSeries([
    { ...purchase, id: '1', purchasedOn: '2026-09-01', item: 'Ja! Gouda Slices', brand: 'Ja!', variant: 'Young', price: '1.99', size: '400', unit: 'g' },
    { ...purchase, id: '2', purchasedOn: '2026-09-15', item: 'Kerrygold Cheddar Slices', brand: 'Kerrygold', variant: 'Cheddar', price: '2.49', size: '150', unit: 'g' },
    { ...purchase, id: '3', purchasedOn: '2026-10-01', item: 'Ja! Gouda Slices', brand: 'Ja!', variant: 'Young', price: '2.19', size: '400', unit: 'g' },
    { ...purchase, id: '4', purchasedOn: '2026-10-02', item: 'Cheese platter', size: '1', unit: 'ea', price: '3.00' },
    { ...purchase, id: '5', purchasedOn: '2026-10-03', item: 'Mystery cheese', size: null, unit: null, price: '2.00' }
  ])
  assert.equal(trends.length, 2)
  assert.equal(trends[0].basis, 'mass')
  assert.equal(trends[0].pointCount, 3)
  assert.equal(trends[0].variantCount, 2)
  assert.equal(trends[0].lowestNormalized, 0.4975)
  assert.equal(trends[0].highestNormalized, 1.66)
  assert.equal(trends[0].netChangePercent, 10.1)
  assert.equal(trends[0].spreadPercent, 203.2)

  assert.equal(trends[1].basis, 'each')
  assert.equal(trends[1].pointCount, 1)
  assert.equal(trends[1].variantCount, 1)
  assert.equal(trends[1].netChangePercent, null)
  assert.equal(trends[1].spreadPercent, null)
})