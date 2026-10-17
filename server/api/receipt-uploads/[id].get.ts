import { db } from '../../utils/db'
import { getUpload, receiptUploadDuplicates, requireUploadId } from '../../utils/receipt-upload-query'
import { reviewWarnings } from '../../../shared/utils/receipt-review'

export default defineEventHandler(async (event) => {
  const sql = db()
  const { bytes: _bytes, ...upload } = await getUpload(sql, requireUploadId(getRouterParam(event, 'id')))
  return {
    upload,
    duplicates: upload.draft ? await receiptUploadDuplicates(sql, upload.draft, upload.id) : [],
    warnings: upload.draft ? reviewWarnings(upload.draft) : []
  }
})