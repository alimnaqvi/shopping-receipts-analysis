import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractReceiptUpload, refreshReceiptBatch, submitReceiptBatch } from '../server/utils/receipt-upload-processing.ts'

const extraction = { lines: [] }
const input = { id: 'one', filename: 'receipt.jpg', mime: 'image/jpeg', bytes: Buffer.from('image') }

function database(responses, catalog = { products: [], aliases: [] }) {
  const queries = []
  const sql = (strings, ...values) => {
    queries.push({ query: strings.join('?').replaceAll(/\s+/g, ' ').trim(), values })
    if (strings.join('').includes('CASE WHEN count(DISTINCT product_family)')) return Promise.resolve(catalog.products)
    if (strings.join('').includes('FROM grocery_item_aliases')) return Promise.resolve(catalog.aliases)
    return Promise.resolve(responses.shift() ?? [])
  }
  sql.begin = async callback => callback(sql)
  sql.json = value => {
    assert.notEqual(value, null, 'Missing extraction must use SQL NULL, not JSON null')
    return value
  }
  return { sql, queries }
}

test('leases immediate extraction and stores the original model result separately from its editable draft', async () => {
  const { sql, queries } = database([[], [{ count: 0 }], [input], [{ name: 'Dairy' }], []])
  const provider = { model: 'model', extract: async (page, categories, catalog) => {
    assert.deepEqual(page, input)
    assert.deepEqual(categories, ['Dairy'])
    assert.deepEqual(catalog, { products: [], aliases: [], truncated: false })
    return extraction
  } }
  assert.deepEqual(await extractReceiptUpload(sql, 'one', provider), { status: 'review' })
  assert.match(queries[2].query, /10 minutes/)
  assert.match(queries.at(-1).query, /lease_token = \?/)
  assert.deepEqual(queries.at(-1).values.slice(0, 2), [extraction, extraction])
})

test('approved German aliases canonicalize immediate and Batch drafts without rewriting raw model evidence', async () => {
  const product = { item: 'Sliced cheese', family: 'Sliced cheese', brand: null, variant: null, category: 'Dairy' }
  const catalog = { products: [product], aliases: [{ ...product, location: 'REWE', rawDescription: 'KAESEAUFSCHNITT' }] }
  const raw = { location: 'REWE', lines: [{ item: 'Cheese slices', rawDescription: 'K\u00e4seaufschnitt', brand: null, variant: null }] }
  const immediate = database([[], [{ count: 0 }], [input], [], []], catalog)
  await extractReceiptUpload(immediate.sql, 'one', { model: 'model', extract: async (_page, _categories, provided) => {
    assert.equal(provided.products[0].item, 'Sliced cheese')
    return raw
  } })
  const values = immediate.queries.at(-1).values
  assert.equal(values[0].lines[0].item, 'Cheese slices')
  assert.equal(values[1].lines[0].item, 'Sliced cheese')
  const batch = database([[{ id: 'one', status: 'batch' }], []], catalog)
  await refreshReceiptBatch(batch.sql, 'batch_one', { pollBatch: async () => ({ status: 'completed', terminal: true, results: [{ id: 'one', extraction: raw }] }) })
  assert.equal(batch.queries.at(-1).values[1].lines[0].item, 'Cheese slices')
  assert.equal(batch.queries.at(-1).values[2].lines[0].item, 'Sliced cheese')
})

test('rejects concurrency exhaustion and already-claimed uploads before provider calls', async () => {
  await assert.rejects(extractReceiptUpload(database([[], [{ count: 3 }]]).sql, 'one', { model: 'model' }), { statusCode: 429 })
  await assert.rejects(extractReceiptUpload(database([[], [{ count: 0, bytes: String(65 * 1024 * 1024) }]]).sql, 'one', { model: 'model' }), { statusCode: 413 })
  await assert.rejects(extractReceiptUpload(database([[], [{ count: 0 }], []]).sql, 'one', { model: 'model' }), { statusCode: 409 })
})

test('persists retryable failures without leaving a successful-looking review draft', async () => {
  for (const failure of [new Error('Rate limited'), 'offline']) {
    const { sql, queries } = database([[], [{ count: 0 }], [input], [], []])
    const provider = { model: 'model', extract: async () => { throw failure } }
    await assert.rejects(extractReceiptUpload(sql, 'one', provider), { statusCode: 502 })
    assert.match(queries.at(-1).query, /status = 'failed'/)
  }
})

test('submits selected receipts together, retains batch identity, and rejects duplicate IDs', async () => {
  const { sql, queries } = database([[], [{ count: 0 }], [input], [], []])
  const provider = { model: 'model', submitBatch: async pages => {
    assert.deepEqual(pages, [input])
    return 'batch_one'
  } }
  assert.deepEqual(await submitReceiptBatch(sql, ['one'], provider), { batchId: 'batch_one' })
  assert.match(queries.at(-1).query, /status = 'batch'/)
  for (const ids of [[], Array(101).fill('one'), ['one', 'one']]) await assert.rejects(submitReceiptBatch(sql, ids, provider), { statusCode: 400 })
  for (const failure of [new Error('Unavailable'), null]) {
    const failed = database([[], [{ count: 0 }], [input], [], []])
    await assert.rejects(submitReceiptBatch(failed.sql, ['one'], { model: 'model', submitBatch: async () => { throw failure } }), { statusCode: 502 })
    assert.match(failed.queries.at(-1).query, /status = 'failed'/)
  }
})

test('refresh preserves completed partial results and makes missing, refused and expired results retryable', async () => {
  const rows = [{ id: 'one', status: 'batch' }, { id: 'two', status: 'batch' }, { id: 'three', status: 'batch' }]
  const { sql, queries } = database([rows, [], [], []])
  const provider = { pollBatch: async () => ({ status: 'expired', terminal: true, results: [{ id: 'two', extraction }, { id: 'one', error: 'Refused' }] }) }
  assert.deepEqual(await refreshReceiptBatch(sql, 'batch_one', provider), { status: 'expired', updated: 3 })
  const updates = queries.filter(query => query.query.startsWith('UPDATE'))
  assert.equal(updates[0].values[0], 'failed')
  assert.equal(updates[0].values[3], 'Refused')
  assert.equal(updates[1].values[0], 'review')
  assert.match(updates[2].values[3], /expired/)
  assert.match(updates[0].query, /AND status = 'batch'/)
})

test('refresh handles unknown, already imported and still running batches; cancellation collects eventual results', async () => {
  await assert.rejects(refreshReceiptBatch(database([]).sql, 'batch_none', {}), { statusCode: 404 })
  assert.deepEqual(await refreshReceiptBatch(database([[{ status: 'review' }]]).sql, 'batch_one', {}), { status: 'finished', updated: 0 })
  let cancelled = false
  const provider = {
    cancelBatch: async id => { assert.equal(id, 'batch_one'); cancelled = true },
    pollBatch: async () => ({ status: 'cancelling', terminal: false, results: [] })
  }
  assert.deepEqual(await refreshReceiptBatch(database([[{ status: 'batch' }]]).sql, 'batch_one', provider, true), { status: 'cancelling', updated: 0 })
  assert.equal(cancelled, true)
})