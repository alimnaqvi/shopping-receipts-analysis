import { normalizeUnit } from '../../shared/utils/units.ts'
import { normalizeStoreName } from '../../shared/utils/store-name.ts'
import { normalizeCategory } from '../../shared/utils/category.ts'
import { maxEntryNotesLength } from '../../shared/utils/entry-notes.ts'
import { receiptMinute } from '../../shared/utils/product-identity.ts'

export type EntryInput = {
  purchasedOn: string
  item: string
  location: string
  size: number | null
  unit: string | null
  price: number
  costPerUnit: number | null
  saleItem: boolean
  nonGrocery: boolean
  notes: string | null
  category?: string | null
  productFamily?: string | null
  brand?: string | null
  variant?: string | null
  quantity?: number | null
  regularPrice?: number | null
  discount?: number | null
  rawDescription?: string | null
  purchasedTime?: string | null
}

function optionalNumber(value: unknown) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function optionalBoundedNumber(value: unknown, min: number, inclusive: boolean, message: string): number | null | undefined {
  if (value === undefined) return undefined
  if (value === '' || value === null) return null
  const number = Number(value)
  if (!Number.isFinite(number) || (inclusive ? number < min : number <= min)) {
    throw createError({ statusCode: 400, statusMessage: message })
  }
  return number
}

function optionalBoundedText(value: unknown, maxLength: number, label: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw createError({ statusCode: 400, statusMessage: `${label} must be text` })
  const trimmed = value.trim()
  if (trimmed.length > maxLength) {
    throw createError({ statusCode: 400, statusMessage: `${label} must be ${maxLength} characters or fewer` })
  }
  return trimmed || null
}

function truthy(value: unknown) {
  if (typeof value === 'boolean') return value
  return ['1', 'true', 'yes', 'y', 'x'].includes(String(value ?? '').trim().toLowerCase())
}

function isCalendarDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

export function normalizeEntry(input: Record<string, unknown>): EntryInput {
  const rawDate = input.purchasedOn ?? input.food_Date ?? input.date ?? ''
  const purchasedOn = rawDate instanceof Date
    ? rawDate.toISOString().slice(0, 10)
    : String(rawDate).slice(0, 10)
  const item = String(input.item ?? input.Item ?? '').trim()
  const location = normalizeStoreName(input.location ?? input.Location)
  const price = Number(input.price ?? input.Price)
  const size = optionalNumber(input.size ?? input.Size)
  const unit = normalizeUnit(input.unit ?? input.Unit)
  const costPerUnit = size && price >= 0
    ? ['g', 'mL'].includes(unit || '')
      ? (price / size) * 100
      : price / size
    : null

  if (!isCalendarDate(purchasedOn)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid purchase date is required' })
  }
  if (!item) throw createError({ statusCode: 400, statusMessage: 'Item is required' })
  if (!location) throw createError({ statusCode: 400, statusMessage: 'Store is required' })
  if (!Number.isFinite(price) || price < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Price must be zero or greater' })
  }
  if (size !== null && size <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Size must be greater than zero' })
  }
  const notes = String(input.notes ?? input.Notes ?? '').trim()
  if (notes.length > maxEntryNotesLength) {
    throw createError({ statusCode: 400, statusMessage: `Notes must be ${maxEntryNotesLength} characters or fewer` })
  }

  let category: string | null | undefined
  try {
    category = normalizeCategory(input.category)
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Invalid category' })
  }

  const rawFamily = input.productFamily !== undefined ? input.productFamily : input.family
  const productFamily = optionalBoundedText(rawFamily, 100, 'Product family')
  const brand = optionalBoundedText(input.brand, 200, 'Brand')
  const variant = optionalBoundedText(input.variant, 200, 'Variant')
  const rawDescription = optionalBoundedText(input.rawDescription, 2000, 'Receipt text')
  const quantity = optionalBoundedNumber(input.quantity, 0, false, 'Quantity must be greater than zero')
  const regularPrice = optionalBoundedNumber(input.regularPrice, 0, true, 'Regular price must be zero or greater')
  const discount = optionalBoundedNumber(input.discount, 0, true, 'Discount must be zero or greater')

  let purchasedTime: string | null | undefined
  if (input.purchasedTime !== undefined) {
    try {
      purchasedTime = input.purchasedTime === '' ? null : receiptMinute(input.purchasedTime)
    } catch (error) {
      throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Invalid receipt time' })
    }
  }

  return {
    purchasedOn,
    item,
    location,
    size,
    unit,
    price,
    costPerUnit,
    saleItem: truthy(input.saleItem ?? input.Sale_Item),
    nonGrocery: truthy(input.nonGrocery ?? input.Non_Grocery),
    notes: notes || null,
    ...(category === undefined ? {} : { category }),
    ...(productFamily === undefined ? {} : { productFamily }),
    ...(brand === undefined ? {} : { brand }),
    ...(variant === undefined ? {} : { variant }),
    ...(quantity === undefined ? {} : { quantity }),
    ...(regularPrice === undefined ? {} : { regularPrice }),
    ...(discount === undefined ? {} : { discount }),
    ...(rawDescription === undefined ? {} : { rawDescription }),
    ...(purchasedTime === undefined ? {} : { purchasedTime })
  }
}
