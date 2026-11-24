import { afterEach, describe, expect, it, vi } from 'vitest';

import { NetworkBlockedError, setOfflineOnlyMode } from '../network-guard';
import {
    joinWebDavUrl,
    normalizeWebDavEndpoint,
    WebDavSyncProvider,
} from '../sync/providers/webdav-provider';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    setOfflineOnlyMode(true);
});

describe('WebDavSyncProvider', () => {
    it('normalizes OpenList endpoints and joins paths cleanly', () => {
        expect(normalizeWebDavEndpoint('https://alist.example.com/', 'openlist')).toBe(
            'https://alist.example.com/dav',
        );
        expect(
            joinWebDavUrl('https://dav.jianguoyun.com/dav/', '/LinkMap/', 'chunks/tree.json'),
        ).toBe('https://dav.jianguoyun.com/dav/LinkMap/chunks/tree.json');
    });

    it('blocks all WebDAV requests when Simple Offline Mode is enabled', async () => {
        setOfflineOnlyMode(true);
        const provider = new WebDavSyncProvider({
            preset: 'jianguoyun',
            endpoint: 'https://dav.jianguoyun.com/dav/',
            basePath: 'LinkMap',
            username: 'u',
            password: 'p',
        });
        await expect(provider.readManifest()).rejects.toBeInstanceOf(NetworkBlockedError);
        await expect(provider.testConnection()).rejects.toBeInstanceOf(NetworkBlockedError);
    });

    it('retries HTTP 429 rate-limit responses on Jianguoyun and succeeds on 200', async () => {
        setOfflineOnlyMode(false);
        let calls = 0;
        globalThis.fetch = vi.fn(async () => {
            calls += 1;
            if (calls === 1) {
                return new Response('Too Many Requests', { status: 429 });
            }
            return new Response(
                JSON.stringify({ schemaVersion: 2, updatedAt: 10, deviceId: 'd1', chunks: {} }),
                { status: 200 },
            );
        }) as unknown as typeof fetch;

        const provider = new WebDavSyncProvider(
            {
                preset: 'jianguoyun',
                endpoint: 'https://dav.jianguoyun.com/dav/',
                basePath: 'LinkMap',
                username: 'user@example.com',
                password: 'app-password',
            },
            { sleepFn: async () => {} },
        );

        const manifest = await provider.readManifest();
        expect(calls).toBe(2);
        expect(manifest?.deviceId).toBe('d1');
    });

    it('creates missing directories via MKCOL on PUT 409 conflict', async () => {
        setOfflineOnlyMode(false);
        const methods: Array<{ method: string; url: string }> = [];
        let putCount = 0;

        globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            methods.push({ method, url });

            if (method === 'MKCOL') {
                return new Response('', { status: 201 });
            }
            if (method === 'PUT') {
                putCount += 1;
                if (putCount === 1) {
                    return new Response('Conflict', { status: 409 });
                }
                return new Response('', { status: 201 });
            }
            return new Response('', { status: 404 });
        }) as unknown as typeof fetch;

        const provider = new WebDavSyncProvider(
            {
                preset: '123pan',
                endpoint: 'https://webdav.123pan.cn/webdav/',
                basePath: 'LinkMap',
                username: '123',
                password: '456',
            },
            { sleepFn: async () => {} },
        );

        await provider.writeChunk({
            id: 'tree',
            hash: 'abc',
            payloadBase64: 'e30=',
            encrypted: false,
            compressed: true,
        });

        expect(methods.some((m) => m.method === 'MKCOL' && m.url.endsWith('/LinkMap/chunks'))).toBe(
            true,
        );
        expect(putCount).toBe(2);
    });

    it('surfaces OpenList 302 proxy guidance and treats GET 404 as null', async () => {
        setOfflineOnlyMode(false);
        globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'PROPFIND') {
                return new Response('', { status: 302 });
            }
            return new Response('', { status: 404 });
        }) as unknown as typeof fetch;

        const provider = new WebDavSyncProvider({
            preset: 'openlist',
            endpoint: 'https://alist.example.com',
            basePath: 'LinkMap',
            username: 'u',
            password: 'p',
        });

        const conn = await provider.testConnection();
        expect(conn.ok).toBe(false);
        expect(conn.message).toMatch(/OpenList.*Proxy|302/i);

        const missing = await provider.readManifest();
        expect(missing).toBeNull();
    });
});
