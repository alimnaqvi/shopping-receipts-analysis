import { db, publicEntry, type GroceryEntry } from '../../utils/db'
import { normalizeEntry } from '../../utils/entry-input'
import { ensureStore, moveReceiptToKey } from '../../utils/receipt-query'
import { applyCategoryAssignments, categoryAssignments, lockItemWrites } from '../../utils/category-query'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid entry id' })
  const input = normalizeEntry(await readBody(event))
  const sql = db()
  const row = await sql.begin(async (tx) => {
    await lockItemWrites(tx)
    const canonicalLocation = await ensureStore(tx, input.location)
    const [current] = await tx<{ receiptId: string }[]>`
      SELECT receipt_id::text FROM grocery_entries WHERE id = ${id} FOR UPDATE
    `
    if (!current) return undefined
    await moveReceiptToKey(tx, current.receiptId, input.purchasedOn, canonicalLocation)
    const [updated] = await tx<{ id: string }[]>`
      UPDATE grocery_entries SET
        item = ${input.item}, size = ${input.size}, unit = ${input.unit}, price = ${input.price},
        sale_item = ${input.saleItem},
        non_grocery = ${input.nonGrocery}, notes = ${input.notes},
        product_family = CASE WHEN ${input.productFamily !== undefined} THEN ${input.productFamily ?? null} ELSE product_family END,
        brand = CASE WHEN ${input.brand !== undefined} THEN ${input.brand ?? null} ELSE brand END,
        variant = CASE WHEN ${input.variant !== undefined} THEN ${input.variant ?? null} ELSE variant END,
        raw_description = CASE WHEN ${input.rawDescription !== undefined} THEN ${input.rawDescription ?? null} ELSE raw_description END,
        quantity = CASE WHEN ${input.quantity !== undefined} THEN ${input.quantity ?? null} ELSE quantity END,
        regular_price = CASE WHEN ${input.regularPrice !== undefined} THEN ${input.regularPrice ?? null} ELSE regular_price END,
        discount = CASE WHEN ${input.discount !== undefined} THEN ${input.discount ?? null} ELSE discount END,
        purchased_time = CASE WHEN ${input.purchasedTime !== undefined} THEN ${input.purchasedTime ?? null} ELSE purchased_time END,
        updated_at = now()
      WHERE id = ${id}
      RETURNING id
    `
    if (!updated) return undefined
    await applyCategoryAssignments(tx, categoryAssignments([input]))
    const [saved] = await tx<GroceryEntry[]>`
      SELECT * FROM grocery_entry_details WHERE id = ${updated.id}
    `
    return saved
  })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Entry not found' })
  return publicEntry(row)
})
