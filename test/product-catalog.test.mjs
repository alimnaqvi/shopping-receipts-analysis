import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boundedCatalog, itemCatalog, learnProductAlias, receiptItemCatalog } from '../server/utils/product-catalog.ts'

const product = { item: 'Sliced cheese', family: 'Sliced cheese', brand: null, variant: null, category: 'Dairy and Eggs' }
const alias = { item: product.item, location: 'REWE', rawDescription: 'KAESEAUFSCHNITT', brand: null, variant: null }

test('catalog bounds product count, alias count and encoded context size', () => {
  assert.deepEqual(boundedCatalog([product], [alias]), { products: [product], aliases: [alias], truncated: false })
  assert.equal(boundedCatalog(Array(501).fill(product), []).products.length, 500)
  assert.equal(boundedCatalog([product], Array(1001).fill({ ...alias, rawDescription: '' })).truncated, true)
  assert.equal(boundedCatalog([{ ...product, item: 'x'.repeat(80001) }], []).products.length, 0)
  assert.equal(boundedCatalog([product], [{ ...alias, rawDescription: 'x'.repeat(120000) }]).aliases.length, 0)
  assert.equal(boundedCatalog([], [alias]).aliases.length, 0)
})

test('loads existing identities and only their approved aliases, learning nothing during extraction', async () => {
  const responses = [[product], [alias]]
  const queries = []
  const sql = (strings, ...values) => { queries.push({ sql: strings.join('?'), values }); return Promise.resolve(responses.shift()) }
  assert.deepEqual(await itemCatalog(sql), boundedCatalog([product], [alias]))
  assert.match(queries[0].sql, /GROUP BY item/)
  assert.match(queries[1].sql, /grocery_item_aliases/)
  assert.equal(queries.some(query => /INSERT|UPDATE/.test(query.sql)), false)
})

test('approved alias keys normalize store and raw text without conflating canonical products', async () => {
  const values = []
  const sql = async (_strings, ...parameters) => { values.push(parameters) }
  await learnProductAlias(sql, 'REWE', { ...alias, item: product.item })
  await learnProductAlias(sql, 'rewe', { ...alias, rawDescription: 'K\u00e4seaufschnitt' })
  assert.equal(values[0][0], values[1][0])
  assert.equal(values[0][1], values[1][1])
  assert.equal(values[0][2].length, 64)
  await learnProductAlias(sql, 'REWE', { ...alias, item: 'Different cheese' })
  assert.notEqual(values[0][2], values[2][2])
  await learnProductAlias(sql, 'REWE', { ...alias, item: null })
  await learnProductAlias(sql, 'REWE', { ...alias, rawDescription: '' })
  assert.equal(values.length, 3)
})

test('receipt-specific alias lookup finds older products outside model context and retains ambiguity', async () => {
  const other = { ...product, item: 'Other cheese' }
  const aliases = [alias, { ...alias, item: other.item }]
  const responses = [aliases, [product, other]]
  const sql = async () => responses.shift()
  const catalog = { products: [], aliases: [], truncated: true }
  const receipt = { location: 'REWE', lines: [{ rawDescription: 'K\u00e4seaufschnitt' }] }
  const complete = await receiptItemCatalog(sql, receipt, catalog)
  assert.deepEqual(complete.products, [product, other])
  assert.deepEqual(complete.aliases, aliases)
  assert.equal(complete.truncated, true)
  assert.deepEqual(await receiptItemCatalog(sql, { location: null, lines: [] }, catalog), catalog)
  const unchanged = { products: [product], aliases: [{ ...alias, location: 'ALDI' }, { ...alias, rawDescription: 'Other text' }, alias], truncated: false }
  const empty = await receiptItemCatalog(async () => [], receipt, unchanged)
  assert.equal(empty.aliases.length, 2)
  assert.equal(empty.products.length, 1)
})