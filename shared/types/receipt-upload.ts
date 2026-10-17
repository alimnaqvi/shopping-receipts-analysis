export type ExtractedLine = {
  rawDescription: string
  item: string | null
  category: string | null
  brand: string | null
  variant: string | null
  quantity: number | null
  size: number | null
  unit: string | null
  price: number | null
  regularPrice: number | null
  discount: number | null
  saleItem: boolean
  nonGrocery: boolean
  notes: string | null
  confidence: number | null
}

export type ExtractedReceipt = {
  purchasedOn: string | null
  location: string | null
  currency: string | null
  total: number | null
  receiptNumber: string | null
  warnings: string[]
  lines: ExtractedLine[]
}

export type ReceiptUploadStatus = 'pending' | 'processing' | 'batch' | 'review' | 'failed' | 'saved' | 'discarded'

export type ReceiptUpload = {
  id: string
  filename: string
  page: number
  mime: string
  status: ReceiptUploadStatus
  error: string | null
  model: string | null
  batchId: string | null
  receiptId: string | null
  extraction: ExtractedReceipt | null
  draft: ExtractedReceipt | null
  revision: number
  createdAt: string
}

export type ReceiptDuplicate = {
  id: string
  source: 'receipt' | 'upload'
  location: string
  similarity: number
  sameStore: boolean
}