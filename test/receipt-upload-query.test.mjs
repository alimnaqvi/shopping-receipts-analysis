import assert from 'node:assert/strict'
import { test } from 'node:test'
import { approveReceiptUpload, approvedReceipt, getUpload, listReceiptUploads, receiptUploadDuplicates, requireUploadId, saveUploadDraft, setUploadDiscarded, storeReceiptPages, uploadError } from '../server/utils/receipt-upload-query.ts'

globalThis.createError = input => Object.assign(new Error(input.statusMessage), input)
const id = '12345678-1234-4123-8123-123456789abc'
const line = { rawDescription: 'CHEESE', item: 'Cheese', category: null, brand: 'Brand', variant: 'Organic', quantity: 1, size: 200, unit: 'g', price: 2, regularPrice: 3, discount: 1, saleItem: true, nonGrocery: false, notes: null, confidence: 0.9 }
const draft = { purchasedOn: '2026-10-17', location: 'Market', currency: 'EUR', total: 2, receiptNumber: null, warnings: [], lines: [line] }

function database(responses, known = []) {
  const queries = []
  const sql = (strings, ...values) => {
    queries.push({ query: strings.join('?').replaceAll(/\s+/g, ' ').trim(), values })
    if (strings.join('').includes('SELECT DISTINCT item, brand, variant')) return Promise.resolve(known)
    return Promise.resolve(responses.shift() ?? [])
  }
  sql.begin = async callback => callback(sql)
  sql.json = value => value
  return { sql, queries }
}

test('upload IDs are UUIDs and errors carry HTTP status', () => {
  assert.equal(requireUploadId(id), id)
  for (const value of ['1', '../source', null, id.replace('4123', '0123')]) assert.throws(() => requireUploadId(value), { statusCode: 400 })
  assert.equal(uploadError(409, 'Changed').statusMessage, 'Changed')
})

test('stores new pages and returns exact duplicates without replacing originals or triggering extraction', async () => {
  const { sql, queries } = database([[{ id }], [], [{ id }]])
  const page = { hash: 'hash', filename: 'receipt.jpg', page: 1, mime: 'image/jpeg', bytes: Buffer.from('jpg') }
  assert.deepEqual(await storeReceiptPages(sql, [page, page]), [{ id, duplicate: false }, { id, duplicate: true }])
  assert.match(queries[0].query, /ON CONFLICT .* DO NOTHING/)
  assert.equal(queries.length, 3)
})

test('loads original bytes only on request and paginates summaries without selecting originals', async () => {
  const { sql, queries } = database([[{ id }], [{ id, bytes: Buffer.from('jpg') }], Array(51).fill({ id }), []])
  assert.equal((await getUpload(sql, id)).id, id)
  assert.equal(queries[0].values[0], false)
  assert.equal((await getUpload(sql, id, true)).bytes.toString(), 'jpg')
  const result = await listReceiptUploads(sql, 0, false)
  assert.equal(result.uploads.length, 50)
  assert.equal(result.hasMore, true)
  assert.match(queries[2].query, /NULL AS extraction/)
  assert.equal((await listReceiptUploads(sql, 50, true)).hasMore, false)
  await assert.rejects(getUpload(sql, id), { statusCode: 404 })
})

test('finds same-day same-store receipts and overlapping items across stores and pending drafts', async () => {
  const { sql } = database([
    [{ id: '1', location: 'market', items: ['Other'] }, { id: '2', location: 'Other', items: ['CHEESE'] }, { id: '3', location: 'Elsewhere', items: ['Bread'] }],
    [{ id: 'upload', draft }, { id: 'empty', draft: { ...draft, location: null, lines: [{ ...line, item: null }] } }]
  ])
  const candidates = await receiptUploadDuplicates(sql, draft, id)
  assert.deepEqual(candidates.map(candidate => [candidate.id, candidate.source, candidate.similarity]), [['2', 'receipt', 1], ['upload', 'upload', 1], ['1', 'receipt', 0]])
  assert.equal(candidates.find(candidate => candidate.id === '1').sameStore, true)
  assert.deepEqual(await receiptUploadDuplicates(sql, { ...draft, purchasedOn: null }, id), [])
})

test('duplicate time evidence distinguishes matching minutes, other visits and unknown times', async () => {
  const { sql } = database([
    [{ id: 'later', location: 'Market', items: ['Cheese'], times: ['21:35'] }, { id: 'same', location: 'Market', items: ['Cheese'], times: ['21:34'] }, { id: 'unknown', location: 'Market', items: [], times: [] }],
    [{ id: 'pending', draft: { ...draft, purchasedTime: '21:34' } }]
  ])
  const matches = await receiptUploadDuplicates(sql, { ...draft, purchasedTime: '21:34' }, id)
  assert.equal(matches[0].id, 'same')
  assert.equal(matches.find(match => match.id === 'pending').timeMatch, true)
  assert.equal(matches.find(match => match.id === 'later').timeMatch, false)
  assert.equal(matches.find(match => match.id === 'unknown').timeMatch, null)
})

