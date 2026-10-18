# Deployment and Authentication

## Runtime Requirements

The Docker image runs the Nuxt/Nitro Node.js server. A deployment host should
provide:

- HTTPS and a stable public origin for OIDC callbacks
- PostgreSQL with persistent storage and a backup/restore process
- Runtime secret injection for database, session, OIDC, and model credentials
- Request and response bodies large enough for the configured 20 MiB receipt files
- A trusted deployment path for the provided Dockerfile and image

Receipt originals are stored in S3-compatible object storage (such as Neon Object
Storage) when configured, or in PostgreSQL when object storage is not configured,
rather than the container filesystem. The container filesystem can be ephemeral.
Keep the database and object storage bucket private and back up receipt uploads as
well as structured purchase data. The app uses one shared receipt dataset for every
authenticated account; it is not multi-tenant.

`NUXT_APP_BASE_URL` and `NUXT_PUBLIC_API_BASE` are build-time settings. Other
application settings are read at runtime. If using a path prefix, set the same
prefix in the public URL settings and in the OIDC callback URI.

## OIDC Configuration

Authentication is disabled by default. Do not expose that configuration publicly.
When `AUTH_MODE=oidc`, the app requires all of the following runtime settings:

```dotenv
AUTH_MODE=oidc
NUXT_SESSION_PASSWORD=<random secret of at least 32 characters>
NUXT_OAUTH_OIDC_CLIENT_ID=<web client ID>
NUXT_OAUTH_OIDC_CLIENT_SECRET=<web client secret>
NUXT_OAUTH_OIDC_OPENID_CONFIG=<provider discovery document URL>
NUXT_OAUTH_OIDC_REDIRECT_URL=https://YOUR_HOST/auth/oidc
ALLOWED_EMAILS=user1@example.com,user2@example.com
```

Generate a session secret with `openssl rand -base64 48`. Configure the same
secret on all replicas and keep it stable across deployments. Rotating it signs
out existing sessions. Store it and all provider credentials in the deployment's
secret manager, not in source control or client-side configuration.

The app requests `openid`, `profile`, and `email`. Its server-side callback is
`/auth/oidc` under the configured app base path. Register the exact HTTPS callback
URL with the identity provider. In the provider's web client settings, configure
an authorized redirect URI; a JavaScript origin is not used by this server-side
callback flow.

`ALLOWED_EMAILS` is a comma-separated allowlist of exact email addresses. The app
requires the identity provider to assert a verified email and rejects sign-ins not
on this list. A missing or empty allowlist denies all OIDC users. This is separate
from provider-side tester or audience configuration; for defense in depth, configure
both. Each allowed account can access all receipt data.

### Example: Google Auth Platform

1. Create or select a Google Cloud project in [Google Auth Platform](https://console.cloud.google.com/auth/overview).
2. Configure the app audience. For a small private deployment, External / Testing
   can be restricted to explicitly added test users. Google may show a warning for
   an unverified app in Testing mode. Production publication has separate branding
   and verification requirements.
3. Create a Web application OAuth client and register
   `https://YOUR_HOST/auth/oidc` (including any app path prefix) as an authorized
   redirect URI.
4. Set the client ID and secret, and use this discovery URL:
   `https://accounts.google.com/.well-known/openid-configuration`.
5. Put the verified account emails in `ALLOWED_EMAILS` and test sign-in and sign-out
   for every allowed account.

Google's [OIDC documentation](https://developers.google.com/identity/openid-connect/openid-connect),
[audience settings](https://support.google.com/cloud/answer/15549945), and
[branding guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
describe the provider-side setup and publication requirements.

## Configuration Reference

| Setting | When read | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Runtime | Private PostgreSQL connection string |
| `DATABASE_SOCKET_PATH` | Runtime | Optional PostgreSQL Unix socket path |
| `AUTH_MODE` | Runtime | `disabled` or `oidc`; do not expose an unauthenticated deployment |
| `NUXT_SESSION_PASSWORD` | Runtime | Secret used to seal application session cookies |
| `NUXT_OAUTH_OIDC_CLIENT_ID` | Runtime | OIDC web client identifier |
| `NUXT_OAUTH_OIDC_CLIENT_SECRET` | Runtime | OIDC web client secret |
| `NUXT_OAUTH_OIDC_OPENID_CONFIG` | Runtime | OIDC discovery document URL |
| `NUXT_OAUTH_OIDC_REDIRECT_URL` | Runtime | Explicit callback URL; recommended behind a proxy |
| `ALLOWED_EMAILS` | Runtime | Comma-separated exact allowlist of verified OIDC emails |
| `OPENAI_API_KEY` | Runtime | Optional server-only key for receipt extraction |
| `RECEIPT_AI_PROVIDER` | Runtime | Currently `openai` |
| `RECEIPT_AI_MODEL` | Runtime | Vision and structured-output model; default `gpt-6-luna` |
| `OPENAI_BASE_URL` | Runtime | Optional Responses-compatible provider endpoint |
| `AWS_ENDPOINT_URL_S3` | Runtime | Optional S3-compatible endpoint URL (e.g. Neon Object Storage branch endpoint) |
| `AWS_ACCESS_KEY_ID` | Runtime | Optional S3 Access Key ID (`token_id` in Neon Object Storage) |
| `AWS_SECRET_ACCESS_KEY` | Runtime | Optional S3 Secret Access Key (`s3_secret_access_key` in Neon Object Storage) |
| `AWS_REGION` | Runtime | Optional S3 region; inferred from Neon endpoint URL when omitted |
| `RECEIPT_STORAGE_BUCKET` | Runtime | Optional S3 bucket name for receipt scans; default `receipt-uploads` |
| `NUXT_APP_BASE_URL` | Build time | Public app path, starting and ending with `/` |
| `NUXT_PUBLIC_API_BASE` | Build time | Public API root; defaults under the app path |

## Operational Checklist

- Use a private PostgreSQL endpoint where the platform supports it; otherwise use
  TLS and a least-privileged database role.
- Set instance and database connection limits so autoscaling cannot overwhelm
  PostgreSQL. Keep app and database regions close together.
- Allow the identity provider callback to reach the app. Do not add a second
  platform-level authentication gate unless its interaction with OIDC is configured.
- Use a maximum upload size compatible with the hosting platform. If the host has
  lower request/response limits, implement direct signed object-storage uploads and
  downloads before deploying, or lower the application file limit.
- Configure backups, verify restoration, monitor database storage, and add billing
  alerts before importing a large archive.
- Test login, denied unlisted users, sign-out, file uploads, original-file retrieval,
  and the receipt queue after deployment.