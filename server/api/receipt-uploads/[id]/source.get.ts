import { db } from '../../../utils/db'
import { getUpload, requireUploadId } from '../../../utils/receipt-upload-query'

export default defineEventHandler(async (event) => {
  const upload = await getUpload(db(), requireUploadId(getRouterParam(event, 'id')), true)
  setHeader(event, 'Content-Type', upload.mime)
  setHeader(event, 'Content-Disposition', `inline; filename="receipt.${upload.mime === 'application/pdf' ? 'pdf' : upload.mime === 'image/png' ? 'png' : 'jpg'}"`)
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Content-Security-Policy', "sandbox; default-src 'none'")
  return upload.bytes
})