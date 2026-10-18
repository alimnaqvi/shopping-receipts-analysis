import { db, publicEntry, type GroceryEntry } from '../../utils/db'
import { normalizeEntry, type EntryInput } from '../../utils/entry-input'
import { normalizeStoreName } from '../../../shared/utils/store-name'
import { ensureStore, moveReceiptToKey } from '../../utils/receipt-query'
import { applyCategoryAssignments, categoryAssignments, lockItemWrites } from '../../utils/category-query'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid receipt id' })

  const body = await readBody<{
    purchasedOn?: unknown
    purchasedTime?: unknown
    location?: unknown
    entries?: Record<string, unknown>[]
  }>(event)
  const purchasedOn = String(body.purchasedOn ?? '').slice(0, 10)
  const location = normalizeStoreName(body.location)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchasedOn)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid receipt date is required' })
  }
  if (!location) throw createError({ statusCode: 400, statusMessage: 'Store is required' })
  if (!Array.isArray(body.entries) || !body.entries.length) {
    throw createError({ statusCode: 400, statusMessage: 'A receipt must contain at least one line' })
  }
  if (body.entries.length > 200) {
    throw createError({ statusCode: 413, statusMessage: 'Receipts are limited to 200 lines' })
  }

  const entries: EntryInput[] = []
  const entryIds: Array<string | null> = []
  const errors: string[] = []
  body.entries.forEach((line, index) => {
    const entryId = line.id === undefined || line.id === null || line.id === '' ? null : String(line.id)
    if (entryId !== null && !/^\d+$/.test(entryId)) errors.push(`Line ${index + 1}: Invalid entry id`)
    entryIds.push(entryId)
    try {
      entries.push(normalizeEntry({
        ...(body.purchasedTime === undefined ? {} : { purchasedTime: body.purchasedTime }),
        ...line,
        purchasedOn,
        location
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid line'
      errors.push(`Line ${index + 1}: ${message}`)
    }
  })
  const keptIds = entryIds.filter((entryId): entryId is string => entryId !== null)
  if (new Set(keptIds).size !== keptIds.length) errors.push('Receipt lines contain duplicate entry ids')
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.slice(0, 5).join('; ') })
  const assignments = categoryAssignments(entries)

  const sql = db()
  const saved = await sql.begin(async (tx) => {
    await lockItemWrites(tx)
    const [receipt] = await tx<{ id: string }[]>`
      SELECT id::text FROM grocery_receipts WHERE id = ${id} FOR UPDATE
    `
    if (!receipt) throw createError({ statusCode: 404, statusMessage: 'Receipt not found' })

    const existing = await tx<{ id: string }[]>`
      SELECT id::text FROM grocery_entries WHERE receipt_id = ${id} FOR UPDATE
    `
    const existingIds = new Set(existing.map(entry => entry.id))
    if (keptIds.some(entryId => !existingIds.has(entryId))) {
      throw createError({ statusCode: 400, statusMessage: 'One or more lines do not belong to this receipt' })
    }
    const canonicalLocation = await ensureStore(tx, location)
    if (keptIds.length) {
      await tx`DELETE FROM grocery_entries WHERE receipt_id = ${id} AND id NOT IN ${tx(keptIds)}`
    } else {
      await tx`DELETE FROM grocery_entries WHERE receipt_id = ${id}`
    }

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!
      const entryId = entryIds[index]
      if (entryId) {
        await tx`
          UPDATE grocery_entries SET
            item = ${entry.item}, size = ${entry.size}, unit = ${entry.unit}, price = ${entry.price},
            sale_item = ${entry.saleItem},
            non_grocery = ${entry.nonGrocery}, notes = ${entry.notes},
            product_family = CASE WHEN ${entry.productFamily !== undefined} THEN ${entry.productFamily ?? null} ELSE product_family END,
            brand = CASE WHEN ${entry.brand !== undefined} THEN ${entry.brand ?? null} ELSE brand END,
            variant = CASE WHEN ${entry.variant !== undefined} THEN ${entry.variant ?? null} ELSE variant END,
            raw_description = CASE WHEN ${entry.rawDescription !== undefined} THEN ${entry.rawDescription ?? null} ELSE raw_description END,
            quantity = CASE WHEN ${entry.quantity !== undefined} THEN ${entry.quantity ?? null} ELSE quantity END,
            regular_price = CASE WHEN ${entry.regularPrice !== undefined} THEN ${entry.regularPrice ?? null} ELSE regular_price END,
            discount = CASE WHEN ${entry.discount !== undefined} THEN ${entry.discount ?? null} ELSE discount END,
            purchased_time = CASE WHEN ${entry.purchasedTime !== undefined} THEN ${entry.purchasedTime ?? null} ELSE purchased_time END,
            updated_at = now()
          WHERE id = ${entryId} AND receipt_id = ${id}
        `
      } else {
        await tx`
          INSERT INTO grocery_entries (
            receipt_id, item, size, unit, price,
            sale_item, non_grocery, notes,
            product_family, brand, variant, raw_description,
            quantity, regular_price, discount, purchased_time
          ) VALUES (
            ${id}, ${entry.item}, ${entry.size}, ${entry.unit}, ${entry.price}, ${entry.saleItem},
            ${entry.nonGrocery}, ${entry.notes},
            ${entry.productFamily ?? null}, ${entry.brand ?? null}, ${entry.variant ?? null}, ${entry.rawDescription ?? null},
            ${entry.quantity ?? null}, ${entry.regularPrice ?? null}, ${entry.discount ?? null}, ${entry.purchasedTime ?? null}
          )
        `
      }
    }
    await applyCategoryAssignments(tx, assignments)

    const savedReceiptId = await moveReceiptToKey(tx, id, purchasedOn, canonicalLocation)
    const savedEntries = await tx<GroceryEntry[]>`
      SELECT * FROM grocery_entry_details WHERE receipt_id = ${savedReceiptId} ORDER BY id
    `
    return { id: savedReceiptId, location: canonicalLocation, entries: savedEntries }
  })

  return {
    id: saved.id,
    purchasedOn,
    location: saved.location,
    itemCount: saved.entries.length,
    total: saved.entries.reduce((sum, entry) => sum + Number(entry.price), 0).toFixed(2),
    entries: saved.entries.map(publicEntry)
  }
})
