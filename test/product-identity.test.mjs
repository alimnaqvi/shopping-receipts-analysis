import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCatalog, catalogMatch, productTextKey, receiptMinute } from '../shared/utils/product-identity.ts'

const product = { item: 'Ja! Milk 1.5%', family: 'Milk', brand: 'Ja!', variant: '1.5%', category: 'Dairy and Eggs' }
const line = { item: 'Milk', rawDescription: 'JA! MILCH 1,5%', brand: 'Ja!', variant: '1.5%', category: null }
const alias = { ...product, location: 'REWE', rawDescription: 'JA! MILCH 1,5%' }
const catalog = { products: [product], aliases: [alias], truncated: false }

test('identity keys retain brand and fat distinctions and normalize receipt spelling', () => {
  assert.equal(productTextKey('K\u00e4seaufschnitt'), productTextKey('KAESEAUFSCHNITT'))
  assert.equal(productTextKey('  Ja! MILCH 1,5% '), 'ja milch 1.5%')
  assert.notEqual(productTextKey('Milk 1.5%'), productTextKey('Milk 3%'))
  assert.equal(productTextKey(null), '')
})

test('printed time keeps minute accuracy, unknowns remain unknown, invalid times fail', () => {
  for (const value of [null, undefined, '']) assert.equal(receiptMinute(value), null)
  assert.equal(receiptMinute('14:58'), '14:58')
  assert.equal(receiptMinute('21:34:59'), '21:34')
  for (const value of ['24:00', '12:60', '12:34:60', '9:30', 1234, 'scan 12:34']) assert.throws(() => receiptMinute(value))
})

test('only exact compatible names or unambiguous store aliases select canonical products', () => {
  assert.equal(catalogMatch(line, 'rewe', catalog), product)
  assert.equal(catalogMatch({ ...line, item: 'JA! MILK 1.5%' }, 'Other', catalog), product)
  assert.equal(catalogMatch({ ...line, brand: 'Milsani' }, 'REWE', catalog), null)
  assert.equal(catalogMatch({ ...line, variant: '3%' }, 'REWE', catalog), null)
  assert.equal(catalogMatch(line, 'ALDI', catalog), null)
  assert.equal(catalogMatch({ ...line, brand: null, variant: null }, 'REWE', catalog), product)
  const other = { ...product, item: 'Milsani Milk 1.5%', brand: 'Milsani' }
  assert.equal(catalogMatch({ ...line, brand: null }, 'REWE', { products: [product, other], aliases: [alias, { ...alias, item: other.item, brand: other.brand }] }), null)
  assert.equal(catalogMatch(line, 'REWE', { products: [], aliases: [alias] }), null)
  assert.equal(catalogMatch({ ...line, item: product.item }, '', { products: [product, product], aliases: [] }), null)
})

test('catalog mapping preserves raw evidence and manually corrected identities', () => {
  const receipt = { location: 'REWE', lines: [line] }
  const mapped = applyCatalog(receipt, catalog)
  assert.equal(mapped.lines[0].item, product.item)
  assert.equal(mapped.lines[0].family, 'Milk')
  assert.equal(mapped.lines[0].rawDescription, line.rawDescription)
  assert.equal(receipt.lines[0].item, 'Milk')
  assert.equal(applyCatalog(receipt, catalog, receipt).lines[0].item, product.item)
  assert.equal(applyCatalog({ ...receipt, lines: [{ ...line, item: 'My reviewed milk' }] }, catalog, receipt).lines[0].item, 'My reviewed milk')
  assert.equal(applyCatalog(receipt, catalog, { ...receipt, lines: [] }).lines[0].item, 'Milk')
  assert.equal(applyCatalog({ ...receipt, location: 'Other' }, catalog).lines[0].item, 'Milk')
  const unknown = { ...product, family: null, brand: null, variant: null, category: null }
  assert.equal(applyCatalog({ ...receipt, lines: [{ ...line, item: product.item }] }, { products: [unknown], aliases: [] }).lines[0].family, null)
})