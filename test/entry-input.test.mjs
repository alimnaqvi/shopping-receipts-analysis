import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

globalThis.createError = (input) => Object.assign(new Error(input.statusMessage), input)
const { normalizeEntry } = await import('../server/utils/entry-input.ts')
const { maxEntryNotesLength } = await import('../shared/utils/entry-notes.ts')

const validEntry = {
  purchasedOn: '2026-08-06',
  item: 'Milk',
  location: 'Market',
  size: 2,
  unit: 'L',
  price: 4.5
}

describe('normalizeEntry', () => {
  test('normalizes a standard entry and computes cost per unit', () => {
    assert.deepEqual(normalizeEntry(validEntry), {
      purchasedOn: '2026-08-06',
      item: 'Milk',
      location: 'Market',
      size: 2,
      unit: 'L',
      price: 4.5,
      costPerUnit: 2.25,
      saleItem: false,
      nonGrocery: false,
      notes: null
    })
  })

  test('computes stored costs per 100 g or mL for base metric units', () => {
    assert.ok(Math.abs(normalizeEntry({ ...validEntry, size: 500, unit: 'grams' }).costPerUnit - 0.9) < 1e-12)
    assert.equal(normalizeEntry({ ...validEntry, size: 750, unit: 'ml' }).costPerUnit, 0.6)
  })

  test('derives cost per unit instead of trusting an explicitly supplied value', () => {
    assert.equal(normalizeEntry({ ...validEntry, costPerUnit: '9.99' }).costPerUnit, 2.25)
  })

  test('supports legacy import column names', () => {
    const entry = normalizeEntry({
      food_Date: '2025-03-04T00:00:00.000Z',
      Item: '  Apples ',
      Location: '  Shaw’s  ',
      Size: '3',
      Unit: 'LBS.',
      Price: '5.25',
      Cost_Per_Unit: '999.99',
      Sale_Item: 'yes',
      Non_Grocery: 'x',
      Notes: '  clearance  '
    })
    assert.deepEqual(entry, {
      purchasedOn: '2025-03-04',
      item: 'Apples',
      location: "Shaw's",
      size: 3,
      unit: 'lb',
      price: 5.25,
      costPerUnit: 1.75,
      saleItem: true,
      nonGrocery: true,
      notes: 'clearance'
    })
  })

  test('accepts an imported category without changing uncategorized legacy rows', () => {
    assert.equal(normalizeEntry({ ...validEntry, category: 'Produce' }).category, 'Produce')
    assert.equal(Object.hasOwn(normalizeEntry(validEntry), 'category'), false)
  })

  test('recognizes supported truthy values without treating arbitrary text as true', () => {
    for (const value of [true, 1, 'true', ' YES ', 'y', 'X']) {
      assert.equal(normalizeEntry({ ...validEntry, saleItem: value }).saleItem, true)
    }
    for (const value of [false, 0, 'false', 'no', 'anything']) {
      assert.equal(normalizeEntry({ ...validEntry, saleItem: value }).saleItem, false)
    }
  })

  test('converts blank optional values to null', () => {
    const entry = normalizeEntry({ ...validEntry, size: '', unit: ' ', costPerUnit: '', notes: ' ' })
    assert.equal(entry.size, null)
    assert.equal(entry.unit, null)
    assert.equal(entry.costPerUnit, null)
    assert.equal(entry.notes, null)
  })

  test('accepts notes at the character limit and rejects longer notes', () => {
    assert.equal(normalizeEntry({ ...validEntry, notes: 'x'.repeat(maxEntryNotesLength) }).notes.length, maxEntryNotesLength)
    assert.throws(
      () => normalizeEntry({ ...validEntry, notes: 'x'.repeat(maxEntryNotesLength + 1) }),
      error => error.statusCode === 400 && error.statusMessage === `Notes must be ${maxEntryNotesLength} characters or fewer`
    )
  })

  test('rejects invalid required values with HTTP 400 errors', () => {
    const cases = [
      [{ ...validEntry, purchasedOn: '08/06/2026' }, 'A valid purchase date is required'],
      [{ ...validEntry, purchasedOn: '2026-02-29' }, 'A valid purchase date is required'],
      [{ ...validEntry, purchasedOn: '2026-02-31' }, 'A valid purchase date is required'],
      [{ ...validEntry, purchasedOn: '2026-13-01' }, 'A valid purchase date is required'],
      [{ ...validEntry, item: '   ' }, 'Item is required'],
      [{ ...validEntry, location: '' }, 'Store is required'],
      [{ ...validEntry, price: -0.01 }, 'Price must be zero or greater'],
      [{ ...validEntry, price: 'not-a-number' }, 'Price must be zero or greater'],
      [{ ...validEntry, size: 0 }, 'Size must be greater than zero'],
      [{ ...validEntry, size: -1 }, 'Size must be greater than zero']
    ]
    for (const [input, message] of cases) {
      assert.throws(
        () => normalizeEntry(input),
        error => error.statusCode === 400 && error.statusMessage === message,
        message
      )
    }
  })

  test('accepts free items', () => {
    assert.equal(normalizeEntry({ ...validEntry, price: 0 }).price, 0)
  })

  test('normalizes optional product metadata fields when provided and omits them when undefined', () => {
    const entry = normalizeEntry({
      ...validEntry,
      productFamily: '  Cheese slices ',
      brand: '  Milbona ',
      variant: '  Gouda ',
      rawDescription: '  MILBONA GOUDA 400G ',
      quantity: '2',
      regularPrice: '5.50',
      discount: '1.00',
      purchasedTime: '14:35:20'
    })
    assert.equal(entry.productFamily, 'Cheese slices')
    assert.equal(entry.brand, 'Milbona')
    assert.equal(entry.variant, 'Gouda')
    assert.equal(entry.rawDescription, 'MILBONA GOUDA 400G')
    assert.equal(entry.quantity, 2)
    assert.equal(entry.regularPrice, 5.5)
    assert.equal(entry.discount, 1)
    assert.equal(entry.purchasedTime, '14:35')

    const aliasedFamily = normalizeEntry({ ...validEntry, family: ' Milk ' })
    assert.equal(aliasedFamily.productFamily, 'Milk')

    const cleared = normalizeEntry({
      ...validEntry,
      productFamily: '   ',
      brand: null,
      variant: '',
      rawDescription: '',
      quantity: '',
      regularPrice: null,
      discount: '',
      purchasedTime: ''
    })
    assert.equal(cleared.productFamily, null)
    assert.equal(cleared.brand, null)
    assert.equal(cleared.variant, null)
    assert.equal(cleared.rawDescription, null)
    assert.equal(cleared.quantity, null)
    assert.equal(cleared.regularPrice, null)
    assert.equal(cleared.discount, null)
    assert.equal(cleared.purchasedTime, null)
  })

  test('rejects invalid optional product metadata fields with HTTP 400 errors', () => {
    const cases = [
      [{ ...validEntry, category: 'x'.repeat(101) }, 'Category must be 100 characters or fewer'],
      [{ ...validEntry, productFamily: 123 }, 'Product family must be text'],
      [{ ...validEntry, productFamily: 'x'.repeat(101) }, 'Product family must be 100 characters or fewer'],
      [{ ...validEntry, brand: 'x'.repeat(201) }, 'Brand must be 200 characters or fewer'],
      [{ ...validEntry, variant: 'x'.repeat(201) }, 'Variant must be 200 characters or fewer'],
      [{ ...validEntry, rawDescription: 'x'.repeat(2001) }, 'Receipt text must be 2000 characters or fewer'],
      [{ ...validEntry, quantity: 0 }, 'Quantity must be greater than zero'],
      [{ ...validEntry, quantity: -1 }, 'Quantity must be greater than zero'],
      [{ ...validEntry, regularPrice: -0.01 }, 'Regular price must be zero or greater'],
      [{ ...validEntry, discount: -0.01 }, 'Discount must be zero or greater'],
      [{ ...validEntry, purchasedTime: '25:99' }, 'Receipt time must be HH:mm or HH:mm:ss']
    ]
    for (const [input, message] of cases) {
      assert.throws(
        () => normalizeEntry(input),
        error => error.statusCode === 400 && error.statusMessage === message,
        message
      )
    }
  })
})

