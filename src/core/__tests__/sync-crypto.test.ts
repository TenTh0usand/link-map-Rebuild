import { describe, expect, it } from 'vitest';

import {
    base64ToBytes,
    bytesToBase64,
    decryptBytesAesGcm,
    encryptBytesAesGcm,
    packSyncChunk,
    sha256Hex,
    unpackSyncChunk,
    utf8ToBase64,
} from '../sync-crypto';

describe('sync-crypto', () => {
    it('encodes and decodes UTF-8 strings safely for Basic Auth', () => {
        const b64 = utf8ToBase64('用户:密码@123');
        expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('用户:密码@123');
    });

    it('computes deterministic SHA-256 hex digests', async () => {
        const h1 = await sha256Hex('link-map-v2');
        const h2 = await sha256Hex('link-map-v2');
        expect(h1).toBe(h2);
        expect(h1).toHaveLength(64);
    });

    it('encrypts and decrypts payloads with AES-256-GCM and rejects wrong passphrases', async () => {
        const secretBytes = new TextEncoder().encode('confidential tabs payload 秘密标签页');
        const envelope = await encryptBytesAesGcm(secretBytes, 'strong-pass-123');
        const decrypted = await decryptBytesAesGcm(envelope, 'strong-pass-123');
        expect(new TextDecoder().decode(decrypted)).toBe('confidential tabs payload 秘密标签页');

        await expect(decryptBytesAesGcm(envelope, 'wrong-pass')).rejects.toThrow(
            /Invalid passphrase/i,
        );
    });

    it('packs and unpacks gzip+encrypted chunks with stable plainHash across re-encryptions', async () => {
        const payload = { hello: 'world', items: Array.from({ length: 40 }, (_, i) => i) };
        const p1 = await packSyncChunk('tree', payload, { passphrase: 'my-secret-passphrase' });
        const p2 = await packSyncChunk('tree', payload, { passphrase: 'my-secret-passphrase' });

        // Content hash represents plaintext canonical data, independent of random salt/IV
        expect(p1.plainHash).toBe(p2.plainHash);
        expect(p1.chunk.payloadBase64).not.toBe(p2.chunk.payloadBase64);
        expect(p1.chunk.encrypted).toBe(true);
        expect(p1.chunk.compressed).toBe(true);

        const decoded = await unpackSyncChunk<typeof payload>(p1.chunk, {
            passphrase: 'my-secret-passphrase',
        });
        expect(decoded).toEqual(payload);

        await expect(unpackSyncChunk(p1.chunk, { passphrase: '' })).rejects.toThrow(/required/i);
    });

    it('round-trips plaintext compressed sync chunks when passphrase is omitted', async () => {
        const payload = { ok: true, tags: ['news', 'repo'] };
        const packed = await packSyncChunk('siteMeta', payload);
        expect(packed.chunk.encrypted).toBe(false);
        expect(bytesToBase64(base64ToBytes(packed.chunk.payloadBase64))).toBe(
            packed.chunk.payloadBase64,
        );

        const restored = await unpackSyncChunk<typeof payload>(packed.chunk);
        expect(restored).toEqual(payload);
    });
});
