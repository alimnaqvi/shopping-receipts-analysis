import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createReceiptObjectStore, receiptStorageKey } from '../server/utils/receipt-storage.ts'

const baseEnv = {
  AWS_ENDPOINT_URL_S3: 'https://br-test.storage.c-1.eu-central-1.aws.neon.tech/',
  AWS_ACCESS_KEY_ID: 'nak_live_test_key',
  AWS_SECRET_ACCESS_KEY: 'nsk_live_test_secret'
}
const fixedNow = () => new Date('2026-10-18T14:00:00.000Z')

test('derives receipt storage keys from upload ID and MIME type', () => {
  assert.equal(receiptStorageKey('id-1', 'image/jpeg'), 'receipts/id-1.jpg')
  assert.equal(receiptStorageKey('id-2', 'image/png'), 'receipts/id-2.png')
  assert.equal(receiptStorageKey('id-3', 'application/pdf'), 'receipts/id-3.pdf')
})

test('returns null when unconfigured and validates partial or invalid S3 settings', () => {
  assert.equal(createReceiptObjectStore({}), null)
  assert.throws(() => createReceiptObjectStore({ AWS_ENDPOINT_URL_S3: baseEnv.AWS_ENDPOINT_URL_S3 }), /Set AWS_ENDPOINT_URL_S3/)
  assert.throws(() => createReceiptObjectStore({ RECEIPT_STORAGE_BUCKET: 'receipt-uploads' }), /Set AWS_ENDPOINT_URL_S3/)
  assert.throws(() => createReceiptObjectStore({ ...baseEnv, AWS_ENDPOINT_URL_S3: 'not-a-url' }), /valid HTTP or HTTPS URL/)
  assert.throws(() => createReceiptObjectStore({ ...baseEnv, AWS_ENDPOINT_URL_S3: 'ftp://example.com' }), /must use HTTP or HTTPS/)
  assert.throws(() => createReceiptObjectStore({ ...baseEnv, RECEIPT_STORAGE_BUCKET: 'Invalid_Bucket!' }), /valid S3 bucket name/)
})

test('signs path-style S3 PUT, GET and DELETE requests and infers Neon region', async () => {
  const calls = []
  const store = createReceiptObjectStore(baseEnv, async (url, init) => {
    calls.push({ url, init })
    if (init?.method === 'GET') return new Response(Buffer.from('pdf-bytes'), { status: 200 })
    return new Response(null, { status: 200 })
  }, fixedNow)

  assert.equal(store?.bucket, 'receipt-uploads')
  await store.put('receipts/abc.pdf', Buffer.from('pdf-bytes'), 'application/pdf')
  const downloaded = await store.get('receipts/abc.pdf')
  assert.equal(downloaded.toString(), 'pdf-bytes')
  await store.delete(['receipts/abc.pdf', 'receipts/abc.pdf', ''])

  assert.equal(calls.length, 3)
  assert.equal(calls[0].url, 'https://br-test.storage.c-1.eu-central-1.aws.neon.tech/receipt-uploads/receipts/abc.pdf')
  assert.equal(calls[0].init.method, 'PUT')
  assert.equal(calls[0].init.headers['Content-Type'], 'application/pdf')
  assert.equal(calls[0].init.headers['x-amz-date'], '20261018T140000Z')
  assert.match(calls[0].init.headers.Authorization, /Credential=nak_live_test_key\/20261018\/eu-central-1\/s3\/aws4_request/)
  assert.match(calls[0].init.headers.Authorization, /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date/)
  assert.equal(calls[1].init.method, 'GET')
  assert.equal(calls[2].init.method, 'DELETE')
})

test('provisions missing bucket automatically on 404 during upload and surfaces upload, download and delete errors', async () => {
  const methods = []
  let putAttempts = 0
  const store = createReceiptObjectStore(
    { ...baseEnv, AWS_ENDPOINT_URL_S3: 'https://s3.example.com', RECEIPT_STORAGE_BUCKET: 'custom-bucket' },
    async (url, init) => {
      methods.push(`${init?.method} ${new URL(url).pathname}`)
      if (init?.method === 'PUT' && new URL(url).pathname.endsWith('/file.jpg')) {
        putAttempts += 1
        return new Response(null, { status: putAttempts === 1 ? 404 : 200 })
      }
      return new Response(null, { status: 409 })
    },
    fixedNow
  )
  await store.put('receipts/file.jpg', Buffer.from('jpg'), 'image/jpeg')
  assert.deepEqual(methods, [
    'PUT /custom-bucket/receipts/file.jpg',
    'PUT /custom-bucket',
    'PUT /custom-bucket/receipts/file.jpg'
  ])

  await assert.rejects(() => store.put('/', Buffer.from('jpg'), 'image/jpeg'), /key must not be empty/)

  const failingCreate = createReceiptObjectStore(baseEnv, async () => new Response(null, { status: 404 }), fixedNow)
  await assert.rejects(() => failingCreate.put('receipts/a.jpg', Buffer.from('a'), 'image/jpeg'), /bucket creation failed \(HTTP 404\)/)

  const failingPut = createReceiptObjectStore(baseEnv, async () => new Response(null, { status: 500 }), fixedNow)
  await assert.rejects(() => failingPut.put('receipts/a.jpg', Buffer.from('a'), 'image/jpeg'), /upload failed \(HTTP 500\)/)
  await assert.rejects(() => failingPut.get('receipts/a.jpg'), /download failed \(HTTP 500\)/)
  await assert.rejects(() => failingPut.delete(['receipts/a.jpg']), /delete failed \(HTTP 500\)/)

  const notFoundStore = createReceiptObjectStore(baseEnv, async () => new Response(null, { status: 404 }))
  await assert.rejects(() => notFoundStore.get('receipts/missing.jpg'), { statusCode: 404 })
  await notFoundStore.delete(['receipts/missing.jpg'])
})
