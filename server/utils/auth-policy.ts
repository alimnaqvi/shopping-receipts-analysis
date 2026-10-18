export type ReceiptBoxAuthMode = 'disabled' | 'oidc'

const oidcEnvironmentKeys = [
  'NUXT_SESSION_PASSWORD',
  'NUXT_OAUTH_OIDC_CLIENT_ID',
  'NUXT_OAUTH_OIDC_CLIENT_SECRET',
  'NUXT_OAUTH_OIDC_OPENID_CONFIG'
] as const

export function parseAllowedEmails(value: string | undefined): Set<string> {
  return new Set((value ?? '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean))
}

export function isAllowedOidcUser(
  user: { email?: unknown; email_verified?: unknown },
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  if (user.email_verified !== true || typeof user.email !== 'string') return false
  return parseAllowedEmails(environment.ALLOWED_EMAILS).has(user.email.trim().toLowerCase())
}

export function parseAuthMode(value: string | undefined): ReceiptBoxAuthMode {
  const mode = value?.trim().toLowerCase() || 'disabled'
  if (mode === 'disabled' || mode === 'oidc') return mode
  throw new Error(`AUTH_MODE must be "disabled" or "oidc"; received "${value}"`)
}

export function getAuthMode(): ReceiptBoxAuthMode {
  return parseAuthMode(process.env.AUTH_MODE)
}

export function missingOidcEnvironment(environment: NodeJS.ProcessEnv = process.env): string[] {
  return oidcEnvironmentKeys.filter(key => !environment[key]?.trim())
}

export function requiresApiAuthentication(path: string, appBaseURL = '/'): boolean {
  const pathname = path.split('?', 1)[0] || '/'
  const basePath = appBaseURL === '/' ? '' : appBaseURL.replace(/\/$/, '')
  const appPath = basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))
    ? pathname.slice(basePath.length) || '/'
    : pathname

  if (appPath === '/api/health' || appPath === '/api/auth/config') return false
  if (appPath === '/api/_auth' || appPath.startsWith('/api/_auth/')) return false
  return appPath === '/api' || appPath.startsWith('/api/')
}
