import { db } from '../../../utils/db'
import { readUploadBody } from '../../../utils/receipt-files'
import { approveReceiptUpload, requireUploadId } from '../../../utils/receipt-upload-query'

export default defineEventHandler(async (event) => {
  const id = requireUploadId(getRouterParam(event, 'id'))
  const body = await readUploadBody(event.node.req)
  return approveReceiptUpload(db(), id, body.draft, Number(body.revision), body.reviewed === true, body.allowDuplicates === true)
})