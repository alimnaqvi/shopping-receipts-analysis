import { db } from '../../utils/db'
import { listReceiptUploads, uploadError } from '../../utils/receipt-upload-query'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const offset = Number(query.offset ?? 0)
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw uploadError(400, 'Invalid queue offset')
  return {
    ...await listReceiptUploads(db(), offset, query.archived === 'true'),
    configured: Boolean(process.env.OPENAI_API_KEY?.trim()) && (process.env.RECEIPT_AI_PROVIDER || 'openai') === 'openai',
    model: process.env.RECEIPT_AI_MODEL?.trim() || 'gpt-6-luna'
  }
})