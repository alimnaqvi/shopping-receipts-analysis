import { randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import type { ExtractedReceipt, ReceiptDuplicate, ReceiptUpload } from '../../shared/types/receipt-upload.ts'
import { storeNameKey } from '../../shared/utils/store-name.ts'
import { normalizeEntry } from './entry-input.ts'
import { itemSimilarity, parseExtraction } from './receipt-extraction.ts'
import { applyCategoryAssignments, categoryAssignments, lockItemWrites } from './category-query.ts'
import { ensureStore, upsertReceipt } from './receipt-query.ts'
import type { ReceiptPage } from './receipt-files.ts'

type Database = postgres.Sql | postgres.TransactionSql
export type UploadRow = ReceiptUpload & { bytes: Buffer }

export function uploadError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode, statusMessage: message })
}

export function requireUploadId(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) {
    throw uploadError(400, 'Invalid upload ID')
  }
  return value
}

function validatedDraft(value: unknown) {
  try {
    return parseExtraction(value)
  } catch (error) {
    throw uploadError(400, error instanceof Error ? error.message : 'Invalid receipt draft')
  }
}

export async function getUpload(sql: Database, id: string, source = false): Promise<UploadRow> {
  const [row] = await sql<UploadRow[]>`
    SELECT id, filename, page, mime, status, error, model, batch_id, receipt_id::text,
      extraction, draft, revision, created_at, CASE WHEN ${source} THEN source ELSE NULL END AS bytes
    FROM grocery_receipt_uploads WHERE id = ${id}
  `
  if (!row) throw uploadError(404, 'Receipt upload not found')
  return row
}

export async function storeReceiptPages(sql: postgres.Sql, pages: ReceiptPage[]) {
  return sql.begin(async (tx) => {
    const result: Array<{ id: string, duplicate: boolean }> = []
    for (const page of pages) {
      const [created] = await tx<{ id: string }[]>`
        INSERT INTO grocery_receipt_uploads (id, source_hash, filename, page, mime, source)
        VALUES (${randomUUID()}, ${page.hash}, ${page.filename}, ${page.page}, ${page.mime}, ${page.bytes})
        ON CONFLICT (source_hash) DO NOTHING RETURNING id
      `
      if (created) result.push({ id: created.id, duplicate: false })
      else {
        const [existing] = await tx<{ id: string }[]>`SELECT id FROM grocery_receipt_uploads WHERE source_hash = ${page.hash}`
        result.push({ id: existing!.id, duplicate: true })
      }
    }
    return result
  })
}

export async function listReceiptUploads(sql: Database, offset: number, archived: boolean) {
  const rows = await sql<ReceiptUpload[]>`
    SELECT id, filename, page, mime, status, error, model, batch_id, receipt_id::text,
      NULL AS extraction, NULL AS draft, revision, created_at
    FROM grocery_receipt_uploads
    WHERE ${archived} OR status NOT IN ('saved', 'discarded')
    ORDER BY created_at DESC, id LIMIT 51 OFFSET ${offset}
  `
  return { uploads: rows.slice(0, 50), hasMore: rows.length > 50 }
}

export async function receiptUploadDuplicates(sql: Database, draft: ExtractedReceipt, id: string): Promise<ReceiptDuplicate[]> {
  if (!draft.purchasedOn) return []
  const receipts = await sql<{ id: string, location: string, items: string[] }[]>`
    SELECT receipts.id::text, receipts.location, array_agg(entries.item) AS items
    FROM grocery_receipt_details receipts
    INNER JOIN grocery_entry_details entries ON entries.receipt_id = receipts.id
    WHERE receipts.purchased_on::text = ${draft.purchasedOn}
    GROUP BY receipts.id, receipts.location
  `
  const uploads = await sql<{ id: string, draft: ExtractedReceipt }[]>`
    SELECT id, draft FROM grocery_receipt_uploads
    WHERE id <> ${id} AND status = 'review' AND draft->>'purchasedOn' = ${draft.purchasedOn}
  `
  const candidates = [
    ...receipts.map(receipt => ({ ...receipt, source: 'receipt' as const })),
    ...uploads.map(upload => ({ id: upload.id, location: upload.draft.location ?? '', items: upload.draft.lines.map(line => line.item ?? ''), source: 'upload' as const }))
  ]
  return candidates.map(candidate => ({
    id: candidate.id,
    source: candidate.source,
    location: candidate.location,
    similarity: itemSimilarity(draft.lines.map(line => line.item ?? ''), candidate.items),
    sameStore: storeNameKey(draft.location) === storeNameKey(candidate.location)
  })).filter(candidate => candidate.sameStore || candidate.similarity >= 0.6)
}

