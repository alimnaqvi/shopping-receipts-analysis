import type { CatalogProduct, ItemCatalog } from '../types/product.ts'
import type { ExtractedLine, ExtractedReceipt } from '../types/receipt-upload.ts'

export function productTextKey(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').toLowerCase()
    .replace(/\u00e4/g, 'ae').replace(/\u00f6/g, 'oe').replace(/\u00fc/g, 'ue').replace(/\u00df/g, 'ss')
    .replace(/(\d),(\d)/g, '$1.$2').replace(/[^\p{L}\p{N}%.]+/gu, ' ').trim()
}

export function receiptMinute(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) throw new Error('Receipt time must be HH:mm or HH:mm:ss')
  return value.slice(0, 5)
}

export function compatibleProduct(line: Pick<ExtractedLine, 'brand' | 'variant'>, product: Pick<CatalogProduct, 'brand' | 'variant'>) {
  return (!line.brand || !product.brand || productTextKey(line.brand) === productTextKey(product.brand))
    && (!line.variant || !product.variant || productTextKey(line.variant) === productTextKey(product.variant))
}

export function catalogMatch(line: ExtractedLine, location: string | null, catalog: ItemCatalog): CatalogProduct | null {
  const aliases = catalog.aliases.filter(alias => productTextKey(alias.location) === productTextKey(location)
    && productTextKey(alias.rawDescription) === productTextKey(line.rawDescription)
    && compatibleProduct(line, alias))
  const aliasNames = new Set(aliases.map(alias => alias.item))
  if (aliasNames.size === 1) {
    const product = catalog.products.find(candidate => aliasNames.has(candidate.item) && compatibleProduct(line, candidate))
    if (product) return product
  }
  const names = catalog.products.filter(product => productTextKey(product.item) === productTextKey(line.item) && compatibleProduct(line, product))
  return names.length === 1 ? names[0]! : null
}

export function applyCatalog(receipt: ExtractedReceipt, catalog: ItemCatalog, original?: ExtractedReceipt | null): ExtractedReceipt {
  return {
    ...receipt,
    lines: receipt.lines.map((line, index) => {
      const previous = original?.lines[index]
      if (original && (!previous || previous.item !== line.item || previous.rawDescription !== line.rawDescription
        || previous.brand !== line.brand || previous.variant !== line.variant || previous.family !== line.family)) return { ...line }
      const product = catalogMatch(line, receipt.location, catalog)
      return product ? { ...line, item: product.item, family: product.family ?? line.family ?? null,
        brand: product.brand ?? line.brand, variant: product.variant ?? line.variant,
        category: product.category ?? line.category } : { ...line }
    })
  }
}