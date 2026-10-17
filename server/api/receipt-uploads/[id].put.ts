import { db } from '../../utils/db'
import { readUploadBody } from '../../utils/receipt-files'
import { receiptUploadDuplicates, requireUploadId, saveUploadDraft, setUploadDiscarded, uploadError } from '../../utils/receipt-upload-query'
import type { ExtractedReceipt } from '../../../shared/types/receipt-upload'

export default defineEventHandler(async (event) => {
  const id = requireUploadId(getRouterParam(event, 'id'))
  const body = await readUploadBody(event.node.req)
  if (body.action === 'discard' || body.action === 'restore') return setUploadDiscarded(db(), id, body.action === 'discard')
  if (body.action !== 'save') throw uploadError(400, 'Unknown draft action')
  const sql = db()
  const result = await saveUploadDraft(sql, id, body.draft, Number(body.revision))
  return { ...result, duplicates: await receiptUploadDuplicates(sql, body.draft as ExtractedReceipt, id) }
})