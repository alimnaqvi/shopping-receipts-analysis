import type { ProductMetadata } from '../types/product.ts'
import { normalizedHistoricalPrice } from './normalized-price.ts'

export type FamilyPurchase = ProductMetadata & {
  id: string
  purchasedOn: string
  item: string
  location: string
  price: string | number
  size: string | number | null
  unit: string | null
  costPerUnit: string | number | null
  saleItem: boolean
}

export type FamilyPriceRow = {
  item: string
  brand: string | null
  variant: string | null
  basis: string
  basisLabel: string
  purchases: number
  totalSpent: number
  latest: FamilyPurchase
  latestNormalized: number | null
  lowestNormalized: number | null
  regularNormalized: number | null
}

export function familyPriceRows(entries: FamilyPurchase[]): FamilyPriceRow[] {
  const groups = new Map<string, FamilyPriceRow>()
  const ordered = [...entries].sort((first, second) => first.purchasedOn.localeCompare(second.purchasedOn) || first.id.localeCompare(second.id, undefined, { numeric: true }))
  for (const entry of ordered) {
    const paid = normalizedHistoricalPrice(entry.price, entry.size, entry.unit, entry.costPerUnit)
    const basis = paid?.basis ?? 'unknown'
    const key = JSON.stringify([entry.item, basis])
    const current = groups.get(key)
    const row: FamilyPriceRow = current ?? { item: entry.item, brand: null, variant: null, basis,
      basisLabel: paid?.label ?? 'Unknown size/unit', purchases: 0, totalSpent: 0, latest: entry,
      latestNormalized: null, lowestNormalized: null, regularNormalized: null }
    row.brand = entry.brand ?? row.brand
    row.variant = entry.variant ?? row.variant
    row.purchases++
    row.totalSpent = (Math.round(row.totalSpent * 100) + Math.round(Number(entry.price) * 100)) / 100
    row.latest = entry
    row.latestNormalized = paid?.value ?? null
    if (paid) row.lowestNormalized = Math.min(row.lowestNormalized ?? paid.value, paid.value)
    const regularPrice = entry.regularPrice ?? (entry.saleItem ? null : entry.price)
    const regular = regularPrice === null ? null : normalizedHistoricalPrice(regularPrice, entry.size, entry.unit, null)
    if (regular?.basis === basis) row.regularNormalized = regular.value
    groups.set(key, row)
  }
  return [...groups.values()].sort((first, second) => first.item.localeCompare(second.item) || first.basis.localeCompare(second.basis))
}