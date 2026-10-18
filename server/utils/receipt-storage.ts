import { createHash, createHmac } from 'node:crypto'

export type ReceiptObjectStore = {
  bucket: string
  put: (key: string, bytes: Buffer, mime: string) => Promise<void>
  get: (key: string) => Promise<Buffer>
  delete: (keys: string[]) => Promise<void>
}

export function receiptStorageKey(id: string, mime: string) {
  const extension = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'
  return `receipts/${id}.${extension}`
}

function sha256Hex(data: string | Uint8Array) {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: string | Buffer, data: string) {
  return createHmac('sha256', key).update(data).digest()
}

function inferRegion(hostname: string) {
  const match = hostname.match(/\.([a-z]{2}-[a-z]+-\d+)\.aws\.neon\.tech$/i)
  return match ? match[1]!.toLowerCase() : 'us-east-1'
}

function encodeObjectKey(key: string) {
  const parts = key.split('/').filter(Boolean)
  if (!parts.length) throw new Error('Receipt object storage key must not be empty')
  return parts.map(encodeURIComponent).join('/')
}

export function createReceiptObjectStore(
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date()
): ReceiptObjectStore | null {
  const endpointRaw = env.AWS_ENDPOINT_URL_S3?.trim()
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim()
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim()
  const bucketRaw = env.RECEIPT_STORAGE_BUCKET?.trim()

  if (!endpointRaw && !accessKeyId && !secretAccessKey && !bucketRaw) return null
  if (!endpointRaw || !accessKeyId || !secretAccessKey) {
    throw new Error('Set AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY to use receipt object storage')
  }

  let parsedEndpoint: URL
  try {
    parsedEndpoint = new URL(endpointRaw)
  } catch {
    throw new Error('AWS_ENDPOINT_URL_S3 must be a valid HTTP or HTTPS URL')
  }
  if (parsedEndpoint.protocol !== 'https:' && parsedEndpoint.protocol !== 'http:') {
    throw new Error('AWS_ENDPOINT_URL_S3 must use HTTP or HTTPS')
  }

  const endpoint = endpointRaw.replace(/\/+$/, '')
  const region = env.AWS_REGION?.trim() || inferRegion(parsedEndpoint.hostname)
  const bucket = bucketRaw || 'receipt-uploads'
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('RECEIPT_STORAGE_BUCKET must be a valid S3 bucket name')
  }

  async function signedRequest(method: 'PUT' | 'GET' | 'DELETE', path: string, body: Uint8Array = new Uint8Array(), contentType?: string) {
    const url = new URL(`${endpoint}${path}`)
    const amzDate = now().toISOString().replace(/[-:]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const payloadHash = sha256Hex(body)
    const headerEntries: Array<[string, string]> = [
      ['host', url.host],
      ['x-amz-content-sha256', payloadHash],
      ['x-amz-date', amzDate]
    ]
    if (contentType) headerEntries.unshift(['content-type', contentType])

    const canonicalHeaders = headerEntries.map(([name, value]) => `${name}:${value}\n`).join('')
    const signedHeaders = headerEntries.map(([name]) => name).join(';')
    const canonicalRequest = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
    const scope = `${dateStamp}/${region}/s3/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), 's3'), 'aws4_request')
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

    const headers: Record<string, string> = {
      'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    }
    if (contentType) headers['Content-Type'] = contentType

    return fetcher(url.toString(), {
      method,
      headers,
      body: method === 'PUT' && body.byteLength ? Buffer.from(body) : undefined,
      signal: AbortSignal.timeout(30000)
    })
  }

  return {
    bucket,
    async put(key, bytes, mime) {
      const objectPath = `/${encodeURIComponent(bucket)}/${encodeObjectKey(key)}`
      let response = await signedRequest('PUT', objectPath, bytes, mime)
      if (response.status === 404) {
        const createResponse = await signedRequest('PUT', `/${encodeURIComponent(bucket)}`)
        if (!createResponse.ok && createResponse.status !== 409) {
          throw new Error(`Receipt object storage bucket creation failed (HTTP ${createResponse.status})`)
        }
        response = await signedRequest('PUT', objectPath, bytes, mime)
      }
      if (!response.ok) throw new Error(`Receipt object storage upload failed (HTTP ${response.status})`)
    },
    async get(key) {
      const objectPath = `/${encodeURIComponent(bucket)}/${encodeObjectKey(key)}`
      const response = await signedRequest('GET', objectPath)
      if (response.status === 404) {
        throw Object.assign(new Error('Receipt scan file not found in object storage'), {
          statusCode: 404,
          statusMessage: 'Receipt scan file not found in object storage'
        })
      }
      if (!response.ok) throw new Error(`Receipt object storage download failed (HTTP ${response.status})`)
      return Buffer.from(await response.arrayBuffer())
    },
    async delete(keys) {
      for (const key of new Set(keys.filter(Boolean))) {
        const objectPath = `/${encodeURIComponent(bucket)}/${encodeObjectKey(key)}`
        const response = await signedRequest('DELETE', objectPath)
        if (!response.ok && response.status !== 404) {
          throw new Error(`Receipt object storage delete failed (HTTP ${response.status})`)
        }
      }
    }
  }
}

