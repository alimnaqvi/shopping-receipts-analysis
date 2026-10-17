import { db } from '../../utils/db'
import { readUploadBody } from '../../utils/receipt-files'
import { createReceiptExtractor } from '../../utils/receipt-provider'
import { submitReceiptBatch } from '../../utils/receipt-upload-processing'
import { requireUploadId, uploadError } from '../../utils/receipt-upload-query'

export default defineEventHandler(async (event) => {
  const body = await readUploadBody(event.node.req)
  if (!Array.isArray(body.ids)) throw uploadError(400, 'Select pending receipts')
  const ids = body.ids.map(requireUploadId)
  return submitReceiptBatch(db(), ids, createReceiptExtractor())
})