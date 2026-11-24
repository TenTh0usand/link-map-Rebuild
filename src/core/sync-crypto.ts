import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';

import type { SyncChunk } from '../services/sync/types';

const ENVELOPE_MAGIC = [0x4c, 0x4d, 0x32, 0x45] as const; // "LM2E"
const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 100_000;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}

function getSubtleCrypto(): SubtleCrypto {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error('Web Crypto API is not available in this environment.');
    }
    return subtle;
}

function getRandomBytes(length: number): Uint8Array {
    if (!globalThis.crypto?.getRandomValues) {
        throw new Error('crypto.getRandomValues is not available in this environment.');
    }
    const buf = new Uint8Array(length);
    globalThis.crypto.getRandomValues(buf);
    return buf;
}

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const sub = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...sub);
    }
    return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64.trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function utf8ToBase64(str: string): string {
    return bytesToBase64(strToU8(str));
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
    const subtle = getSubtleCrypto();
    const bytes = typeof data === 'string' ? strToU8(data) : data;
    const digest = await subtle.digest('SHA-256', toArrayBuffer(bytes));
    const out = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < out.length; i++) {
        hex += out[i]!.toString(16).padStart(2, '0');
    }
    return hex;
}

async function deriveAesGcmKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const subtle = getSubtleCrypto();
    const keyMaterial = await subtle.importKey(
        'raw',
        toArrayBuffer(strToU8(passphrase)),
        'PBKDF2',
        false,
        ['deriveKey'],
    );
    return subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: toArrayBuffer(salt),
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

export async function encryptBytesAesGcm(plain: Uint8Array, passphrase: string): Promise<Uint8Array> {
    if (!passphrase) {
        throw new Error('E2EE passphrase cannot be empty.');
    }
    const subtle = getSubtleCrypto();
    const salt = getRandomBytes(SALT_BYTES);
    const iv = getRandomBytes(IV_BYTES);
    const key = await deriveAesGcmKey(passphrase, salt);
    const cipherBuf = await subtle.encrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(iv) },
        key,
        toArrayBuffer(plain),
    );
    const cipherBytes = new Uint8Array(cipherBuf);

    const envelope = new Uint8Array(4 + SALT_BYTES + IV_BYTES + cipherBytes.byteLength);
    envelope[0] = ENVELOPE_MAGIC[0];
    envelope[1] = ENVELOPE_MAGIC[1];
    envelope[2] = ENVELOPE_MAGIC[2];
    envelope[3] = ENVELOPE_MAGIC[3];
    envelope.set(salt, 4);
    envelope.set(iv, 4 + SALT_BYTES);
    envelope.set(cipherBytes, 4 + SALT_BYTES + IV_BYTES);
    return envelope;
}

export async function decryptBytesAesGcm(
    envelope: Uint8Array,
    passphrase: string,
): Promise<Uint8Array> {
    if (!passphrase) {
        throw new Error('E2EE passphrase is required to decrypt cloud data.');
    }
    if (envelope.byteLength <= 4 + SALT_BYTES + IV_BYTES) {
        throw new Error('Invalid encrypted sync payload length.');
    }
    if (
        envelope[0] !== ENVELOPE_MAGIC[0] ||
        envelope[1] !== ENVELOPE_MAGIC[1] ||
        envelope[2] !== ENVELOPE_MAGIC[2] ||
        envelope[3] !== ENVELOPE_MAGIC[3]
    ) {
        throw new Error('Unsupported encrypted sync envelope header.');
    }

    const salt = envelope.subarray(4, 4 + SALT_BYTES);
    const iv = envelope.subarray(4 + SALT_BYTES, 4 + SALT_BYTES + IV_BYTES);
    const cipherBytes = envelope.subarray(4 + SALT_BYTES + IV_BYTES);
    const subtle = getSubtleCrypto();
    const key = await deriveAesGcmKey(passphrase, salt);

    try {
        const plainBuf = await subtle.decrypt(
            { name: 'AES-GCM', iv: toArrayBuffer(iv) },
            key,
            toArrayBuffer(cipherBytes),
        );
        return new Uint8Array(plainBuf);
    } catch {
        throw new Error('Invalid passphrase or corrupted encrypted sync payload.');
    }
}

export async function packSyncChunk(
    chunkId: string,
    data: unknown,
    options: { passphrase?: string } = {},
): Promise<{ chunk: SyncChunk; plainHash: string; rawSize: number }> {
    const json = JSON.stringify(data);
    const plainHash = await sha256Hex(json);
    const rawBytes = strToU8(json);
    const compressedBytes = gzipSync(rawBytes, { level: 6 });

    const passphrase = options.passphrase?.trim() ?? '';
    const encrypted = passphrase.length > 0;
    const wireBytes = encrypted
        ? await encryptBytesAesGcm(compressedBytes, passphrase)
        : compressedBytes;

    return {
        chunk: {
            id: chunkId,
            hash: plainHash,
            payloadBase64: bytesToBase64(wireBytes),
            encrypted,
            compressed: true,
        },
        plainHash,
        rawSize: rawBytes.byteLength,
    };
}

export async function unpackSyncChunk<T>(
    chunk: SyncChunk,
    options: { passphrase?: string } = {},
): Promise<T> {
    let wireBytes = base64ToBytes(chunk.payloadBase64);
    if (chunk.encrypted) {
        const passphrase = options.passphrase?.trim() ?? '';
        wireBytes = await decryptBytesAesGcm(wireBytes, passphrase);
    }
    const plainBytes = chunk.compressed ? gunzipSync(wireBytes) : wireBytes;
    const json = strFromU8(plainBytes);
    return JSON.parse(json) as T;
}
