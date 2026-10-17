import { randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import type { ExtractionInput, ReceiptExtractor } from './receipt-provider.ts'
import { uploadError } from './receipt-upload-query.ts'
import { itemCatalog, receiptItemCatalog } from './product-catalog.ts'
import { applyCatalog } from '../../shared/utils/product-identity.ts'

async function claimUploads(sql: postgres.Sql, ids: string[], model: string, token: string) {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('receipt-box:upload-processing'))`
    const [busy] = await tx<{ count: number, bytes: string }[]>`
      SELECT count(*)::int AS count,
        (SELECT coalesce(sum(octet_length(source)), 0)::text FROM grocery_receipt_uploads WHERE id = ANY(${ids}::uuid[])) AS bytes
      FROM grocery_receipt_uploads
      WHERE status = 'processing' AND updated_at > now() - interval '10 minutes'
    `
    if (busy!.count >= 3) throw uploadError(429, 'Other receipts are extracting. Try again shortly.')
    if (Number(busy!.bytes) > 64 * 1024 * 1024) throw uploadError(413, 'Select fewer receipts: combined source data is limited to 64 MiB per extraction group')
    const rows = await tx<ExtractionInput[]>`
      UPDATE grocery_receipt_uploads SET status = 'processing', lease_token = ${token},
        model = ${model}, provider = 'openai', error = NULL, updated_at = now()
      WHERE id = ANY(${ids}::uuid[]) AND (status IN ('pending', 'failed')
        OR (status = 'processing' AND updated_at < now() - interval '10 minutes'))
      RETURNING id, filename, mime, source AS bytes
    `
    if (rows.length !== ids.length) throw uploadError(409, 'Receipts are already processing or no longer pending. Interrupted requests can be retried after 10 minutes.')
    return rows
  })
}

async function extractionCategories(sql: postgres.Sql) {
  const rows = await sql<{ name: string }[]>`SELECT name FROM grocery_categories ORDER BY name LIMIT 1000`
  return rows.map(row => row.name)
}

async function failClaim(sql: postgres.Sql, token: string, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 500) : 'Receipt extraction failed'
  await sql`
    UPDATE grocery_receipt_uploads SET status = 'failed', error = ${message}, lease_token = NULL, updated_at = now()
    WHERE lease_token = ${token} AND status = 'processing'
  `
}

export async function extractReceiptUpload(sql: postgres.Sql, id: string, provider: ReceiptExtractor) {
  const token = randomUUID()
  const [input] = await claimUploads(sql, [id], provider.model, token)
  try {
    const categories = await extractionCategories(sql)
    const catalog = await itemCatalog(sql)
    const extraction = await provider.extract(input!, categories, catalog)
    const draft = applyCatalog(extraction, await receiptItemCatalog(sql, extraction, catalog))
    await sql`
      UPDATE grocery_receipt_uploads SET status = 'review', extraction = ${sql.json(extraction)},
        draft = ${sql.json(draft)}, revision = revision + 1, lease_token = NULL, updated_at = now()
      WHERE id = ${id} AND lease_token = ${token} AND status = 'processing'
    `
    return { status: 'review' }
  } catch (error) {
    await failClaim(sql, token, error)
    throw uploadError(502, error instanceof Error ? error.message : 'Receipt extraction failed')
  }
}

export async function submitReceiptBatch(sql: postgres.Sql, ids: string[], provider: ReceiptExtractor) {
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw uploadError(400, 'Select between 1 and 100 distinct pending receipts')
  const token = randomUUID()
  const inputs = await claimUploads(sql, ids, provider.model, token)
  try {
    const categories = await extractionCategories(sql)
    const batchId = await provider.submitBatch(inputs, categories, await itemCatalog(sql))
    await sql`
      UPDATE grocery_receipt_uploads SET status = 'batch', batch_id = ${batchId}, lease_token = NULL, updated_at = now()
      WHERE lease_token = ${token} AND status = 'processing'
    `
    return { batchId }
  } catch (error) {
    await failClaim(sql, token, error)
    throw uploadError(502, error instanceof Error ? error.message : 'Batch submission failed')
  }
}

export async function refreshReceiptBatch(sql: postgres.Sql, id: string, provider: ReceiptExtractor, cancel = false) {
  const rows = await sql<{ id: string, status: string }[]>`
    SELECT id, status FROM grocery_receipt_uploads WHERE batch_id = ${id}
  `
  if (!rows.length) throw uploadError(404, 'Receipt batch not found')
  if (!rows.some(row => row.status === 'batch')) return { status: 'finished', updated: 0 }
  if (cancel) await provider.cancelBatch(id)
  const progress = await provider.pollBatch(id)
  if (!progress.terminal) return { status: progress.status, updated: 0 }
  const catalog = await itemCatalog(sql)
  return sql.begin(async (tx) => {
    const results = new Map(progress.results.map(result => [result.id, result]))
    for (const row of rows) {
      const result = results.get(row.id)
      const extraction = result?.extraction ?? null
      const draft = extraction ? applyCatalog(extraction, await receiptItemCatalog(tx, extraction, catalog)) : null
      const error = extraction ? null : result?.error ?? `No extraction returned (batch ${progress.status}). Retry this receipt individually.`
      await tx`
        UPDATE grocery_receipt_uploads SET status = ${extraction ? 'review' : 'failed'},
          extraction = ${extraction ? tx.json(extraction) : null}, draft = ${draft ? tx.json(draft) : null}, error = ${error},
          revision = revision + 1, updated_at = now()
        WHERE id = ${row.id} AND batch_id = ${id} AND status = 'batch'
      `
    }
    return { status: progress.status, updated: rows.filter(row => row.status === 'batch').length }
  })
}