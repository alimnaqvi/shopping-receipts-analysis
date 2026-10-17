# Shopping Receipt Analysis

A private, self-hosted app for analyzing grocery receipts, normalizing prices,
and comparing distinct products within a family.

This project is a fork of [Receipt Box](https://github.com/davidski/receipt-box).
It retains the upstream MIT license and receipt-entry foundation, with substantial
changes for multimodal receipt extraction, German-to-English product identity,
product families, and purchase-level metadata.

## Disclaimer

Shopping Receipt Analysis is a personal project, developed with AI assistance.
Review the code, configuration, security assumptions, and have a backup plan before
relying on it.

## License

Shopping Receipt Analysis is licensed under the [MIT License](LICENSE).

## Overview

Shopping Receipt Analysis is a self-hosted web app with a browser interface and an
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
Shopping Receipt Analysis groups purchases by **store and date**; explicitly approving a same-store,
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
uploading sensitive receipts. Authentication is shared with the rest of Shopping Receipt Analysis;
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

### Recommendation: Cloud Run + Neon

For a small private deployment, I recommend the existing Docker image on **Google
Cloud Run** with **Neon Postgres**:

- Cloud Run supports this container directly, scales to zero, and has a usage-based
  free tier. Start with request-based billing, zero minimum instances, and a small
  maximum instance count; check the [current pricing](https://cloud.google.com/run/pricing)
  for the region you choose.
- Neon is managed Postgres with automatic scale-to-zero. Its Free plan currently
  includes 1 GB of Postgres storage per project and 100 compute-hours/month; those
  limits can suspend writes or compute when exhausted. For a real archive of scans,
  monitor storage and arrange backups. The usage-based Launch plan has no monthly
  minimum and offers longer restore history and scheduled snapshots. See
  [Neon plans](https://neon.com/docs/introduction/plans).
- Choose Cloud Run and Neon regions close to each other and the users. The services
  are in different clouds, so database traffic uses their public endpoints and adds
  some network latency/egress. Use Neon's pooled Postgres URL and set a conservative
  Cloud Run maximum instance count to avoid exhausting database connections.
- The app stores original receipt pages in PostgreSQL, not the container filesystem.
  Cloud Run's filesystem is ephemeral, but it does not currently hold durable app data.
  Google Cloud Storage is optional today; integrating it for receipts or backups would
  require a deliberate storage/backup workflow. Do not copy scans into an unencrypted,
  publicly readable bucket.
- The Docker image listens on port `3000`; set the Cloud Run container port to `3000`.
	Set **minimum instances to zero**, a small maximum (for example, `2`), and
	request-based billing to keep an occasional personal app economical. Allow public
	invocation at the Cloud Run IAM layer because browsers must reach Google sign-in;
	the app then authenticates its data APIs with OIDC. Keep the Cloud Run service
	identity least-privileged and use Secret Manager for all credentials.

Cloud SQL Postgres keeps compute and the app in one cloud and can provide private
networking, but the database instance has an ongoing hourly cost even while the app
scales to zero. Compare the regional [Cloud SQL pricing](https://cloud.google.com/sql/pricing)
with Neon before choosing it. Google's pricing page currently lists a US-central
shared-core `db-f1-micro` at about $0.0105/hour for compute alone; storage, backups,
networking, and regional prices are additional, and that shared-core tier has no SLA.

**Vercel + Neon** is also possible, but not with the current upload path unchanged.
Vercel Functions currently cap request and response bodies at **4.5 MB**, while this
app accepts files up to **20 MiB**. Most larger scans would fail before reaching the
upload handler. To use Vercel, either limit all accepted uploads to less than the
platform cap, or first implement direct-to-object-storage uploads and downloads
(for example, signed Cloud Storage or Vercel Blob URLs) and store object references
rather than sending receipt contents through function request/response bodies.
Vercel's function filesystem is read-only apart
from temporary scratch space, but this app already stores originals in Postgres.
See [Vercel Function limits](https://vercel.com/docs/functions/limitations) and
[runtime filesystem behavior](https://vercel.com/docs/functions/runtimes#file-system-support).

### Google OIDC setup

The app uses OIDC to sign users in; it does **not** use Google Cloud IAM to authorize
each app request. The Cloud Run service itself must accept public HTTP requests so a
browser can reach the login page and OIDC callback. Set Cloud Run to allow public
invocation, then let the app's OIDC middleware protect its data APIs. Do not select
Cloud Run "Require authentication" / IAM-only access for this setup; that would block
the browser before app sign-in. HTTPS is terminated by Cloud Run.

For a personal or household app, Google's **External / Testing** audience is a simple
way to restrict sign-in to specific Google accounts without publishing the OAuth app:

1. Choose the permanent production URL first: preferably a custom HTTPS domain, or
	the stable Cloud Run service URL. Preview URLs are not a good OAuth callback target.
2. In [Google Auth Platform](https://console.cloud.google.com/auth/overview), create
	or select a project. Configure the app name and support email. Set the audience
	to **External** (personal Google accounts are not in a Google Workspace
	organization). Leave publishing status at **Testing** and add your own Google
	account and your partner's account as test users. Testing mode restricts who can
	authorize the app; Google can show an unverified-app warning. Google documents a
	lifetime 100-user cap for unapproved sensitive/restricted scopes. This app requests
	only `openid`, `profile`, and `email`, not Gmail/Drive access. The app does not
	request offline access or Google API refresh tokens.
3. Under **Clients**, create an OAuth client of type **Web application**. Register
	this exact authorized redirect URI, substituting your production host:
	`https://YOUR_HOST/auth/oidc`
	For a path-prefixed app, include the prefix, for example
	`https://YOUR_HOST/shopping-receipts-analysis/auth/oidc`. Scheme, host, path,
	and trailing slash must match exactly. A JavaScript origin is not used by this
	server-side callback; add `https://YOUR_HOST` only if the console requires it.
4. Copy the client ID and client secret when Google creates them. Google only shows
	a new client secret once; save it directly into your deployment's secret manager,
	never into Git or a browser-visible variable.
5. Set these **runtime** environment variables on the app service:

	```dotenv
	AUTH_MODE=oidc
	NUXT_SESSION_PASSWORD=<random secret of at least 32 characters>
	NUXT_OAUTH_OIDC_CLIENT_ID=<Google client ID>
	NUXT_OAUTH_OIDC_CLIENT_SECRET=<Google client secret>
	NUXT_OAUTH_OIDC_OPENID_CONFIG=https://accounts.google.com/.well-known/openid-configuration
	NUXT_OAUTH_OIDC_REDIRECT_URL=https://YOUR_HOST/auth/oidc
	```

	Generate the session secret locally with `openssl rand -base64 48`. Use the
	path-prefixed callback URL in both Google and the environment if applicable.
	Keep the same session password across all instances and normal deployments;
	rotating it signs out existing sessions. For Cloud Run, put the session password,
	client secret, database URL, and OpenAI key in Secret Manager and grant the
	service identity access only to those secrets.
6. Redeploy and test sign-in and sign-out with **both** accounts. Also verify that
	opening a data API while signed out returns an authentication error. Configure
	cost alerts and a database backup before importing the full receipt archive.

If you later switch the OAuth app from Testing to Production, external Google
accounts can generally authorize it. Production app branding may require a verified
domain, a public app home page and privacy policy, and Google brand verification.
That is unnecessary for a couple of known household users in Testing mode.

### Cloud Run deployment outline

1. Enable Cloud Run, Artifact Registry, and Secret Manager in your Google Cloud project.
	Build the existing [Dockerfile](Dockerfile) and push its image to Artifact Registry.
2. Create a Cloud Run service in a European region near the Neon database. Set its
	container port to `3000`, request-based billing, minimum instances `0`, and a
	conservative maximum. Allow public invocation at the platform layer as described
	above; do not put the Google OIDC callback behind Cloud Run IAM authentication.
3. Create a Neon Postgres project in a nearby region. Put its TLS connection URL in
	Secret Manager. Prefer Neon's pooled connection URL, and configure spend alerts
	on a paid plan. The receipt scans are stored in Postgres too, so watch the database
	storage quota and include scans in your backup plan.
4. Add `OPENAI_API_KEY`, `NUXT_SESSION_PASSWORD`, `NUXT_OAUTH_OIDC_CLIENT_SECRET`,
	and `DATABASE_URL` as Secret Manager references on Cloud Run. Set `AUTH_MODE=oidc`,
	`RECEIPT_AI_PROVIDER=openai`, `NUXT_OAUTH_OIDC_CLIENT_ID`,
	`NUXT_OAUTH_OIDC_OPENID_CONFIG`, and the exact callback URL as runtime environment
	variables. Grant the Cloud Run service identity access only to the four secrets.
5. After the first deploy, copy the stable `run.app` service URL (or bind your custom
	domain), add `https://HOST/auth/oidc` as an authorized redirect URI in Google, then
	set the same URL as `NUXT_OAUTH_OIDC_REDIRECT_URL` and deploy a new revision.
	If you know your custom domain beforehand, register that callback before deploying.
6. Confirm signed-out API calls are rejected, sign in with each household test account,
	upload a scan larger than 4.5 MB, and verify that the original image/PDF is still
	available after a new revision. Create and test a database backup before importing
	the full archive.

### One deployment or two?

OIDC answers **who signed in**; the app currently does not partition receipts by
user. All authenticated accounts on a deployment can read, change, export, and delete
the same receipt history and uploaded scans. Only the backfill-prompt preference is
per-user. Google Testing users are allowed into the deployment, not into separate
private datasets. There is no app-level email allowlist or household role model.

For you and your partner to manage one shared household history, use **one deployment**
and add both accounts as test users. For private, independent histories, use **two
deployments with two separate databases** (and separate storage/credentials); setting
two app URLs against one database would not isolate the data. Adding true per-user
isolation to one deployment would require a data-model and authorization migration,
not just another OIDC setting.

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

For a deployment under a path prefix such as `/shopping-receipts-analysis/`, build the app
with matching public URL settings:

```dotenv
NUXT_APP_BASE_URL=/shopping-receipts-analysis/
NUXT_PUBLIC_API_BASE=/shopping-receipts-analysis/api
```

These public URL settings are embedded in the app image at build time. Rebuild
the image after changing either setting.

Configure the proxy to forward the `/shopping-receipts-analysis/` path to the app without
stripping the prefix. If `NUXT_PUBLIC_API_BASE` is omitted, it defaults to the
API path under `NUXT_APP_BASE_URL`.

If the reverse proxy exposes the API at the origin root, use:

```dotenv
NUXT_APP_BASE_URL=/shopping-receipts-analysis/
NUXT_PUBLIC_API_BASE=/api
```

In this setup, configure the proxy to forward public `/api/*` requests to the
app's `/shopping-receipts-analysis/api/*` path. To use another API origin, provide a full URL
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
