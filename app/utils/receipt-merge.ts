import { formatMoney } from '../../shared/utils/currency.ts'

export type ReceiptSaveSummary = {
  id: string
  purchasedOn: string
  location: string
  itemCount: number
  total: string
}

export type AutosaveReceiptLine = {
  item: string
  price: string
  size: string
  unit: string
  saleItem: boolean
  nonGrocery: boolean
  notes: string
  productFamily?: string | null
  brand?: string
  variant?: string
  quantity?: string
  regularPrice?: string
  discount?: string
  rawDescription?: string
  purchasedTime?: string
}

function items(count: number) {
  return `${count} ${count === 1 ? 'item' : 'items'}`
}

export function addedReceiptMessage(submittedCount: number, saved: ReceiptSaveSummary) {
  if (saved.itemCount > submittedCount) {
    return `Added ${items(submittedCount)} to the ${saved.location} receipt · ${items(saved.itemCount)} total · ${formatMoney(saved.total)}`
  }
  return `${items(submittedCount)} saved · ${formatMoney(saved.total)}`
}

export function receiptLineIsComplete(line: AutosaveReceiptLine) {
  const price = Number(line.price)
  const size = Number(line.size)
  const validSize = line.size === '' || (Number.isFinite(size) && size > 0)
  const quantity = Number(line.quantity)
  const validQuantity = !line.quantity || (Number.isFinite(quantity) && quantity > 0)
  const regularPrice = Number(line.regularPrice)
  const validRegularPrice = !line.regularPrice || (Number.isFinite(regularPrice) && regularPrice >= 0)
  const discount = Number(line.discount)
  const validDiscount = !line.discount || (Number.isFinite(discount) && discount >= 0)
  return Boolean(line.item.trim())
    && line.price !== ''
    && Number.isFinite(price)
    && price >= 0
    && validSize
    && validQuantity
    && validRegularPrice
    && validDiscount
}

export function shouldLoadMatchingReceipt(currentReceiptId: string | null, enteredLineCount: number) {
  return !currentReceiptId && enteredLineCount === 0
}

export function receiptLineSaveSnapshot(
  purchasedOn: string,
  location: string,
  line: AutosaveReceiptLine
) {
  return JSON.stringify({
    purchasedOn,
    location,
    item: line.item,
    price: line.price,
    size: line.size,
    unit: line.unit,
    saleItem: line.saleItem,
    nonGrocery: line.nonGrocery,
    notes: line.notes,
    ...(line.productFamily === undefined ? {} : { productFamily: line.productFamily || null }),
    ...(line.brand === undefined ? {} : { brand: line.brand.trim() }),
    ...(line.variant === undefined ? {} : { variant: line.variant.trim() }),
    ...(line.quantity === undefined ? {} : { quantity: line.quantity.trim() }),
    ...(line.regularPrice === undefined ? {} : { regularPrice: line.regularPrice.trim() }),
    ...(line.discount === undefined ? {} : { discount: line.discount.trim() }),
    ...(line.rawDescription === undefined ? {} : { rawDescription: line.rawDescription.trim() }),
    ...(line.purchasedTime === undefined ? {} : { purchasedTime: line.purchasedTime.trim() })
  })
}