export async function saveUploadDraft(sql: Database, id: string, value: unknown, revision: number) {
  const draft = validatedDraft(value)
  if (!Number.isInteger(revision) || revision < 1) throw uploadError(400, 'A valid draft revision is required')
  const [saved] = await sql<{ revision: number }[]>`
    UPDATE grocery_receipt_uploads SET draft = ${sql.json(draft)}, revision = revision + 1, updated_at = now()
    WHERE id = ${id} AND status = 'review' AND revision = ${revision} RETURNING revision
  `
  if (!saved) throw uploadError(409, 'This draft changed in another tab or is no longer awaiting review. Reload it before editing.')
  return saved
}

export async function setUploadDiscarded(sql: Database, id: string, discarded: boolean) {
  const [row] = await sql<{ id: string }[]>`
    UPDATE grocery_receipt_uploads
    SET status = CASE WHEN ${discarded} THEN 'discarded' WHEN draft IS NULL OR draft = 'null'::jsonb THEN 'pending' ELSE 'review' END,
      revision = revision + 1, updated_at = now()
    WHERE id = ${id} AND status = ANY(${discarded ? ['pending', 'failed', 'review'] : ['discarded']}::text[])
    RETURNING id
  `
  if (!row) throw uploadError(409, 'Only idle drafts can be skipped or restored')
  return row
}

export function approvedReceipt(value: unknown) {
  const draft = validatedDraft(value)
  if (draft.currency !== 'EUR') throw uploadError(400, 'Only EUR receipts can be approved. No currency conversion is performed.')
  if (!draft.lines.length) throw uploadError(400, 'Add at least one product line')
  const entries = draft.lines.map((line, index) => {
    if (line.price === null || !line.item?.trim()) throw uploadError(400, `Line ${index + 1}: product and paid price are required`)
    if (line.price > 9999999999.99 || (line.size !== null && (line.size < 0.001 || line.size > 999999999.999))) {
      throw uploadError(400, `Line ${index + 1}: price or size is outside the supported range`)
    }
    const entry = normalizeEntry({ ...line, purchasedOn: draft.purchasedOn, location: draft.location })
    if (entry.costPerUnit !== null && entry.costPerUnit > 99999999.9999) throw uploadError(400, `Line ${index + 1}: normalized price is outside the supported range`)
    return entry
  })
  return { draft, entries, assignments: categoryAssignments(entries) }
}

export async function approveReceiptUpload(sql: postgres.Sql, id: string, value: unknown, revision: number, reviewed: boolean, allowDuplicates: boolean) {
  if (!reviewed) throw uploadError(400, 'Confirm that you reviewed the receipt, currency, amounts and warnings')
  if (!Number.isInteger(revision) || revision < 1) throw uploadError(400, 'A valid draft revision is required')
  const { draft, entries, assignments } = approvedReceipt(value)
  return sql.begin(async (tx) => {
    const [upload] = await tx<{ status: string, receiptId: string, revision: number }[]>`
      SELECT status, receipt_id::text, revision FROM grocery_receipt_uploads WHERE id = ${id} FOR UPDATE
    `
    if (!upload) throw uploadError(404, 'Receipt upload not found')
    if (upload.status === 'saved') return { receiptId: upload.receiptId, alreadySaved: true }
    if (upload.status !== 'review' || upload.revision !== revision) throw uploadError(409, 'This draft changed. Reload it before approval.')
    await lockItemWrites(tx)
    const duplicates = await receiptUploadDuplicates(tx, draft, id)
    if (duplicates.length && !allowDuplicates) throw Object.assign(
      uploadError(409, 'Possible duplicate receipt. Review the matches and explicitly confirm saving anyway.'),
      { data: { duplicates } }
    )
    const location = await ensureStore(tx, entries[0]!.location)
    const receiptId = await upsertReceipt(tx, entries[0]!.purchasedOn, location)
    const entryIds: string[] = []
    for (const entry of entries) {
      const [saved] = await tx<{ id: string }[]>`
        INSERT INTO grocery_entries (receipt_id, item, size, unit, price, sale_item, non_grocery, notes)
        VALUES (${receiptId}, ${entry.item}, ${entry.size}, ${entry.unit}, ${entry.price}, ${entry.saleItem}, ${entry.nonGrocery}, ${entry.notes})
        RETURNING id::text
      `
      entryIds.push(saved!.id)
    }
    await applyCategoryAssignments(tx, assignments)
    await tx`
      UPDATE grocery_receipt_uploads SET status = 'saved', receipt_id = ${receiptId}, draft = ${tx.json(draft)},
        entry_ids = ${tx.json(entryIds)}, revision = revision + 1, updated_at = now() WHERE id = ${id}
    `
    return { receiptId, alreadySaved: false }
  })
}