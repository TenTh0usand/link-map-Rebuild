import { describe, expect, it } from 'vitest';

import {
    buildShareUrl,
    buildStandaloneShareHtml,
    decodeShareBundle,
    encodeShareBundle,
    extractEncodedFromShareUrlOrHash,
} from '../share-codec';
import type { ShareBundle } from '../types';

function base64UrlToBytes(b64Url: string): Uint8Array {
    const padded = b64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const binary = atob(padded + '='.repeat(padLen));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

describe('share-codec', () => {
    const sampleBundle: ShareBundle = {
        title: 'AI 研究工具箱',
        description: '常用开源项目与文档合集',
        color: 'blue',
        items: [
            {
                title: 'Link Map Rebuild',
                url: 'https://github.com/TenTh0usand/link-map-Rebuild',
                description: '纯本地优先的树形标签页工作区',
            },
            {
                title: 'WXT Framework',
                url: 'https://wxt.dev/',
            },
        ],
    };

    it('round-trips compressed ShareBundle payloads with CJK text and descriptions', () => {
        const encoded = encodeShareBundle(sampleBundle);
        expect(encoded.qrRecommended).toBe(true);
        expect(encoded.qrSupported).toBe(true);

        const url = buildShareUrl(encoded.encoded, 'https://example.com/share/', 'chrome-extension://id/share.html');
        expect(url.startsWith('https://example.com/share/#lm1=')).toBe(true);

        const extracted = extractEncodedFromShareUrlOrHash(url);
        expect(extracted).toBe(encoded.encoded);

        const decoded = decodeShareBundle(extracted!);
        expect(decoded.title).toBe(sampleBundle.title);
        expect(decoded.description).toBe(sampleBundle.description);
        expect(decoded.color).toBe('blue');
        expect(decoded.items).toHaveLength(2);
        expect(decoded.items[0]!.description).toBe('纯本地优先的树形标签页工作区');
    });

    it('is byte-compatible with browser native DecompressionStream("deflate-raw") used by share-web/index.html', async () => {
        const { encoded } = encodeShareBundle(sampleBundle);
        const rawBytes = base64UrlToBytes(encoded);

        const ds = new DecompressionStream('deflate-raw');
        const readPromise = new Response(ds.readable).arrayBuffer();
        const writer = ds.writable.getWriter();
        await writer.write(new Uint8Array(rawBytes));
        await writer.close();

        const buf = await readPromise;
        const text = new TextDecoder().decode(buf);
        const parsed = JSON.parse(text) as { v: number; t: string; i: unknown[] };
        expect(parsed.v).toBe(1);
        expect(parsed.t).toBe('AI 研究工具箱');
        expect(parsed.i).toHaveLength(2);
    });

    it('flags oversized bundles beyond QR scan thresholds and rejects invalid tokens', () => {
        const bigBundle: ShareBundle = {
            title: 'Large Collection',
            items: Array.from({ length: 160 }, (_, idx) => {
                const hashA = ((idx * 2654435761) >>> 0).toString(36);
                const hashB = (((idx + 77) * 2246822519) >>> 0).toString(36);
                return {
                    title: `Item ${hashA}-${idx}`,
                    url: `https://host-${hashB}.example.org/p/${hashA}/${idx}?q=${hashB}`,
                    description: `Note ${hashA} ${hashB} summary #${idx}`,
                };
            }),
        };
        const res = encodeShareBundle(bigBundle);
        expect(res.charLength).toBeGreaterThan(2400);
        expect(res.qrRecommended).toBe(false);
        expect(res.qrSupported).toBe(false);

        expect(() => decodeShareBundle('')).toThrow();
        expect(() => decodeShareBundle('not_valid_base64_@@@')).toThrow();
    });

    it('generates self-contained offline HTML and neutralizes XSS script injection', () => {
        const xssBundle: ShareBundle = {
            title: 'My <script>alert(1)</script> Group',
            description: '<img src=x onerror=alert(2)>',
            items: [
                {
                    title: 'Safe <b>Title</b>',
                    url: 'javascript:alert(3)',
                    description: '</script><script>alert(4)</script>',
                },
                {
                    title: 'GitHub',
                    url: 'https://github.com',
                },
            ],
        };

        const html = buildStandaloneShareHtml(xssBundle, { theme: 'dark', showDescriptions: true });
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).not.toContain('</script><script>alert(4)</script>');
        expect(html).not.toContain('href="javascript:alert(3)"');
        expect(html).not.toContain('<script src="http');
        expect(html).not.toContain('<link rel="stylesheet" href="http');
        expect(html).toContain('href="https://github.com/"');
    });
});
