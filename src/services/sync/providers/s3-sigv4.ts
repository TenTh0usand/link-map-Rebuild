import { strToU8 } from 'fflate';

import { sha256Hex } from '../../../core/sync-crypto';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}

function bytesToHex(bytes: Uint8Array): string {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i]!.toString(16).padStart(2, '0');
    }
    return hex;
}

function encodeRfc3986(str: string): string {
    return encodeURIComponent(str).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

function safeDecodeURIComponent(seg: string): string {
    try {
        return decodeURIComponent(seg);
    } catch {
        return seg;
    }
}

export function encodeS3UriPath(path: string): string {
    const trimmed = path.startsWith('/') ? path : `/${path}`;
    const segments = trimmed.split('/');
    return segments.map((s) => encodeRfc3986(safeDecodeURIComponent(s))).join('/') || '/';
}

export function buildS3ObjectUrl(config: {
    endpoint: string;
    bucket: string;
    key: string;
    forcePathStyle?: boolean;
}): URL {
    let url: URL;
    try {
        url = new URL(config.endpoint.trim());
    } catch {
        throw new Error(`Invalid S3/R2 endpoint URL: ${config.endpoint}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Unsupported endpoint protocol "${url.protocol}"`);
    }

    const bucket = config.bucket.trim();
    if (!bucket) {
        throw new Error('Bucket name is required.');
    }

    const basePath = url.pathname.replace(/\/+$/, '');
    const keyParts = config.key
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => encodeRfc3986(s))
        .join('/');

    if (config.forcePathStyle !== false) {
        const encodedBucket = encodeRfc3986(bucket);
        url.pathname = keyParts
            ? `${basePath}/${encodedBucket}/${keyParts}`
            : `${basePath}/${encodedBucket}`;
    } else {
        url.hostname = `${bucket}.${url.hostname}`;
        url.pathname = keyParts ? `${basePath}/${keyParts}` : basePath || '/';
    }

    return url;
}

function toAmzDates(date: Date): { amzDate: string; dateStamp: string } {
    const pad = (n: number) => String(n).padStart(2, '0');
    const year = date.getUTCFullYear();
    const month = pad(date.getUTCMonth() + 1);
    const day = pad(date.getUTCDate());
    const hour = pad(date.getUTCHours());
    const min = pad(date.getUTCMinutes());
    const sec = pad(date.getUTCSeconds());
    const dateStamp = `${year}${month}${day}`;
    return {
        dateStamp,
        amzDate: `${dateStamp}T${hour}${min}${sec}Z`,
    };
}

function buildCanonicalQueryString(url: URL): string {
    const entries: Array<[string, string]> = [];
    url.searchParams.forEach((value, key) => {
        entries.push([encodeRfc3986(key), encodeRfc3986(value)]);
    });
    entries.sort((a, b) => {
        if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
        return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
    });
    return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error('Web Crypto API is required for AWS SigV4 signing.');
    }
    const cryptoKey = await subtle.importKey(
        'raw',
        toArrayBuffer(key),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await subtle.sign('HMAC', cryptoKey, toArrayBuffer(strToU8(message)));
    return new Uint8Array(sig);
}

export interface SignS3RequestParams {
    method: string;
    url: URL;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    body?: Uint8Array | string;
    contentType?: string;
    now?: Date;
    service?: string;
}

export interface SignedS3Request {
    /** Headers safe for browser fetch() (omits Host header while keeping it in SignedHeaders). */
    headers: Record<string, string>;
    amzDate: string;
    payloadHash: string;
    canonicalRequest: string;
    stringToSign: string;
    authorization: string;
}

export async function signS3Request(params: SignS3RequestParams): Promise<SignedS3Request> {
    const accessKeyId = params.accessKeyId.trim();
    const secretAccessKey = params.secretAccessKey.trim();
    if (!accessKeyId || !secretAccessKey) {
        throw new Error('Access Key ID and Secret Access Key are required.');
    }

    const region = params.region.trim() || 'auto';
    const service = params.service ?? 's3';
    const method = params.method.toUpperCase();
    const { amzDate, dateStamp } = toAmzDates(params.now ?? new Date());
    const payloadHash = await sha256Hex(params.body ?? '');

    const signingHeaders: Record<string, string> = {
        host: params.url.host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
    };
    if (params.contentType) {
        signingHeaders['content-type'] = params.contentType;
    }

    const sortedHeaderNames = Object.keys(signingHeaders).sort();
    const canonicalHeaders = sortedHeaderNames
        .map((name) => `${name}:${signingHeaders[name]!.trim().replace(/\s+/g, ' ')}\n`)
        .join('');
    const signedHeaders = sortedHeaderNames.join(';');

    const canonicalUri = encodeS3UriPath(params.url.pathname);
    const canonicalQueryString = buildCanonicalQueryString(params.url);

    const canonicalRequest = [
        method,
        canonicalUri,
        canonicalQueryString,
        canonicalHeaders,
        signedHeaders,
        payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const canonicalRequestHash = await sha256Hex(canonicalRequest);
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        canonicalRequestHash,
    ].join('\n');

    const kDate = await hmacSha256(strToU8(`AWS4${secretAccessKey}`), dateStamp);
    const kRegion = await hmacSha256(kDate, region);
    const kService = await hmacSha256(kRegion, service);
    const kSigning = await hmacSha256(kService, 'aws4_request');
    const signature = bytesToHex(await hmacSha256(kSigning, stringToSign));

    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const fetchHeaders: Record<string, string> = {
        authorization,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
    };
    if (params.contentType) {
        fetchHeaders['content-type'] = params.contentType;
    }

    return {
        headers: fetchHeaders,
        amzDate,
        payloadHash,
        canonicalRequest,
        stringToSign,
        authorization,
    };
}
