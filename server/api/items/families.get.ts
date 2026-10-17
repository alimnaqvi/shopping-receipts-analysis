import { db, publicEntry, type GroceryEntry } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const family = String(getQuery(event).family ?? '').trim()
  if (family.length > 100) throw createError({ statusCode: 400, statusMessage: 'Family name is too long' })
  const sql = db()
  const families = await sql<{ family: string, itemCount: number, purchases: number, totalSpent: string }[]>`
    WITH profiles AS (
      SELECT item, min(product_family) AS family FROM grocery_entries
      WHERE product_family IS NOT NULL GROUP BY item HAVING count(DISTINCT lower(product_family)) = 1
    )
    SELECT profiles.family, count(DISTINCT entries.item)::int AS item_count,
      count(*)::int AS purchases, sum(entries.price)::text AS total_spent
    FROM profiles INNER JOIN grocery_entries entries ON entries.item = profiles.item
    GROUP BY profiles.family ORDER BY sum(entries.price) DESC, profiles.family
  `
  const entries = family ? await sql<GroceryEntry[]>`
    WITH profiles AS (
      SELECT item, min(product_family) AS family FROM grocery_entries
      WHERE product_family IS NOT NULL GROUP BY item HAVING count(DISTINCT lower(product_family)) = 1
    )
    SELECT entries.* FROM grocery_entry_details entries
    INNER JOIN profiles ON profiles.item = entries.item
    WHERE lower(profiles.family) = lower(${family}) ORDER BY entries.purchased_on, entries.id
  ` : []
  return { families, entries: entries.map(publicEntry) }
})