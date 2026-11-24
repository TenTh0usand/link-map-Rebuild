import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

import { extractHostname } from './categorizer';
import type { ShareBundle, ShareItem, TabGroupColor } from './types';

interface CompactSharePayloadV1 {
    v: 1;
    t: string;
    d?: string;
    c?: TabGroupColor;
    i: Array<[string, string] | [string, string, string]>;
}

export interface EncodedShareResult {
    encoded: string;
    charLength: number;
    qrRecommended: boolean;
    qrSupported: boolean;
}

export const SHARE_HASH_PREFIX = 'lm1=';
export const QR_RECOMMENDED_MAX_CHARS = 1400;
export const QR_SUPPORTED_MAX_CHARS = 2400;

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const sub = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...sub);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(b64Url: string): Uint8Array {
    const padded = b64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const base64 = padded + '='.repeat(padLen);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function encodeShareBundle(bundle: ShareBundle): EncodedShareResult {
    const compact: CompactSharePayloadV1 = {
        v: 1,
        t: bundle.title.trim() || 'Link Map Share',
        ...(bundle.description?.trim() ? { d: bundle.description.trim() } : {}),
        ...(bundle.color ? { c: bundle.color } : {}),
        i: bundle.items
            .filter((item) => Boolean(item.url))
            .map((item) => {
                const desc = item.description?.trim();
                const title = item.title.trim() || extractHostname(item.url) || item.url;
                return desc ? [title, item.url, desc] : [title, item.url];
            }),
    };

    const rawBytes = strToU8(JSON.stringify(compact));
    const deflated = deflateSync(rawBytes, { level: 9 });
    const encoded = bytesToBase64Url(deflated);

    return {
        encoded,
        charLength: encoded.length,
        qrRecommended: encoded.length <= QR_RECOMMENDED_MAX_CHARS,
        qrSupported: encoded.length <= QR_SUPPORTED_MAX_CHARS,
    };
}

export function decodeShareBundle(encoded: string): ShareBundle {
    const cleaned = encoded.trim();
    if (!cleaned) {
        throw new Error('Empty share payload');
    }

    const bytes = base64UrlToBytes(cleaned);
    const jsonStr = strFromU8(inflateSync(bytes));
    const parsed = JSON.parse(jsonStr) as Partial<CompactSharePayloadV1>;

    if (parsed.v !== 1 || !Array.isArray(parsed.i)) {
        throw new Error('Unsupported share payload version');
    }

    const items: ShareItem[] = [];
    for (const tuple of parsed.i) {
        if (!Array.isArray(tuple) || tuple.length < 2) continue;
        const [title, url, description] = tuple;
        if (typeof url !== 'string' || !url.trim()) continue;
        items.push({
            title: typeof title === 'string' && title.trim() ? title : url,
            url: url.trim(),
            ...(typeof description === 'string' && description.trim()
                ? { description: description.trim() }
                : {}),
        });
    }

    return {
        title: typeof parsed.t === 'string' && parsed.t.trim() ? parsed.t : 'Shared Tabs',
        description: typeof parsed.d === 'string' ? parsed.d : undefined,
        color: parsed.c,
        items,
    };
}

export function buildShareUrl(
    encoded: string,
    shareBaseUrl: string,
    fallbackBaseUrl: string,
): string {
    const base = (shareBaseUrl.trim() || fallbackBaseUrl).split('#')[0]!;
    return `${base}#${SHARE_HASH_PREFIX}${encoded}`;
}

export function extractEncodedFromShareUrlOrHash(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const hashIdx = trimmed.indexOf('#');
    const fragment = hashIdx >= 0 ? trimmed.slice(hashIdx + 1) : trimmed;

    if (fragment.startsWith(SHARE_HASH_PREFIX)) {
        return fragment.slice(SHARE_HASH_PREFIX.length);
    }
    if (trimmed.includes(SHARE_HASH_PREFIX)) {
        const idx = trimmed.indexOf(SHARE_HASH_PREFIX);
        return trimmed.slice(idx + SHARE_HASH_PREFIX.length);
    }
    return /^[A-Za-z0-9_-]{12,}$/.test(trimmed) ? trimmed : null;
}

function escapeHtml(raw: string): string {
    return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeHref(rawUrl: string): string {
    try {
        const u = new URL(rawUrl);
        if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'ftp:') {
            return u.toString();
        }
    } catch {
        // Invalid URL
    }
    return '#';
}

export function buildStandaloneShareHtml(
    bundle: ShareBundle,
    options: { theme?: 'dark' | 'light'; showDescriptions?: boolean } = {},
): string {
    const theme = options.theme ?? 'dark';
    const showDescriptions = options.showDescriptions ?? true;
    const isDark = theme === 'dark';

    const safeTitle = escapeHtml(bundle.title || 'Shared Tabs');
    const safeDesc = bundle.description ? escapeHtml(bundle.description) : '';
    const markdownText = [
        `# ${bundle.title || 'Shared Tabs'}`,
        ...(bundle.description ? ['', bundle.description] : []),
        '',
        ...bundle.items.map((item) => {
            const safeMdTitle = item.title.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
            const descPart =
                showDescriptions && item.description ? ` — ${item.description}` : '';
            return `- [${safeMdTitle}](${item.url})${descPart}`;
        }),
    ].join('\n');

    const cardsHtml = bundle.items
        .map((item) => {
            const href = escapeHtml(sanitizeHref(item.url));
            const title = escapeHtml(item.title || item.url);
            const host = escapeHtml(extractHostname(item.url) || 'link');
            const desc =
                showDescriptions && item.description
                    ? `<p class="desc">${escapeHtml(item.description)}</p>`
                    : '';
            const searchBlob = escapeHtml(
                `${item.title} ${item.url} ${item.description ?? ''}`.toLowerCase(),
            );
            return `<a class="card" href="${href}" target="_blank" rel="noopener noreferrer" data-q="${searchBlob}">
                <div class="card-top">
                    <span class="host">${host}</span>
                </div>
                <div class="card-title">${title}</div>
                ${desc}
                <div class="card-url">${escapeHtml(item.url)}</div>
            </a>`;
        })
        .join('\n');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safeTitle} - Link Map</title>
<style>
  :root {
    color-scheme: ${isDark ? 'dark' : 'light'};
    --bg: ${isDark ? '#181a1f' : '#f4f5f7'};
    --card: ${isDark ? '#23262e' : '#ffffff'};
    --border: ${isDark ? '#323642' : '#e2e6ee'};
    --text: ${isDark ? '#eceef2' : '#181a1f'};
    --muted: ${isDark ? '#98a0ae' : '#64748b'};
    --accent: #d2a400;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 28px 18px 60px; }
  .wrap { max-width: 980px; margin: 0 auto; }
  header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
  h1 { margin: 0 0 6px; font-size: 22px; }
  .subtitle { margin: 0; color: var(--muted); font-size: 13px; }
  .toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 18px; }
  input { flex: 1; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--text); font-size: 13px; outline: none; }
  input:focus { border-color: var(--accent); }
  button { padding: 9px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--text); font-size: 13px; cursor: pointer; font-weight: 500; }
  button:hover { border-color: var(--accent); color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .card { display: flex; flex-direction: column; gap: 6px; padding: 14px; border-radius: 10px; background: var(--card); border: 1px solid var(--border); text-decoration: none; color: inherit; transition: border-color 0.15s, transform 0.15s; }
  .card:hover { border-color: var(--accent); transform: translateY(-1px); }
  .card-top { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }
  .host { padding: 2px 7px; border-radius: 999px; background: rgb(210 164 0 / 14%); color: var(--accent); font-weight: 600; }
  .card-title { font-size: 14px; font-weight: 600; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .desc { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.45; }
  .card-url { margin-top: auto; font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  footer { margin-top: 28px; text-align: center; font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>${safeTitle}</h1>
      ${safeDesc ? `<p class="subtitle">${safeDesc}</p>` : ''}
    </div>
    <span class="subtitle">${bundle.items.length} links · Offline Snapshot</span>
  </header>
  <div class="toolbar">
    <input id="q" type="search" placeholder="Search links..." />
    <button id="copyBtn" type="button">Copy Markdown</button>
  </div>
  <div class="grid" id="grid">
    ${cardsHtml}
  </div>
  <footer>Generated locally by Link Map · Zero server tracking</footer>
</div>
<script>
  const md = ${JSON.stringify(markdownText).replace(/</g, '\\u003c')};
  const qEl = document.getElementById('q');
  const cards = Array.from(document.querySelectorAll('.card'));
  qEl.addEventListener('input', () => {
    const val = qEl.value.trim().toLowerCase();
    cards.forEach((c) => {
      c.style.display = !val || (c.dataset.q || '').includes(val) ? 'flex' : 'none';
    });
  });
  document.getElementById('copyBtn').addEventListener('click', async () => {
    await navigator.clipboard.writeText(md);
    const btn = document.getElementById('copyBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Markdown'; }, 1500);
  });
</script>
</body>
</html>`;
}
