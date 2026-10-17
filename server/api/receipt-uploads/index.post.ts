import { db } from '../../utils/db'
import { maxUploadBytes, readUpload, splitReceiptFile } from '../../utils/receipt-files'
import { storeReceiptPages, uploadError } from '../../utils/receipt-upload-query'

export default defineEventHandler(async (event) => {
  const length = Number(getHeader(event, 'content-length'))
  if (length > maxUploadBytes) throw uploadError(413, 'Files are limited to 20 MiB')
  let pages
  try {
    const bytes = await readUpload(event.node.req)
    const filename = decodeURIComponent(getHeader(event, 'x-receipt-filename') ?? 'receipt')
    pages = await splitReceiptFile(bytes, filename)
  } catch (error) {
    throw uploadError(400, error instanceof Error ? error.message : 'Invalid receipt file')
  }
  const uploads = await storeReceiptPages(db(), pages)
  setResponseStatus(event, 201)
  return { uploads }
})