# Receipt Box

[![Docker Image](https://img.shields.io/badge/ghcr.io-receipt--box-blue?logo=docker)](https://ghcr.io/davidski/receipt-box)

Receipt Box is a self-hosted receipt tracker designed for quick browser
entry. It turns grocery receipts into searchable purchase history,
normalized price comparisons, and data highlights.

## Disclaimer

Receipt Box is a personal project, developed with AI assistance. Review the
code, configuration, security assumptions, and have a backup plan before
relying on it.

## License

Receipt Box is licensed under the [MIT License](LICENSE).

## Overview

Receipt Box is a self-hosted web app with a browser interface and an
application server. The app server stores receipt data in a PostgreSQL
database. The included local Docker Compose setup runs the app server and
database server in separate containers; you can also connect the app to an
existing PostgreSQL server. CSV and XLSX import and export are handled in the
browser.

## Features

- Multi-line receipt entry with shared date and store, item suggestions, and reused item details
- Purchases grouped by store and day, with later entries and imports appended
- Searchable, sortable, editable history with sale and previous-price comparisons
- Normalized price comparisons and per-item history graphs
- Highlights for totals, price changes, stores, categories, and sales
- Store and category management
- CSV and XLSX import and export
- Receipt image/PDF uploads, persistent correction drafts, and immediate or discounted OpenAI Batch extraction
- English catalog-aware extraction, approved store aliases, product-family comparisons, and preserved product/source details

## Receipt uploads

This fork uses **EUR throughout**. Existing amounts are not converted from another
currency. Mixed-currency reporting and automatic exchange conversion are not supported.

Set the following server settings in `.env` before starting Nuxt or Docker Compose:

```dotenv
OPENAI_API_KEY=your-api-key
RECEIPT_AI_PROVIDER=openai
RECEIPT_AI_MODEL=gpt-6-luna
```

Open **Receipts → Upload receipts**. Select JPEG, PNG or PDF files, upload them,
then select pending pages and choose **Immediate** or **Batch** extraction. Uploading
alone does not call the model. Every PDF page is treated as a separate receipt and
sent as a native single-page PDF, including its scan; no OCR or JPG conversion is
required. Files are limited to 20 MiB and PDFs to 50 pages. Up to 100 files can be
selected per upload operation. Each Batch submission supports 1–100 pages with at
most 64 MiB of combined source data (and at most 100 MiB of encoded API input).

Immediate mode runs two client workers, with a server-side limit on concurrent
extraction groups. Leave the page open while submitting immediate requests; after
an interruption, refresh the queue and select the remaining pages. A request left
in Extracting after a server restart can be explicitly retried after ten minutes.
Retries can incur additional charges if a prior provider request already completed.

Batch is explicitly opt-in. OpenAI documents a **50% discount** and a **24-hour
completion window**, subject to model support and limits. Reopen the queue and use
**Refresh batches** to collect results. The browser does not need to stay open
after submission. Cancel a batch from its selected queue item; refresh again after
cancellation settles. Completed results from expired or cancelled batches are kept;
missing/failed results can be retried individually. No receipts are approved automatically.

Review the original beside the extracted data, correct missing or uncertain fields,
and save corrections or approve the receipt. Unknown amounts remain blank. Paid
price and size represent the **whole receipt line**, including all units bought,
so normalized price remains meaningful. Brands, variants, quantities, discounts,
regular prices, confidence estimates, receipt number and original descriptions are
retained with the reviewed draft. Product family, brand, variant, receipt text, quantity,
regular line total, discount and printed time are also persisted on approved entries.
Confidence is a model heuristic, not a calibrated
probability. Basket-wide discounts and refunds need manual reconciliation; verify
the line sum against the printed total before approval. A non-EUR extraction cannot
be approved until its currency is corrected; changing the code does not convert amounts.

Exact source hashes avoid extracting the same upload twice, including PDF page
identity. Hashes do not recognize rescans or different photos. Review also warns
about same-day same-store receipts and normalized item-name overlap in saved receipts
and pending drafts. This is a warning heuristic, not reliable product identification.
Receipt Box groups purchases by **store and date**; explicitly approving a same-store,
same-day receipt appends its lines to the existing receipt. Approval is transactional
and repeat-safe, and stale draft edits are rejected rather than overwriting corrections.

### Product identity and families

Extraction requests **English product names** while preserving the original German
receipt text. Both immediate and Batch requests include known products with their
family/brand/variant, existing categories and approved store-specific aliases. For
example, `Ja! Milk 1.5%`, `Ja! Milk 3%` and `Milsani Milk 1.5%` remain distinct products
under the narrower `Milk` family, not just the broad `Dairy and Eggs` category.
Organic, lactose-free, flavour and fat-percentage distinctions remain in the variant.
Unknown brands must not be guessed from the store.

Aliases are learned **only on approval**, using the corrected product name and
original store-specific receipt description. An unambiguous compatible alias or
exact normalized name can reuse a canonical product. Conflicting brands/variants
and ambiguous aliases are not automatically merged. Approval rejects a known product
name with conflicting brand/variant metadata. A shared family is never sufficient
evidence that two products are identical. Manually corrected draft identities are
preserved when reopening review.

Model context is bounded to 500 recent/frequent products and 1,000 aliases, with a
size budget. After extraction and when opening review, targeted lookups use the full
approved alias dictionary for the receipt's store and raw descriptions, including
older products outside that context. Different unseen abbreviations can still need
manual correction; this is not a guaranteed semantic product-identity system.

Existing item names are **not** automatically translated, renamed or merged. Saved
product metadata is recovered from older approved upload drafts when exact stored
entry references exist, without changing item names, prices or categories. Unknown
legacy details stay unknown. The existing duplicate-name review remains available
for manually consolidating legacy names.

Saved receipts show product identity summaries, with receipt text, quantity, discount,
regular total and original scan links under line details. Item price history exposes
the same purchase details. **Receipts → Product families** compares the distinct
products within a family, including purchase counts, total spending, latest line
total, latest normalized price, historical low and known regular-price reference.
Weight, volume and count bases stay separate; missing sizes do not invent unit prices.
Family membership is not a claim of nutritional equivalence. Historical purchases
with the same exact item name can join its unambiguous recorded family.

### Printed receipt time

`purchasedTime` records the printed checkout/receipt time as local `HH:mm`. Printed
seconds are discarded without rounding; scan/file timestamps and timezone guesses
are never used. Missing times remain null. Time is editable in review and visible
on saved purchase/source details. Duplicate warnings show same-minute, different-minute
or unknown-time evidence, but remain warnings rather than proof of duplication.
Store/day grouping is unchanged: multiple source receipts can have different printed
times within one saved store/day receipt.

Original page bytes, raw extraction, reviewed draft and approved-entry references
are retained in PostgreSQL, including after approval or skipping. Back up the database
to back up these originals. The standard CSV/XLSX export contains approved core fields,
not originals or the richer extraction records. Product-family comparisons are available
in the app; hierarchical categories and bank-statement integration are not implemented here.
Deleting/resetting all application data also removes uploads. Treat database backups
as sensitive: receipt scans can contain personal or payment information.

The provider receives the uploaded receipt content. Immediate calls set `store: false`;
this is not a promise of zero provider retention. Batch input files expire after two
days; OpenAI applies its own retention rules to results and other API data. Review
[OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) before
uploading sensitive receipts. Authentication is shared with the rest of Receipt Box;
do not expose an unauthenticated instance, especially one with a paid API key.

`ReceiptExtractor` is the provider boundary. Only OpenAI is implemented; model and
Responses-compatible endpoint are configurable through `RECEIPT_AI_MODEL` and
`OPENAI_BASE_URL`. Gemini or other native APIs require an adapter, not just a different
key. Model capabilities and pricing should be checked before changing models.

## Requirements

- Node.js 26 or Docker
- pnpm 11.18
- PostgreSQL 17

The database role needs permission to connect and create tables and indexes,
which are created automatically on first start.

## Installation

### Complete local Docker stack

Start the app and a database instance:

```sh
docker compose up -d --build
```

Open `http://localhost:3000`.

### Local development

Start only PostgreSQL:

```sh
docker compose up -d postgres
```

Create the local environment file:

```sh
cp .env.example .env
```

Use this connection string in `.env`:

```dotenv
DATABASE_URL=postgres://receiptbox:local-receipt-box-only@127.0.0.1:5432/receiptbox
```

Install the dependencies and start Nuxt:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`.

## Deployment

Use the repository's `compose.yaml` to run the app server and PostgreSQL
database together. It publishes both services on loopback by default; see
[Reverse proxy](#reverse-proxy) to route public traffic to the app.

> **Security note:** Authentication is disabled by default. Do not expose an
> unauthenticated deployment directly to the public internet. Use the
> optional OIDC mode described below, a private network, a VPN, or authentication
> at the reverse proxy.

### Optional OIDC authentication

While not enabled by default, an OIDC provider such as [Pocket ID](https://pocket-id.org/) can be used to auth users.

A user-set `NUXT_SESSION_PASSWORD` is used to seal Receipt Box's
session cookies. This can be generated with `openssl rand -base64 48`, after which it
should be treated as a secret.

Assign the command's output to `NUXT_SESSION_PASSWORD` in `.env`, then set the
OIDC variables on the application container:

```dotenv
AUTH_MODE=oidc
NUXT_SESSION_PASSWORD=replace-with-at-least-32-random-characters
NUXT_OAUTH_OIDC_CLIENT_ID=receipt-box
NUXT_OAUTH_OIDC_CLIENT_SECRET=replace-with-the-oidc-client-secret
NUXT_OAUTH_OIDC_OPENID_CONFIG=https://auth.example.com/application/o/receipt-box/.well-known/openid-configuration
NUXT_OAUTH_OIDC_REDIRECT_URL=https://receiptbox.example.com/receipt-box/auth/oidc
```

Register the exact redirect URL with the OIDC provider. Receipt Box requests
the `openid`, `profile`, and `email` scopes.

When OIDC mode is enabled, all Receipt Box data API routes require auth. The
OIDC callback, session-management endpoint, authentication-status endpoint,
and `/api/health` remain unauthenticated.

## Configuration

The application uses these settings:

| Setting | Applied | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | At container start | Private PostgreSQL connection string used only by the server |
| `DATABASE_SOCKET_PATH` | At container start | Optional full Unix socket filename that overrides the URL host and port |
| `OPENAI_API_KEY` | At container start | Private API key for receipt extraction; never sent to the browser |
| `RECEIPT_AI_PROVIDER` | At container start | Receipt extractor adapter; currently `openai` only |
| `RECEIPT_AI_MODEL` | At container start | Vision and structured-output model, default `gpt-6-luna`; Batch mode also requires Batch support |
| `OPENAI_BASE_URL` | At container start | Optional server-only Responses-compatible API endpoint, default `https://api.openai.com/v1` |
| `AUTH_MODE` | At container start | Optional authentication mode: `disabled` by default or `oidc` |
| `NUXT_SESSION_PASSWORD` | At container start | Secret of at least 32 characters used to seal app session cookies; required for OIDC sign-in |
| `NUXT_OAUTH_OIDC_CLIENT_ID` | At container start | OIDC relying-party client identifier |
| `NUXT_OAUTH_OIDC_CLIENT_SECRET` | At container start | OIDC relying-party client secret |
| `NUXT_OAUTH_OIDC_OPENID_CONFIG` | At container start | Full URL of the provider's OpenID configuration document |
| `NUXT_OAUTH_OIDC_REDIRECT_URL` | At container start | Optional explicit public callback URL; recommended behind a reverse proxy |
| `APP_PORT` | At container start | Host loopback port used to reach the app server |
| `NUXT_APP_BASE_URL` | At image build | Public path where the app is mounted; must start and end with `/` |
| `NUXT_PUBLIC_API_BASE` | At image build | URL used by the browser for API requests; may be a path or full URL |

## Reverse proxy

The Compose setup binds the app server to `127.0.0.1:3000` by default. Configure
your reverse proxy to forward public requests to that address. If the proxy
runs in another container, connect it to a Docker network shared with the app
and forward requests to the app service on port `3000`.

For a deployment under a path prefix such as `/receipt-box/`, build the app
with matching public URL settings:

```dotenv
NUXT_APP_BASE_URL=/receipt-box/
NUXT_PUBLIC_API_BASE=/receipt-box/api
```

These public URL settings are embedded in the app image at build time. Rebuild
the image after changing either setting.

Configure the proxy to forward the `/receipt-box/` path to the app without
stripping the prefix. If `NUXT_PUBLIC_API_BASE` is omitted, it defaults to the
API path under `NUXT_APP_BASE_URL`.

If the reverse proxy exposes the API at the origin root, use:

```dotenv
NUXT_APP_BASE_URL=/receipt-box/
NUXT_PUBLIC_API_BASE=/api
```

In this setup, configure the proxy to forward public `/api/*` requests to the
app's `/receipt-box/api/*` path. To use another API origin, provide a full URL
and allow the app origin in that API's CORS policy.

## Export and backup

**Manage → Import & export** exports the complete history as a single flat CSV or XLSX table with these columns:

`purchase_date`, `item`, `category`, `store`, `package_size`, `package_unit`, `price`, `normalized_price`, `normalized_basis`, `on_sale`, `non_grocery`, and `notes`.

## Development commands

```sh
pnpm dev        # development server
pnpm typecheck  # Vue and TypeScript checks
pnpm build      # production build
pnpm generate   # static client-only route output
pnpm start      # run the production build
```