test('draft saves use revisions and skipped uploads can be restored without deleting originals', async () => {
  const { sql, queries } = database([[{ revision: 3 }], [], [{ id }], [{ id }], []])
  assert.deepEqual(await saveUploadDraft(sql, id, draft, 2), { revision: 3 })
  assert.match(queries[0].query, /AND revision = \?/)
  await assert.rejects(saveUploadDraft(sql, id, draft, 2), { statusCode: 409 })
  assert.deepEqual(await setUploadDiscarded(sql, id, true), { id })
  assert.deepEqual(await setUploadDiscarded(sql, id, false), { id })
  assert.match(queries[3].query, /draft IS NULL OR draft = 'null'::jsonb THEN 'pending'/)
  await assert.rejects(setUploadDiscarded(sql, id, true), { statusCode: 409 })
  await assert.rejects(saveUploadDraft(sql, id, draft, 0), { statusCode: 400 })
  await assert.rejects(saveUploadDraft(sql, id, {}, 2), { statusCode: 400 })
})

test('approval validates currency, dates, line completeness and numeric storage bounds', () => {
  const approved = approvedReceipt(draft)
  assert.equal(approved.entries[0].price, 2)
  assert.equal(approved.entries[0].costPerUnit, 1)
  assert.equal(approved.draft.lines[0].brand, 'Brand')
  assert.throws(() => approvedReceipt({ ...draft, currency: 'USD' }), /Only EUR/)
  assert.throws(() => approvedReceipt({ ...draft, lines: [] }), /at least one/)
  assert.throws(() => approvedReceipt({ ...draft, purchasedOn: '2026-02-30' }), /valid purchase date/)
  for (const changes of [{ price: null }, { item: null }, { price: -1 }, { price: 1e10 }, { size: 1e9 }, { size: 0 }, { size: 0.0001 }, { price: 9999999999, size: 0.001 }]) {
    assert.throws(() => approvedReceipt({ ...draft, lines: [{ ...line, ...changes }] }))
  }
  for (const changes of [{ family: 'a'.repeat(101) }, { brand: 'a'.repeat(201) }, { variant: 'a'.repeat(201) }, { quantity: 0 }, { regularPrice: -1 }, { discount: -1 }]) {
    assert.throws(() => approvedReceipt({ ...draft, lines: [{ ...line, ...changes }] }))
  }
  assert.throws(() => approvedReceipt({ ...draft, lines: [line, { ...line, brand: 'Other brand' }] }), /distinct product names/)
  assert.throws(() => approvedReceipt({ ...draft, lines: [line, { ...line, variant: 'Other variant' }] }), /distinct product names/)
})

test('approval saves entries and provenance in one transaction and is repeat-safe', async () => {
  const { sql, queries } = database([[{ status: 'review', revision: 2 }], [], [], [], [], [{ name: 'Market' }], [{ id: '7' }], [{ id: '8' }], [], [], []])
  assert.deepEqual(await approveReceiptUpload(sql, id, draft, 2, true, false), { receiptId: '7', alreadySaved: false })
  assert.match(queries.at(-1).query, /entry_ids = \?/)
  assert.deepEqual(queries.at(-1).values[1], draft)
  assert.deepEqual(queries.at(-1).values[2], ['8'])
  const insert = queries.find(query => query.query.startsWith('INSERT INTO grocery_entries'))
  assert.match(insert.query, /product_family, brand, variant, raw_description/)
  assert.ok(insert.values.includes('Organic'))
  assert.ok(queries.some(query => query.query.startsWith('INSERT INTO grocery_item_aliases')))
  const repeated = database([[{ status: 'saved', receiptId: '7', revision: 3 }]])
  assert.deepEqual(await approveReceiptUpload(repeated.sql, id, draft, 2, true, true), { receiptId: '7', alreadySaved: true })
  assert.equal(repeated.queries.length, 1)
})

test('approval refuses stale edits, missing confirmation and duplicate receipts before inserting entries', async () => {
  await assert.rejects(approveReceiptUpload(database([]).sql, id, draft, 2, false, false), { statusCode: 400 })
  await assert.rejects(approveReceiptUpload(database([]).sql, id, draft, 0, true, false), { statusCode: 400 })
  await assert.rejects(approveReceiptUpload(database([]).sql, id, draft, 2, true, false), { statusCode: 404 })
  for (const upload of [{ status: 'pending', revision: 2 }, { status: 'review', revision: 3 }]) {
    await assert.rejects(approveReceiptUpload(database([[upload]]).sql, id, draft, 2, true, false), { statusCode: 409 })
  }
  const { sql, queries } = database([[{ status: 'review', revision: 2 }], [], [{ id: '1', location: 'Market', items: ['Cheese'] }], []])
  await assert.rejects(approveReceiptUpload(sql, id, draft, 2, true, false), /Possible duplicate/)
  assert.equal(queries.some(query => query.query.startsWith('INSERT')), false)
})

test('an existing product name cannot silently absorb a different known brand or variant', async () => {
  for (const known of [{ item: 'Cheese', brand: 'Other brand', variant: null }, { item: 'Cheese', brand: 'Brand', variant: 'Other variant' }]) {
    const { sql, queries } = database([[{ status: 'review', revision: 2 }], []], [known])
    await assert.rejects(approveReceiptUpload(sql, id, draft, 2, true, true), /different brand or variant/)
    assert.equal(queries.some(query => query.query.startsWith('INSERT')), false)
  }
})