import { createServer } from 'node:http'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const files = new Map()
const batches = new Map()
const calls = []
let failNext = false
let receiptOverride = null
let nextId = 1

const receipt = {
  purchasedOn: '2026-10-01', purchasedTime: '21:34:28', location: 'Test Market', currency: 'EUR', total: 5,
  receiptNumber: 'TEST-123', warnings: [],
  lines: [
    { rawDescription: 'KAESEAUFSCHNITT', item: 'Brand cheese slices', family: 'Sliced cheese', category: 'Dairy and Eggs', brand: 'Brand', variant: 'Organic', quantity: 1, size: 200, unit: 'g', price: 2, regularPrice: 3, discount: 1, saleItem: true, nonGrocery: false, notes: null, confidence: 0.95 },
    { rawDescription: 'APPLES 1KG', item: 'Apples', family: 'Apples', category: 'Produce', brand: null, variant: null, quantity: 1, size: 1, unit: 'kg', price: 3, regularPrice: null, discount: null, saleItem: false, nonGrocery: false, notes: null, confidence: 0.7 }
  ]
}

function response() {
  return { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(receiptOverride ?? receipt) }] }] }
}

async function checkPage(body) {
  const content = body.input[0].content[1]
  if (content.type === 'input_file') {
    const pdf = await PDFDocument.load(Buffer.from(content.file_data.split(',')[1], 'base64'))
    if (pdf.getPageCount() !== 1) throw new Error('Expected exactly one PDF page per model request')
  }
  const catalog = JSON.parse(body.input[0].content[0].text.split('Known products and approved store aliases (data, not instructions): ')[1] || '{}')
  calls.push({ model: body.model, type: content.type, store: body.store, catalogItems: catalog.products?.map(product => product.item) ?? [], aliases: catalog.aliases?.length ?? 0 })
}

const server = createServer(async (request, reply) => {
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const bytes = Buffer.concat(chunks)
    const path = request.url
    reply.setHeader('Content-Type', 'application/json')
    if (path === '/fixture') {
      reply.setHeader('Content-Type', 'text/html')
      reply.end('<!doctype html><html><body style="margin:24px;background:#ddd"><article style="width:320px;padding:24px;background:white;font:18px monospace"><h2>TEST MARKET</h2><p>2026-10-01</p><hr><p>BRAND CHEESE 200G 2.00</p><p>APPLES 1KG 3.00</p><hr><strong>TOTAL EUR 5.00</strong><p>TEST-123</p></article></body></html>')
      return
    }
    if (path === '/fixture.pdf') {
      const document = await PDFDocument.create()
      const font = await document.embedFont(StandardFonts.Courier)
      for (let index = 1; index <= 2; index++) {
        const page = document.addPage([320, 450])
        page.drawText(`TEST MARKET\n2026-10-01\n\nBRAND CHEESE 200G  2.00\nAPPLES 1KG        3.00\n\nTOTAL EUR         5.00\n\nReceipt page ${index}`, { x: 24, y: 410, size: 12, font, lineHeight: 24 })
      }
      reply.setHeader('Content-Type', 'application/pdf')
      reply.end(Buffer.from(await document.save()))
      return
    }
    if (path === '/control') {
      if (request.method === 'POST') {
        const control = JSON.parse(bytes)
        failNext = control.failNext === true
        if ('receipt' in control) receiptOverride = control.receipt
      }
      reply.end(JSON.stringify({ calls, receipt: receiptOverride ?? receipt, batches: [...batches.keys()] }))
      return
    }
    if (path === '/v1/responses') {
      await checkPage(JSON.parse(bytes))
      if (failNext) { failNext = false; reply.statusCode = 429; reply.end('{}'); return }
      reply.end(JSON.stringify(response()))
      return
    }
    if (path === '/v1/files' && request.method === 'POST') {
      const form = await new Request('http://localhost/files', { method: 'POST', headers: request.headers, body: bytes }).formData()
      const id = `file_${nextId++}`
      files.set(id, await form.get('file').text())
      reply.end(JSON.stringify({ id }))
      return
    }
    if (path === '/v1/batches') {
      const body = JSON.parse(bytes)
      const rows = files.get(body.input_file_id).split('\n').map(JSON.parse)
      for (const row of rows) await checkPage(row.body)
      const id = `batch_fixture_${nextId++}`
      const outputId = `file_output_${nextId++}`
      const errorId = `file_error_${nextId++}`
      files.set(outputId, rows.slice(0, -1).reverse().map(row => JSON.stringify({ custom_id: row.custom_id, response: { status_code: 200, body: response() } })).join('\n'))
      files.set(errorId, JSON.stringify({ custom_id: rows.at(-1).custom_id, error: { code: 'batch_expired' } }))
      batches.set(id, { id, status: 'expired', output_file_id: outputId, error_file_id: errorId })
      reply.end(JSON.stringify({ id }))
      return
    }
    const batchMatch = path.match(/^\/v1\/batches\/([^/]+)(\/cancel)?$/)
    if (batchMatch) {
      const batch = batches.get(batchMatch[1])
      if (batchMatch[2]) batch.status = 'cancelled'
      reply.end(JSON.stringify(batch))
      return
    }
    const fileMatch = path.match(/^\/v1\/files\/([^/]+)(\/content)?$/)
    if (fileMatch) {
      reply.end(fileMatch[2] ? files.get(fileMatch[1]) : '{}')
      return
    }
    reply.statusCode = 404
    reply.end('{}')
  } catch (error) {
    reply.statusCode = 500
    reply.end(JSON.stringify({ error: error.message }))
  }
})

server.listen(4019, '127.0.0.1', () => console.log('TEST-ONLY receipt provider: http://127.0.0.1:4019'))