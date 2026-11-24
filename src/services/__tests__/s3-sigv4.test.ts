import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
    buildS3ObjectUrl,
    encodeS3UriPath,
    signS3Request,
} from '../sync/providers/s3-sigv4';

function nodeHmac(key: Uint8Array<ArrayBuffer> | string, msg: string): Uint8Array<ArrayBuffer> {
    const rawKey = typeof key === 'string' ? key : new Uint8Array(key);
    return new Uint8Array(createHmac('sha256', rawKey).update(msg, 'utf8').digest());
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('s3-sigv4', () => {
    it('encodes S3 URI paths following RFC 3986 while preserving slashes', () => {
        expect(encodeS3UriPath('/my bucket/docs/hello world!(v2).json')).toBe(
            '/my%20bucket/docs/hello%20world%21%28v2%29.json',
        );
    });

    it('builds path-style and virtual-hosted URLs cleanly', () => {
        const r2Url = buildS3ObjectUrl({
            endpoint: 'https://acc123.r2.cloudflarestorage.com',
            bucket: 'link-map-sync',
            key: 'prefix/chunks/tree.json',
            forcePathStyle: true,
        });
        expect(r2Url.toString()).toBe(
            'https://acc123.r2.cloudflarestorage.com/link-map-sync/prefix/chunks/tree.json',
        );

        const vhostUrl = buildS3ObjectUrl({
            endpoint: 'https://s3.us-east-1.amazonaws.com',
            bucket: 'my-bucket',
            key: 'manifest.json',
            forcePathStyle: false,
        });
        expect(vhostUrl.toString()).toBe('https://my-bucket.s3.us-east-1.amazonaws.com/manifest.json');
    });

    it('produces deterministic AWS SigV4 signatures matching Node crypto reference and omits host from fetch headers', async () => {
        const url = buildS3ObjectUrl({
            endpoint: 'https://acct999.r2.cloudflarestorage.com',
            bucket: 'lm-bucket',
            key: 'link-map/manifest.json',
            forcePathStyle: true,
        });
        const fixedDate = new Date('2026-04-05T12:34:56.000Z');
        const body = '{"schemaVersion":2}';

        const signed = await signS3Request({
            method: 'PUT',
            url,
            region: 'auto',
            accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
            secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            body,
            contentType: 'application/json; charset=utf-8',
            now: fixedDate,
        });

        expect(signed.amzDate).toBe('20260405T123456Z');
        expect(signed.headers.host).toBeUndefined();
        expect(signed.canonicalRequest).toContain('host:acct999.r2.cloudflarestorage.com\n');
        expect(signed.authorization).toContain(
            'Credential=AKIAIOSFODNN7EXAMPLE/20260405/auto/s3/aws4_request',
        );
        expect(signed.authorization).toContain(
            'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date',
        );

        // Independently verify signature via Node OpenSSL HMAC-SHA256
        const kDate = nodeHmac('AWS4wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', '20260405');
        const kRegion = nodeHmac(kDate, 'auto');
        const kService = nodeHmac(kRegion, 's3');
        const kSigning = nodeHmac(kService, 'aws4_request');
        const expectedSig = bytesToHex(nodeHmac(kSigning, signed.stringToSign));

        expect(signed.payloadHash).toBe(createHash('sha256').update(body, 'utf8').digest('hex'));
        expect(signed.authorization.endsWith(`Signature=${expectedSig}`)).toBe(true);
    });
});
