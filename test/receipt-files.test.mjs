import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PDFDocument } from 'pdf-lib'
import { maxUploadBytes, readUpload, readUploadBody, splitReceiptFile } from '../server/utils/receipt-files.ts'

test('reads bounded streams and rejects oversized bodies before collecting everything', async () => {
  assert.equal((await readUpload([Buffer.from('image')])).toString(), 'image')
  assert.equal((await readUpload([])).length, 0)
  await assert.rejects(readUpload([Buffer.from('123'), Buffer.from('456')], 5), /byte limit/)
  assert.deepEqual(await readUploadBody([Buffer.from('{"action":"save"}')]), { action: 'save' })
  for (const body of ['null', '[]', 'invalid', '"text"', 'a'.repeat(1024 * 1024 + 1)]) {
    await assert.rejects(readUploadBody([Buffer.from(body)]), { statusCode: 400 })
  }
})

test('validates signatures and preserves image bytes with a stable hash and safe filename', async () => {
  for (const signature of [[255, 216, 255], [137, 80, 78, 71, 13, 10, 26, 10]]) {
    const bytes = Buffer.from(signature)
    const [page] = await splitReceiptFile(bytes, '../folder\\receipt.jpg')
    assert.equal(page.filename, 'receipt.jpg')
    assert.equal(page.page, 1)
    assert.equal(page.bytes, bytes)
    assert.equal((await splitReceiptFile(bytes, 'again'))[0].hash, page.hash)
    assert.match(page.mime, /^image\//)
  }
  assert.equal((await splitReceiptFile(Buffer.from([255, 216, 255]), '\x00'))[0].filename, 'receipt')
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(maxUploadBytes + 1), Buffer.from('<script>'), Buffer.from('%PDF-invalid')]) {
    await assert.rejects(splitReceiptFile(bytes, 'receipt.pdf'))
  }
})

test('splits a PDF into native one-page documents, with stable source-page identity', async () => {
  const document = await PDFDocument.create()
  document.addPage([300, 600])
  document.addPage([400, 700])
  const bytes = Buffer.from(await document.save())
  const pages = await splitReceiptFile(bytes, 'scan.pdf')
  assert.equal(pages.length, 2)
  assert.notEqual(pages[0].hash, pages[1].hash)
  assert.equal((await splitReceiptFile(bytes, 'renamed.pdf'))[0].hash, pages[0].hash)
  for (const [index, page] of pages.entries()) {
    const result = await PDFDocument.load(page.bytes)
    assert.equal(result.getPageCount(), 1)
    assert.equal(result.getPage(0).getWidth(), index ? 400 : 300)
    assert.equal(page.page, index + 1)
  }
  for (let index = 2; index < 51; index++) document.addPage()
  await assert.rejects(splitReceiptFile(Buffer.from(await document.save()), 'large.pdf'), /50 pages/)
})