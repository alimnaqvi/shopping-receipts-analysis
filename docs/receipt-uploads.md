# Receipt Uploads

Receipt uploads support JPEG, PNG, and PDF files. Uploading only stores the
source; it does not call the model. Select uploaded pages and explicitly choose
immediate extraction or the provider's Batch API.

Each PDF page is treated as one receipt. Pages are split into single-page PDFs
and sent as native PDF inputs; no OCR or JPG conversion is performed. Limits are
20 MiB per file, 50 pages per PDF, 100 files per upload selection, and 1–100 pages
per Batch submission. Batch input is limited to 64 MiB of combined source data
and 100 MiB of encoded request data. Extraction groups are limited in size and
concurrency by the server.

Configure the server-only provider and optional object storage settings in `.env`
or the deployment's secret store:

```dotenv
OPENAI_API_KEY=...
RECEIPT_AI_PROVIDER=openai
RECEIPT_AI_MODEL=gpt-6-luna
# Optional Responses-compatible endpoint
# OPENAI_BASE_URL=https://api.openai.com/v1

# Optional S3-compatible object storage (such as Neon Object Storage)
# AWS_ENDPOINT_URL_S3=https://br-example.storage.c-1.eu-central-1.aws.neon.tech
# AWS_ACCESS_KEY_ID=nak_live_...
# AWS_SECRET_ACCESS_KEY=nsk_live_...
# AWS_REGION=eu-central-1
# RECEIPT_STORAGE_BUCKET=receipt-uploads
```

Only OpenAI is currently implemented. `ReceiptExtractor` is the provider boundary;
other providers need an adapter. Upload contents are sent to the configured
provider. Immediate calls disable response storage where supported, but this does
not guarantee zero provider retention. Batch inputs expire after two days. Review
the provider's retention terms before uploading sensitive receipts.

## Processing and Review

Immediate mode sends one request per receipt page with up to two browser workers.
Keep the page open until submitted requests finish. Refresh the queue after an
interruption. A processing lease left by a server interruption can be retried after
ten minutes; a retry can incur another provider charge if the earlier request had
already completed.

Batch mode is opt-in and asynchronous. OpenAI documents a 50% discount and a
24-hour completion window, subject to model support and current limits. Refresh
the Batch queue to collect results. Successful pages from a partial, expired, or
cancelled Batch remain available for review; failed pages can be retried
individually. Receipts are never approved automatically.

Review the original beside the extracted draft. Missing amounts remain blank.
Line price and size represent the whole purchased line, including all units on
that line. Verify the date, currency, store, line totals, and printed total.
Basket-wide discounts and refunds can require manual reconciliation. Confidence
is a model heuristic, not a calibrated probability.

The application currently uses EUR and does not convert currencies. Changing a
receipt's currency code does not convert its amounts. Only EUR receipts can be
approved.

## Product Identity

Extraction reuses matching catalog item names and preserves the original receipt
text. Requests include a bounded catalog of existing item names, families, brands,
variants, categories, and approved store-specific aliases. After extraction, a
targeted lookup checks approved aliases for the receipt's store and raw line text,
including aliases outside the model-context limit.

Aliases are learned only when a receipt is approved. A compatible, unambiguous
alias or exact normalized item name may reuse an existing name. Family membership
alone does not merge products. Brands, package-independent variants, fat
percentages, organic/lactose-free distinctions, and other product differences
should remain distinct. Ambiguous aliases and known brand/variant conflicts are
not automatically merged; reviewers can correct the product name and family.

Existing names are not automatically translated, renamed, or merged. Older
approved upload details are recovered only when the stored entry references match
exactly. Details retained on approved entries include family, brand, variant,
quantity, regular line total, discount, raw receipt text, printed time, and a link
to the source upload.

Product Families compares distinct products within a family. Mass, volume, and
count prices are reported separately; missing size data does not produce an
invented normalized price. A shared family is not a claim of nutritional
equivalence. CSV/XLSX exports continue to contain the standard purchase columns,
not original scans or all rich extraction metadata.

## Duplicate Detection and Time

Exact upload hashes prevent processing the same uploaded bytes and PDF page twice.
They do not recognize rescans or different photos. Review also warns about
same-day, same-store receipts and item-name overlap. These are heuristics, not
proof that two receipts are duplicates. Approval for a matching store and date
appends entries to the existing store/day receipt after explicit confirmation.

Printed checkout time is stored as local `HH:mm`. Printed seconds are discarded
without rounding. Missing time stays unknown; scan timestamps and timezone guesses
are not used. Duplicate warnings show whether a candidate has a matching, different,
or unknown printed minute. Receipt grouping remains by store and day.

When S3-compatible object storage (such as Neon Object Storage) is configured via
`AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`, original
page bytes are stored in the private bucket (`RECEIPT_STORAGE_BUCKET`, defaulting
to `receipt-uploads`) while PostgreSQL retains only the object key, byte size, raw
extraction, corrected draft, and approved-entry references. Any existing receipt
bytes stored in PostgreSQL are migrated to object storage automatically on startup.
When object storage is not configured, original page bytes fall back to PostgreSQL.
Keep both the database and object storage bucket private and backed up.