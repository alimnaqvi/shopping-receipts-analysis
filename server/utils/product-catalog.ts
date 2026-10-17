import { createHash } from 'node:crypto'
import type postgres from 'postgres'
import type { CatalogAlias, CatalogProduct, ItemCatalog } from '../../shared/types/product.ts'
import type { ExtractedLine, ExtractedReceipt } from '../../shared/types/receipt-upload.ts'
import { productTextKey } from '../../shared/utils/product-identity.ts'

type Database = postgres.Sql | postgres.TransactionSql

function aliasHash(value: string) {
  return createHash('sha256').update(productTextKey(value)).digest('hex')
}

async function catalogProducts(sql: Database, items: string[] | null, limit: number) {
  return sql<CatalogProduct[]>`
    SELECT item,
      CASE WHEN count(DISTINCT product_family) = 1 THEN min(product_family) END AS family,
      CASE WHEN count(DISTINCT brand) = 1 THEN min(brand) END AS brand,
      CASE WHEN count(DISTINCT variant) = 1 THEN min(variant) END AS variant,
      min(category) AS category
    FROM grocery_entry_details WHERE ${items === null} OR item = ANY(${items ?? []}::text[])
    GROUP BY item ORDER BY max(purchased_on) DESC, count(*) DESC, item LIMIT ${limit}
  `
}

export function boundedCatalog(products: CatalogProduct[], aliases: CatalogAlias[]): ItemCatalog {
  const result: ItemCatalog = { products: [], aliases: [], truncated: false }
  let bytes = 0
  for (const product of products) {
    const size = Buffer.byteLength(JSON.stringify(product))
    if (result.products.length >= 500 || bytes + size > 80000) { result.truncated = true; continue }
    result.products.push(product)
    bytes += size
  }
  const names = new Set(result.products.map(product => product.item))
  for (const alias of aliases) {
    if (!names.has(alias.item)) { result.truncated = true; continue }
    const size = Buffer.byteLength(JSON.stringify(alias))
    if (result.aliases.length >= 1000 || bytes + size > 120000) { result.truncated = true; continue }
    result.aliases.push(alias)
    bytes += size
  }
  return result
}

export async function itemCatalog(sql: Database): Promise<ItemCatalog> {
  const products = await catalogProducts(sql, null, 501)
  const aliases = await sql<CatalogAlias[]>`
    SELECT location, raw_description, item, brand, variant FROM grocery_item_aliases
    WHERE item = ANY(${products.map(product => product.item)}::text[])
    ORDER BY updated_at DESC, item LIMIT 1001
  `
  return boundedCatalog(products, aliases)
}

export async function receiptItemCatalog(sql: Database, receipt: ExtractedReceipt, catalog: ItemCatalog): Promise<ItemCatalog> {
  const descriptions = receipt.lines.map(line => line.rawDescription).filter(Boolean)
  if (!receipt.location || !descriptions.length) return catalog
  const aliases = await sql<CatalogAlias[]>`
    SELECT location, raw_description, item, brand, variant FROM grocery_item_aliases
    WHERE store_key = ${aliasHash(receipt.location)} AND raw_key = ANY(${descriptions.map(aliasHash)}::text[])
  `
  const names = [...new Set(aliases.map(alias => alias.item))]
  const products = names.length ? await catalogProducts(sql, names, names.length) : []
  const keys = new Set(descriptions.map(productTextKey))
  return {
    products: [...new Map([...catalog.products, ...products].map(product => [product.item, product])).values()],
    aliases: [...catalog.aliases.filter(alias => productTextKey(alias.location) !== productTextKey(receipt.location) || !keys.has(productTextKey(alias.rawDescription))), ...aliases],
    truncated: catalog.truncated
  }
}

export async function learnProductAlias(tx: Database, location: string, line: ExtractedLine) {
  if (!line.item?.trim() || !line.rawDescription.trim()) return
  await tx`
    INSERT INTO grocery_item_aliases (store_key, raw_key, item_key, location, raw_description, item, brand, variant)
    VALUES (${aliasHash(location)}, ${aliasHash(line.rawDescription)}, ${aliasHash(line.item)}, ${location},
      ${line.rawDescription}, ${line.item.trim()}, ${line.brand}, ${line.variant})
    ON CONFLICT (store_key, raw_key, item_key) DO UPDATE SET
      location = EXCLUDED.location, raw_description = EXCLUDED.raw_description, item = EXCLUDED.item,
      brand = EXCLUDED.brand, variant = EXCLUDED.variant, updated_at = now()
  `
}