import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createReceiptExtractor, extractionRequest, extractionResponse } from '../server/utils/receipt-provider.ts'

const receipt = { purchasedOn: null, location: null, currency: 'EUR', total: null, receiptNumber: null, warnings: [], lines: [] }
const output = { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(receipt) }] }] }
const input = { id: 'one', filename: 'scan.jpg', mime: 'image/jpeg', bytes: Buffer.from('image') }
const env = { OPENAI_API_KEY: 'test-only', OPENAI_BASE_URL: 'https://provider.test/v1/' }

function fakeFetch(responses) {
  const calls = []
  const fetcher = async (url, init) => {
    calls.push({ url, ...init })
    const response = responses.shift()
    if (response instanceof Error) throw response
    return new Response(typeof response === 'string' ? response : JSON.stringify(response), { status: response?.httpStatus ?? 200 })
  }
  return { fetcher, calls }
}

test('provider is explicit and server-configured; image and PDF inputs use native multimodal ingestion', async () => {
  assert.throws(() => createReceiptExtractor({}), /OPENAI_API_KEY/)
  assert.throws(() => createReceiptExtractor({ RECEIPT_AI_PROVIDER: 'google' }), /Only the openai/)
  const { fetcher, calls } = fakeFetch([output])
  const provider = createReceiptExtractor(env, fetcher)
  assert.equal(provider.model, 'gpt-6-luna')
  assert.deepEqual(await provider.extract(input, ['Dairy']), receipt)
  assert.equal(calls[0].url, 'https://provider.test/v1/responses')
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer test-only')
  const body = JSON.parse(calls[0].body)
  assert.equal(body.store, false)
  assert.equal(body.text.format.strict, true)
  assert.equal(body.input[0].content[1].type, 'input_image')
  assert.match(body.input[0].content[0].text, /Dairy/)
  const pdf = extractionRequest({ ...input, mime: 'application/pdf' }, 'custom-model', [])
  assert.equal(pdf.model, 'custom-model')
  assert.match(pdf.input[0].content[1].file_data, /^data:application\/pdf;base64,/)
  assert.equal(pdf.input[0].content[1].type, 'input_file')
  assert.equal(createReceiptExtractor({ ...env, RECEIPT_AI_MODEL: 'custom-model' }, fetcher).model, 'custom-model')
})

test('refusals, incomplete output, invalid JSON and API errors never become receipt drafts', async () => {
  for (const value of [null, {}, { status: 'incomplete' }, { status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }, { status: 'completed', output: [{}] }, { status: 'completed', output: [{ content: [{ type: 'reasoning' }, { type: 'output_text' }] }] }, { status: 'completed', output: [{ content: [{ type: 'output_text', text: '{}' }] }] }]) {
    assert.throws(() => extractionResponse(value))
  }
  const { fetcher } = fakeFetch([{ httpStatus: 429, secret: 'must not leak' }])
  await assert.rejects(createReceiptExtractor(env, fetcher).extract(input, []), { message: 'Receipt provider request failed (HTTP 429)' })
})

test('submits independent requests with stable IDs and a 24h completion window', async () => {
  const { fetcher, calls } = fakeFetch([{ id: 'file-1' }, { id: 'batch-1' }])
  const provider = createReceiptExtractor(env, fetcher)
  assert.equal(await provider.submitBatch([input, { ...input, id: 'two' }], []), 'batch-1')
  const rows = (await calls[0].body.get('file').text()).split('\n').map(JSON.parse)
  assert.deepEqual(rows.map(row => row.custom_id), ['one', 'two'])
  assert.equal(rows[0].url, '/v1/responses')
  assert.equal(JSON.parse(calls[1].body).completion_window, '24h')
  await assert.rejects(provider.submitBatch([], []), /between 1 and 100/)
  await assert.rejects(provider.submitBatch(Array(101).fill(input), []), /between 1 and 100/)
  await assert.rejects(provider.submitBatch([{ ...input, bytes: Buffer.alloc(76 * 1024 * 1024) }], []), /100 MiB/)
})

test('cleans up batch input when submission fails, even if cleanup fails too', async () => {
  for (const cleanup of [{}, new Error('offline')]) {
    const { fetcher, calls } = fakeFetch([{ id: 'file-1' }, {}, cleanup])
    await assert.rejects(createReceiptExtractor(env, fetcher).submitBatch([input], []), /batch ID/)
    assert.equal(calls[2].method, 'DELETE')
  }
})

test('maps out-of-order batch successes and per-receipt failures, including partial expired batches', async () => {
  const rows = [
    { custom_id: 'two', response: { status_code: 200, body: output } },
    { custom_id: 'one', error: { code: 'batch_expired' } },
    { custom_id: 'three', response: { status_code: 200, body: {} } }
  ]
  const { fetcher, calls } = fakeFetch([
    { status: 'in_progress' },
    { status: 'expired', output_file_id: 'out', error_file_id: 'err' },
    JSON.stringify(rows[0]) + '\n', rows.slice(1).map(JSON.stringify).join('\n'),
    { status: 'failed' }, {}
  ])
  const provider = createReceiptExtractor(env, fetcher)
  assert.deepEqual(await provider.pollBatch('batch-1'), { status: 'in_progress', terminal: false, results: [] })
  const result = await provider.pollBatch('batch-1')
  assert.equal(result.terminal, true)
  assert.deepEqual(result.results[0], { id: 'two', extraction: receipt })
  assert.match(result.results[1].error, /failed/)
  assert.match(result.results[2].error, /incomplete/)
  assert.equal((await provider.pollBatch('batch-2')).terminal, true)
  await provider.cancelBatch('batch-1')
  assert.match(calls.at(-1).url, /batch-1\/cancel$/)
})