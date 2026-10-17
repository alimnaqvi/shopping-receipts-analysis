import { createHash } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'

export const maxUploadBytes = 20 * 1024 * 1024
export const maxPdfPages = 50

export type ReceiptPage = { filename: string, page: number, mime: string, hash: string, bytes: Buffer }

export async function readUpload(stream: AsyncIterable<Uint8Array>, limit = maxUploadBytes) {
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of stream) {
    length += chunk.length
    if (length > limit) throw new Error(`Upload exceeds the ${limit} byte limit`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function readUploadBody(stream: AsyncIterable<Uint8Array>): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse((await readUpload(stream, 1024 * 1024)).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
    return value as Record<string, unknown>
  } catch {
    throw Object.assign(new Error('Expected a JSON object no larger than 1 MiB'), { statusCode: 400 })
  }
}

export async function splitReceiptFile(bytes: Buffer, filename: string): Promise<ReceiptPage[]> {
  if (!bytes.length || bytes.length > maxUploadBytes) throw new Error('Choose a non-empty file no larger than 20 MiB')
  const safeFilename = filename.replaceAll('\\', '/').split('/').pop()!.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) || 'receipt'
  const hash = createHash('sha256').update(bytes).digest('hex')
  const mime = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'image/jpeg'
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
      : bytes.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : null
  if (!mime) throw new Error('Only JPEG, PNG and PDF receipts are supported')
  if (mime !== 'application/pdf') return [{ filename: safeFilename, page: 1, mime, hash, bytes }]
  let source: PDFDocument
  try {
    source = await PDFDocument.load(bytes)
  } catch {
    throw new Error('The PDF is damaged or password-protected')
  }
  if (source.getPageCount() < 1 || source.getPageCount() > maxPdfPages) throw new Error('PDFs must contain between 1 and 50 pages')
  const pages: ReceiptPage[] = []
  for (let index = 0; index < source.getPageCount(); index++) {
    const document = await PDFDocument.create({ updateMetadata: false })
    const [page] = await document.copyPages(source, [index])
    document.addPage(page!)
    pages.push({ filename: safeFilename, page: index + 1, mime, hash: `${hash}:${index + 1}`, bytes: Buffer.from(await document.save()) })
  }
  return pages
}