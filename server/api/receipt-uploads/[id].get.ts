import { db } from '../../utils/db'
import { getUpload, receiptUploadDuplicates, requireUploadId } from '../../utils/receipt-upload-query'
import { reviewWarnings } from '../../../shared/utils/receipt-review'
import { itemCatalog, receiptItemCatalog } from '../../utils/product-catalog'
import { applyCatalog } from '../../../shared/utils/product-identity'

export default defineEventHandler(async (event) => {
  const sql = db()
  const { bytes: _bytes, ...upload } = await getUpload(sql, requireUploadId(getRouterParam(event, 'id')))
  const known = await itemCatalog(sql)
  const catalog = upload.draft ? await receiptItemCatalog(sql, upload.draft, known) : known
  if (upload.status === 'review' && upload.draft) upload.draft = applyCatalog(upload.draft, catalog, upload.extraction)
  return {
    upload,
    catalog,
    duplicates: upload.draft ? await receiptUploadDuplicates(sql, upload.draft, upload.id) : [],
    warnings: upload.draft ? reviewWarnings(upload.draft) : []
  }
})