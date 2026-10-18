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
  stores: string[]
  latest: FamilyPurchase
  latestNormalized: number | null
  averageNormalized: number | null
  lowestNormalized: number | null
  highestNormalized: number | null
  regularNormalized: number | null
  diffFromCheapestPercent: number | null
}

export type FamilyTrendPoint = FamilyPurchase & {
  basis: string
  basisLabel: string
  normalizedPrice: number
}

export type FamilyTrendSummary = {
  basis: string
  basisLabel: string
  pointCount: number
  variantCount: number
  latestPoint: FamilyTrendPoint
  lowestNormalized: number
  highestNormalized: number
  averageNormalized: number
  netChangePercent: number | null
  spreadPercent: number | null
  points: FamilyTrendPoint[]
}

export function familyPriceRows(entries: FamilyPurchase[]): FamilyPriceRow[] {
  const groups = new Map<string, FamilyPriceRow & { normalizedSum: number, normalizedCount: number, storeSet: Set<string> }>()
  const ordered = [...entries].sort((first, second) => first.purchasedOn.localeCompare(second.purchasedOn) || first.id.localeCompare(second.id, undefined, { numeric: true }))
  for (const entry of ordered) {
    const paid = normalizedHistoricalPrice(entry.price, entry.size, entry.unit, entry.costPerUnit)
    const basis = paid?.basis ?? 'unknown'
    const key = JSON.stringify([entry.item, basis])
    const current = groups.get(key)
    const row = current ?? {
      item: entry.item,
      brand: null,
      variant: null,
      basis,
      basisLabel: paid?.label ?? 'Unknown size/unit',
      purchases: 0,
      totalSpent: 0,
      stores: [],
      latest: entry,
      latestNormalized: null,
      averageNormalized: null,
      lowestNormalized: null,
      highestNormalized: null,
      regularNormalized: null,
      diffFromCheapestPercent: null,
      normalizedSum: 0,
      normalizedCount: 0,
      storeSet: new Set<string>()
    }
    row.brand = entry.brand ?? row.brand
    row.variant = entry.variant ?? row.variant
    row.purchases++
    row.totalSpent = (Math.round(row.totalSpent * 100) + Math.round(Number(entry.price) * 100)) / 100
    if (entry.location) row.storeSet.add(entry.location)
    row.stores = [...row.storeSet]
    row.latest = entry
    row.latestNormalized = paid?.value ?? null
    if (paid) {
      row.normalizedSum += paid.value
      row.normalizedCount += 1
      row.averageNormalized = Number((row.normalizedSum / row.normalizedCount).toFixed(4))
      row.lowestNormalized = Math.min(row.lowestNormalized ?? paid.value, paid.value)
      row.highestNormalized = Math.max(row.highestNormalized ?? paid.value, paid.value)
    }
    const regularPrice = entry.regularPrice ?? (entry.saleItem ? null : entry.price)
    const regular = regularPrice === null ? null : normalizedHistoricalPrice(regularPrice, entry.size, entry.unit, null)
    if (regular?.basis === basis) row.regularNormalized = regular.value
    groups.set(key, row)
  }

  const cheapestByBasis = new Map<string, number>()
  for (const row of groups.values()) {
    if (row.basis === 'unknown' || row.latestNormalized === null || row.latestNormalized <= 0) continue
    const currentMin = cheapestByBasis.get(row.basis)
    if (currentMin === undefined || row.latestNormalized < currentMin) {
      cheapestByBasis.set(row.basis, row.latestNormalized)
    }
  }

  return [...groups.values()].map(({ normalizedSum: _sum, normalizedCount: _count, storeSet: _stores, ...row }) => {
    const cheapest = cheapestByBasis.get(row.basis)
    const diffFromCheapestPercent = cheapest !== undefined && row.latestNormalized !== null && cheapest > 0
      ? Number((((row.latestNormalized - cheapest) / cheapest) * 100).toFixed(1))
      : null
    return {
      ...row,
      diffFromCheapestPercent
    }
  }).sort((first, second) => first.item.localeCompare(second.item) || first.basis.localeCompare(second.basis))
}

export function familyTrendSeries(entries: FamilyPurchase[]): FamilyTrendSummary[] {
  const ordered = [...entries].sort((first, second) => first.purchasedOn.localeCompare(second.purchasedOn) || first.id.localeCompare(second.id, undefined, { numeric: true }))
  const byBasis = new Map<string, FamilyTrendPoint[]>()
  for (const entry of ordered) {
    const paid = normalizedHistoricalPrice(entry.price, entry.size, entry.unit, entry.costPerUnit)
    if (!paid) continue
    const point: FamilyTrendPoint = {
      ...entry,
      basis: paid.basis,
      basisLabel: paid.label,
      normalizedPrice: Number(paid.value.toFixed(4))
    }
    const list = byBasis.get(paid.basis)
    if (list) list.push(point)
    else byBasis.set(paid.basis, [point])
  }

  return [...byBasis.entries()].map(([basis, points]) => {
    const values = points.map(point => point.normalizedPrice)
    const lowestNormalized = Math.min(...values)
    const highestNormalized = Math.max(...values)
    const averageNormalized = Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4))
    const first = points[0]!
    const latestPoint = points.at(-1)!
    const netChangePercent = points.length >= 2 && first.normalizedPrice > 0
      ? Number((((latestPoint.normalizedPrice - first.normalizedPrice) / first.normalizedPrice) * 100).toFixed(1))
      : null
    const latestByVariant = new Map<string, number>()
    for (const point of points) {
      latestByVariant.set(point.item.trim().toLocaleLowerCase(), point.normalizedPrice)
    }
    const variantLatestPrices = [...latestByVariant.values()]
    const minVariantLatest = Math.min(...variantLatestPrices)
    const maxVariantLatest = Math.max(...variantLatestPrices)
    const spreadPercent = variantLatestPrices.length >= 2 && minVariantLatest > 0
      ? Number((((maxVariantLatest - minVariantLatest) / minVariantLatest) * 100).toFixed(1))
      : null
    return {
      basis,
      basisLabel: first.basisLabel,
      pointCount: points.length,
      variantCount: latestByVariant.size,
      latestPoint,
      lowestNormalized,
      highestNormalized,
      averageNormalized,
      netChangePercent,
      spreadPercent,
      points
    }
  }).sort((first, second) => second.pointCount - first.pointCount || first.basis.localeCompare(second.basis))
}