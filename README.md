# Shopping Receipt Analysis

A self-hosted application for grocery receipt history, product-family price
comparison, and spending analysis.

This project is a fork of [Receipt Box](https://github.com/davidski/receipt-box).
It retains the upstream MIT license and receipt-entry foundation, with additions
for receipt image/PDF extraction, product identity, and purchase-level metadata.

## Features

- Searchable, editable grocery receipt history and normalized price comparisons
- Spending highlights by period, store, category, and item
- Receipt image and PDF uploads with extraction, correction, and approval
- Product families for comparing distinct brands and variants
- CSV and XLSX import and export
- Self-hosted PostgreSQL storage and optional OIDC authentication

## Quick Start

Requirements: Node.js 26, pnpm 12, and PostgreSQL 17, or Docker with Compose.

To run the app and local database:

```sh
cp .env.example .env
```

Set `NUXT_SESSION_PASSWORD` in `.env` (for example, generate one with
`openssl rand -base64 48`). It is required for session cookies even when OIDC is
disabled. Then start the stack:

```sh
docker compose up -d --build
```

Open <http://localhost:3000>. The included Compose database credentials are for
local development only; change them before using Compose on a shared machine.

For local Nuxt development, start PostgreSQL with `docker compose up -d postgres`,
set `DATABASE_URL` in `.env` to the local database connection string, and run:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Receipt extraction is optional. Set `OPENAI_API_KEY` on the server to enable it.

## Deployment

Deploy the provided Docker image to a host that supports a Node.js container,
HTTPS, persistent PostgreSQL, runtime secrets, and request/response bodies up to
20 MiB. Receipt originals are stored in PostgreSQL. Back up the database and keep
it private. Configure OIDC before exposing the service publicly; without OIDC,
anyone who can reach the app can access its data.

See [deployment and authentication](docs/deployment.md) and
[receipt upload behavior](docs/receipt-uploads.md).

All authenticated users share the same receipt history. OIDC sign-in does not
provide per-user data isolation.

## License

MIT. See [LICENSE](LICENSE) and the upstream [Receipt Box project](https://github.com/davidski/receipt-box).