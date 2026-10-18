import type { ReceiptObjectStore } from './receipt-storage.ts'

export const DATABASE_RESET_CONFIRMATION = 'RESET'

export function hasDatabaseResetConfirmation(value: unknown): value is string {
  return typeof value === 'string' && value === DATABASE_RESET_CONFIRMATION
}

type ResetTransaction = {
  unsafe: (query: string) => Promise<unknown>
}

type ResetDatabaseClient = {
  begin: <T>(callback: (transaction: ResetTransaction) => Promise<T>) => Promise<T>
}

export async function resetDatabase(sql: ResetDatabaseClient, store: ReceiptObjectStore | null = null): Promise<void> {
  const keys = await sql.begin(async (transaction) => {
    const rows = store
      ? await transaction.unsafe('SELECT storage_key FROM grocery_receipt_uploads WHERE storage_key IS NOT NULL') as Array<{ storageKey?: string, storage_key?: string }>
      : []
    await transaction.unsafe(`
      TRUNCATE TABLE grocery_item_aliases, grocery_receipt_uploads, grocery_entries, grocery_receipts, grocery_item_categories, grocery_categories, grocery_category_seeds,
        grocery_stores, grocery_item_merge_dismissals
      RESTART IDENTITY
    `)
    return rows.map(row => row.storageKey ?? row.storage_key ?? '').filter(Boolean)
  })
  if (store && keys.length) await store.delete(keys)
}
