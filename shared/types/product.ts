export type CatalogProduct = {
  item: string
  family: string | null
  brand: string | null
  variant: string | null
  category: string | null
}

export type CatalogAlias = {
  location: string
  rawDescription: string
  item: string
  brand: string | null
  variant: string | null
}

export type ItemCatalog = { products: CatalogProduct[], aliases: CatalogAlias[], truncated: boolean }

export type ProductMetadata = {
  sourceUploadId?: string | null
  productFamily?: string | null
  brand?: string | null
  variant?: string | null
  rawDescription?: string | null
  quantity?: string | number | null
  regularPrice?: string | number | null
  discount?: string | number | null
  purchasedTime?: string | null
}