import { db } from '../../../utils/db'
import { readUploadBody } from '../../../utils/receipt-files'
import { createReceiptExtractor } from '../../../utils/receipt-provider'
import { refreshReceiptBatch } from '../../../utils/receipt-upload-processing'
import { uploadError } from '../../../utils/receipt-upload-query'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^batch_[a-zA-Z0-9_-]{1,100}$/.test(id)) throw uploadError(400, 'Invalid batch ID')
  const body = await readUploadBody(event.node.req)
  return refreshReceiptBatch(db(), id, createReceiptExtractor(), body.cancel === true)
})