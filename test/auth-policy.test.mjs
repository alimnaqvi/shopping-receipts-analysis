import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  getAuthMode,
  isAllowedOidcUser,
  missingOidcEnvironment,
  parseAllowedEmails,
  parseAuthMode,
  requiresApiAuthentication
} from '../server/utils/auth-policy.ts'

describe('parseAuthMode', () => {
  test('defaults to disabled and accepts normalized supported values', () => {
    assert.equal(parseAuthMode(undefined), 'disabled')
    assert.equal(parseAuthMode(''), 'disabled')
    assert.equal(parseAuthMode('  DISABLED '), 'disabled')
    assert.equal(parseAuthMode(' OIDC '), 'oidc')
  })

  test('rejects unsupported modes', () => {
    assert.throws(() => parseAuthMode('proxy'), /AUTH_MODE must be "disabled" or "oidc"/)
  })

  test('reads the process environment', () => {
    const previous = process.env.AUTH_MODE
    process.env.AUTH_MODE = 'oidc'
    try {
      assert.equal(getAuthMode(), 'oidc')
    } finally {
      if (previous === undefined) delete process.env.AUTH_MODE
      else process.env.AUTH_MODE = previous
    }
  })
})

describe('missingOidcEnvironment', () => {
  test('reports every missing or blank OIDC setting', () => {
    assert.deepEqual(missingOidcEnvironment({
      NUXT_SESSION_PASSWORD: ' ',
      NUXT_OAUTH_OIDC_CLIENT_ID: 'client'
    }), [
      'NUXT_SESSION_PASSWORD',
      'NUXT_OAUTH_OIDC_CLIENT_SECRET',
      'NUXT_OAUTH_OIDC_OPENID_CONFIG'
    ])
  })

  test('accepts a complete configuration', () => {
    assert.deepEqual(missingOidcEnvironment({
      NUXT_SESSION_PASSWORD: 'a secure session password',
      NUXT_OAUTH_OIDC_CLIENT_ID: 'client',
      NUXT_OAUTH_OIDC_CLIENT_SECRET: 'secret',
      NUXT_OAUTH_OIDC_OPENID_CONFIG: 'https://auth.example.test/.well-known/openid-configuration',
      ALLOWED_EMAILS: 'user1@example.com,user2@example.com'
    }), [])
  })

  test('uses the process environment by default', () => {
    assert.ok(Array.isArray(missingOidcEnvironment()))
  })
})

describe('OIDC email authorization', () => {
  test('normalizes configured email addresses', () => {
    assert.deepEqual([...parseAllowedEmails(' User1@Example.com, ,user2@example.com ')], [
      'user1@example.com',
      'user2@example.com'
    ])
    assert.deepEqual([...parseAllowedEmails(undefined)], [])
  })

  test('allows only verified users whose email is explicitly listed', () => {
    const environment = { ALLOWED_EMAILS: ' User1@example.com, user2@example.com ' }
    assert.equal(isAllowedOidcUser({ email: 'user1@example.com', email_verified: true }, environment), true)
    assert.equal(isAllowedOidcUser({ email: 'USER2@example.com', email_verified: true }, environment), true)
    assert.equal(isAllowedOidcUser({ email: 'user3@example.com', email_verified: true }, environment), false)
    assert.equal(isAllowedOidcUser({ email: 'user1@example.com', email_verified: false }, environment), false)
    assert.equal(isAllowedOidcUser({ email: 'user1@example.com', email_verified: 'true' }, environment), false)
    assert.equal(isAllowedOidcUser({ email_verified: true }, environment), false)
    assert.equal(isAllowedOidcUser({ email: 123, email_verified: true }, environment), false)
    assert.equal(isAllowedOidcUser({ email: 'user1@example.com', email_verified: true }, {}), false)
    assert.equal(isAllowedOidcUser({ email: 'user1@example.com', email_verified: true }, { ALLOWED_EMAILS: ' , ' }), false)
  })
})

describe('requiresApiAuthentication', () => {
  test('protects API roots and application endpoints', () => {
    assert.equal(requiresApiAuthentication('/api'), true)
    assert.equal(requiresApiAuthentication('/api/entries'), true)
    assert.equal(requiresApiAuthentication('/api/import?dry-run=true'), true)
    assert.equal(requiresApiAuthentication('/receipt-box/api/receipts', '/receipt-box/'), true)
  })

  test('allows only the authentication support and health endpoints', () => {
    assert.equal(requiresApiAuthentication('/api/health'), false)
    assert.equal(requiresApiAuthentication('/api/auth/config'), false)
    assert.equal(requiresApiAuthentication('/api/_auth'), false)
    assert.equal(requiresApiAuthentication('/api/_auth/session'), false)
    assert.equal(requiresApiAuthentication('/receipt-box/api/health', '/receipt-box/'), false)
  })

  test('ignores pages and paths outside the configured base URL', () => {
    assert.equal(requiresApiAuthentication('/'), false)
    assert.equal(requiresApiAuthentication('/login'), false)
    assert.equal(requiresApiAuthentication('/receipt-box', '/receipt-box/'), false)
    assert.equal(requiresApiAuthentication('/another/api/entries', '/receipt-box/'), false)
  })
})
