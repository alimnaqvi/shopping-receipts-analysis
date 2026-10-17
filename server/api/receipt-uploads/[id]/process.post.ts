import { db } from '../../../utils/db'
import { createReceiptExtractor } from '../../../utils/receipt-provider'
import { extractReceiptUpload } from '../../../utils/receipt-upload-processing'
import { requireUploadId } from '../../../utils/receipt-upload-query'

export default defineEventHandler(async (event) => {
  const id = requireUploadId(getRouterParam(event, 'id'))
  return extractReceiptUpload(db(), id, createReceiptExtractor())
})