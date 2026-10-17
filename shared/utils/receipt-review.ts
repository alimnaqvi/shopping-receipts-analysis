import type { ExtractedReceipt } from '../types/receipt-upload.ts'

export function reviewWarnings(receipt: ExtractedReceipt): string[] {
  const warnings = [...receipt.warnings]
  if (receipt.currency !== 'EUR') warnings.push('Confirm the currency is EUR before approval. No currency conversion is performed.')
  if (!receipt.purchasedOn) warnings.push('Purchase date is missing.')
  if (!receipt.location?.trim()) warnings.push('Store is missing.')
  if (!receipt.lines.length) warnings.push('No product lines were extracted.')
  if (receipt.lines.some(line => line.price === null || line.price < 0 || !line.item?.trim())) warnings.push('Some lines need a product name or a non-negative paid price. Refunds require manual resolution.')
  if (receipt.lines.some(line => line.confidence !== null && line.confidence < 0.8)) warnings.push('Some lines have low extraction confidence.')
  if (receipt.total !== null && receipt.lines.length && receipt.lines.every(line => line.price !== null)) {
    const difference = receipt.lines.reduce((sum, line) => sum + Math.round(line.price! * 100), 0) - Math.round(receipt.total * 100)
    if (Math.abs(difference) > 1) warnings.push(`Line totals differ from the receipt total by EUR ${(difference / 100).toFixed(2)}.`)
  }
  return warnings
}