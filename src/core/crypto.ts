/**
 * Client-side End-to-End Encryption (E2EE) helpers using WebCrypto (AES-256-GCM + HMAC-SHA256).
 * Executed inside the Manifest V3 Background Service Worker so content scripts never see the key.
 */

export interface EncryptedEnvelopePayload {
  data: any;
  meta: {
    namespace?: string | null;
    key?: string | null;
    type?: string | null;
    resources?: string[] | null;
  };
}

export interface EncryptedJsonBlob {
  __mb_enc: 'v1';
  iv: string;
  ct: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateDefaultEncryptionSecret(): string {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  return `mb_e2ee_${bytesToHex(random)}`;
}

async function deriveKeys(secret: string): Promise<{ aesKey: CryptoKey; hmacKey: CryptoKey }> {
  const rawMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey', 'deriveBits']
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: textEncoder.encode('MonkeyBrain::E2EE::AES-GCM::v1'),
      iterations: 10000,
      hash: 'SHA-256',
    },
    rawMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  const hmacBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: textEncoder.encode('MonkeyBrain::E2EE::HMAC-SHA256::v1'),
      iterations: 10000,
      hash: 'SHA-256',
    },
    rawMaterial,
    256
  );

  const hmacKey = await crypto.subtle.importKey(
    'raw',
    hmacBits,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  return { aesKey, hmacKey };
}

/**
 * Deterministically hashes a metadata identifier (namespace, key, type, or resource tag)
 * so indexed equality queries continue to work on the server without revealing plaintext metadata.
 */
export async function hashIdentifier(
  prefix: 'ns' | 'k' | 't' | 'r',
  plaintext: string,
  secret: string
): Promise<string> {
  const { hmacKey } = await deriveKeys(secret);
  const sig = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    textEncoder.encode(`${prefix}:${plaintext}`)
  );
  const hex = bytesToHex(new Uint8Array(sig)).slice(0, 32);
  return `enc-${prefix}:${hex}`;
}

export async function encryptEnvelope(
  payload: EncryptedEnvelopePayload,
  secret: string
): Promise<EncryptedJsonBlob> {
  const { aesKey } = await deriveKeys(secret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const encoded = textEncoder.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);

  return {
    __mb_enc: 'v1',
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export function isEncryptedJsonBlob(val: any): val is EncryptedJsonBlob {
  return (
    Boolean(val) &&
    typeof val === 'object' &&
    val.__mb_enc === 'v1' &&
    typeof val.iv === 'string' &&
    typeof val.ct === 'string'
  );
}

export async function decryptEnvelope(
  blob: any,
  secret: string
): Promise<EncryptedEnvelopePayload | null> {
  if (!isEncryptedJsonBlob(blob)) return null;

  try {
    const { aesKey } = await deriveKeys(secret);
    const iv = base64ToBytes(blob.iv);
    const ct = base64ToBytes(blob.ct);
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      aesKey,
      ct as unknown as BufferSource
    );
    const jsonText = textDecoder.decode(decryptedBuffer);
    return JSON.parse(jsonText) as EncryptedEnvelopePayload;
  } catch {
    return null;
  }
}

/**
 * Transforms an outgoing `/api/documents*` request body when `encrypted: true`.
 */
export async function encryptOutgoingRequestBody(
  path: string,
  body: any,
  secret: string
): Promise<any> {
  if (!body || typeof body !== 'object') return body;
  const clone = { ...body };

  const origNamespace = typeof clone.namespace === 'string' ? clone.namespace : null;
  const origKey = typeof clone.key === 'string' ? clone.key : null;
  const origType = typeof clone.type === 'string' ? clone.type : null;
  const origResources = Array.isArray(clone.resources) ? [...clone.resources] : null;

  if (origNamespace) {
    clone.namespace = await hashIdentifier('ns', origNamespace, secret);
  }
  if (origKey) {
    clone.key = await hashIdentifier('k', origKey, secret);
  }
  if (origType) {
    clone.type = await hashIdentifier('t', origType, secret);
  }
  if (typeof clone.resource === 'string' && clone.resource) {
    clone.resource = await hashIdentifier('r', clone.resource, secret);
  }
  if (origResources) {
    clone.resources = await Promise.all(
      origResources.map((r: string) => hashIdentifier('r', String(r), secret))
    );
  }

  // Encrypt `data` on create / upsert / patch
  if ('data' in clone && clone.data !== undefined && !path.endsWith('/query')) {
    clone.data = await encryptEnvelope(
      {
        data: clone.data,
        meta: {
          namespace: origNamespace,
          key: origKey,
          type: origType,
          resources: origResources,
        },
      },
      secret
    );
    // Encrypted blobs cannot be merged server-side by Postgres JSONB
    if ('mergeData' in clone) {
      clone.mergeData = false;
    }
  }

  return clone;
}

/**
 * Decrypts a single MonkeyBrainDocument or a PagedDocuments response returned from `/api/documents*`.
 */
export async function decryptIncomingResponseData(
  parsed: any,
  secret: string,
  skipDecrypt = false
): Promise<any> {
  if (!parsed || typeof parsed !== 'object') return parsed;

  const decryptSingleDoc = async (doc: any) => {
    if (!doc || typeof doc !== 'object' || !('data' in doc)) return doc;
    if (!isEncryptedJsonBlob(doc.data)) return doc;

    const unlocked = await decryptEnvelope(doc.data, secret);
    if (!unlocked) return doc;

    if (skipDecrypt) {
      return {
        ...doc,
        _plaintextNamespace: unlocked.meta?.namespace ?? doc.namespace,
      };
    }

    return {
      ...doc,
      namespace: unlocked.meta?.namespace ?? doc.namespace,
      key: unlocked.meta?.key ?? doc.key,
      type: unlocked.meta?.type ?? doc.type,
      resources: unlocked.meta?.resources ?? doc.resources,
      data: unlocked.data,
      _plaintextNamespace: unlocked.meta?.namespace ?? doc.namespace,
    };
  };

  if (Array.isArray(parsed.items)) {
    const decryptedItems = await Promise.all(parsed.items.map(decryptSingleDoc));
    return {
      ...parsed,
      items: decryptedItems,
    };
  }

  if ('id' in parsed && 'data' in parsed) {
    return decryptSingleDoc(parsed);
  }

  return parsed;
}
