interface R2ObjectBody {
    text(): Promise<string>;
}

interface R2PutOptions {
    httpMetadata?: {
        contentType?: string;
    };
}

interface R2Bucket {
    get(key: string): Promise<R2ObjectBody | null>;
    put(key: string, value: ArrayBuffer | string, options?: R2PutOptions): Promise<unknown>;
    delete(key: string): Promise<void>;
}

interface Env {
    LINK_MAP_BUCKET: R2Bucket;
    AUTH_TOKEN: string;
}

interface ShareItem {
    title: string;
    url: string;
    description?: string;
}

interface ShareBundle {
    title: string;
    description?: string;
    items: ShareItem[];
}

interface StoredShareRecord {
    bundle: ShareBundle;
    createdAt: number;
    expiresAt: number | null;
}

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
};

const MAX_SYNC_BYTES = 10 * 1024 * 1024;
const MAX_SHARE_BYTES = 512 * 1024;
const SHORT_ID_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...CORS_HEADERS,
        },
    });
}

function timingSafeEqual(a: string, b: string): boolean {
    const enc = new TextEncoder();
    const aBytes = enc.encode(a);
    const bBytes = enc.encode(b);
    const maxLen = Math.max(aBytes.length, bBytes.length);
    let diff = aBytes.length ^ bBytes.length;
    for (let i = 0; i < maxLen; i++) {
        diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
    }
    return diff === 0;
}

function isAuthorized(request: Request, env: Env): boolean {
    const expected = env.AUTH_TOKEN?.trim();
    if (!expected) return false;
    const auth = request.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return false;
    const token = auth.slice(7).trim();
    return timingSafeEqual(token, expected);
}

function sanitizeKey(rawKey: string): string | null {
    const decoded = decodeURIComponent(rawKey).replace(/^\/+/, '');
    if (!decoded || decoded.includes('..') || decoded.includes('\\')) return null;
    if (!/^[a-zA-Z0-9._/-]{1,160}$/.test(decoded)) return null;
    return decoded;
}

function generateShortId(length = 8): string {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        out += SHORT_ID_ALPHABET[bytes[i]! % SHORT_ID_ALPHABET.length]!;
    }
    return out;
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
        // invalid url
    }
    return '#';
}

function extractHost(rawUrl: string): string {
    try {
        return new URL(rawUrl).hostname || 'link';
    } catch {
        return 'link';
    }
}

function renderShareHtml(bundle: ShareBundle, createdAt: number, expiresAt: number | null): string {
    const safeTitle = escapeHtml(bundle.title || 'Shared Tabs');
    const safeDesc = bundle.description ? escapeHtml(bundle.description) : '';
    const markdownText = [
        `# ${bundle.title || 'Shared Tabs'}`,
        ...(bundle.description ? ['', bundle.description] : []),
        '',
        ...bundle.items.map((item) => {
            const title = (item.title || item.url).replace(/\[/g, '\\[').replace(/\]/g, '\\]');
            const desc = item.description ? ` — ${item.description}` : '';
            return `- [${title}](${item.url})${desc}`;
        }),
    ].join('\n');

    const cardsHtml = bundle.items
        .map((item) => {
            const href = escapeHtml(sanitizeHref(item.url));
            const title = escapeHtml(item.title || item.url);
            const host = escapeHtml(extractHost(item.url));
            const desc = item.description
                ? `<p class="desc">${escapeHtml(item.description)}</p>`
                : '';
            const searchBlob = escapeHtml(
                `${item.title} ${item.url} ${item.description ?? ''}`.toLowerCase(),
            );
            return `<a class="card" href="${href}" target="_blank" rel="noopener noreferrer" data-q="${searchBlob}">
  <div class="card-top"><span class="host">${host}</span></div>
  <div class="card-title">${title}</div>
  ${desc}
  <div class="card-url">${escapeHtml(item.url)}</div>
</a>`;
        })
        .join('\n');

    const metaParts = [
        `${bundle.items.length} links`,
        `Created ${new Date(createdAt).toLocaleDateString()}`,
    ];
    if (expiresAt) {
        metaParts.push(`Expires ${new Date(expiresAt).toLocaleDateString()}`);
    }

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safeTitle} - Link Map</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f4f5f7;
    --card: #ffffff;
    --border: #e2e6ee;
    --text: #181a1f;
    --muted: #64748b;
    --accent: #d2a400;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #181a1f;
      --card: #23262e;
      --border: #323642;
      --text: #eceef2;
      --muted: #98a0ae;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px 16px 56px; }
  .wrap { max-width: 960px; margin: 0 auto; }
  header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--border); padding-bottom: 14px; margin-bottom: 18px; }
  h1 { margin: 0 0 6px; font-size: 21px; }
  .sub { margin: 0; font-size: 12px; color: var(--muted); }
  .bar { display: flex; gap: 10px; margin-bottom: 16px; }
  input { flex: 1; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--text); font-size: 13px; outline: none; }
  input:focus { border-color: var(--accent); }
  button { padding: 9px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--text); font-size: 13px; cursor: pointer; font-weight: 500; }
  button:hover { border-color: var(--accent); color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .card { display: flex; flex-direction: column; gap: 6px; padding: 14px; border-radius: 10px; background: var(--card); border: 1px solid var(--border); text-decoration: none; color: inherit; transition: border-color 0.15s; }
  .card:hover { border-color: var(--accent); }
  .card-top { display: flex; font-size: 11px; }
  .host { padding: 2px 7px; border-radius: 999px; background: rgb(210 164 0 / 15%); color: var(--accent); font-weight: 600; }
  .card-title { font-size: 14px; font-weight: 600; line-height: 1.4; }
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
      ${safeDesc ? `<p class="sub">${safeDesc}</p>` : ''}
    </div>
    <span class="sub">${escapeHtml(metaParts.join(' · '))}</span>
  </header>
  <div class="bar">
    <input id="q" type="search" placeholder="Search links..." />
    <button id="copyBtn" type="button">Copy Markdown</button>
  </div>
  <div class="grid">${cardsHtml}</div>
  <footer>Shared via self-hosted Link Map R2 Worker</footer>
</div>
<script>
  const md = ${JSON.stringify(markdownText).replace(/</g, '\\u003c')};
  const q = document.getElementById('q');
  const cards = Array.from(document.querySelectorAll('.card'));
  q.addEventListener('input', () => {
    const val = q.value.trim().toLowerCase();
    cards.forEach((c) => { c.style.display = !val || (c.dataset.q || '').includes(val) ? 'flex' : 'none'; });
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

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        // Public short-link viewer: GET /s/<id>
        if (path.startsWith('/s/') && (request.method === 'GET' || request.method === 'HEAD')) {
            const shareId = path.slice(3).replace(/\/+$/, '');
            if (!/^[a-zA-Z0-9_-]{4,32}$/.test(shareId)) {
                return new Response('Invalid share link.', { status: 400 });
            }
            const obj = await env.LINK_MAP_BUCKET.get(`share/${shareId}.json`);
            if (!obj) {
                return new Response('Share link not found or deleted.', { status: 404 });
            }
            const record = JSON.parse(await obj.text()) as StoredShareRecord;
            if (record.expiresAt !== null && Date.now() > record.expiresAt) {
                await env.LINK_MAP_BUCKET.delete(`share/${shareId}.json`);
                return new Response('This share link has expired.', { status: 410 });
            }
            return new Response(
                renderShareHtml(record.bundle, record.createdAt, record.expiresAt),
                {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Cache-Control': 'public, max-age=60',
                    },
                },
            );
        }

        // Protected API routes
        if (!path.startsWith('/api/')) {
            return jsonResponse({ error: 'Not found' }, 404);
        }

        if (!env.AUTH_TOKEN?.trim()) {
            return jsonResponse({ error: 'Server missing AUTH_TOKEN secret' }, 500);
        }
        if (!isAuthorized(request, env)) {
            return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        if (path === '/api/health' && request.method === 'GET') {
            return jsonResponse({
                ok: true,
                service: 'link-map-r2-sync',
                timestamp: Date.now(),
            });
        }

        if (path === '/api/share' && request.method === 'POST') {
            const rawText = await request.text();
            if (rawText.length > MAX_SHARE_BYTES) {
                return jsonResponse({ error: 'Share bundle exceeds 512 KB limit' }, 413);
            }
            const body = JSON.parse(rawText) as { bundle?: ShareBundle; ttlSeconds?: number };
            if (!body.bundle || !Array.isArray(body.bundle.items)) {
                return jsonResponse({ error: 'Invalid ShareBundle payload' }, 400);
            }
            const ttl = typeof body.ttlSeconds === 'number' && body.ttlSeconds > 0 ? body.ttlSeconds : 0;
            const now = Date.now();
            const expiresAt = ttl > 0 ? now + ttl * 1000 : null;
            const id = generateShortId(8);
            const record: StoredShareRecord = {
                bundle: body.bundle,
                createdAt: now,
                expiresAt,
            };
            await env.LINK_MAP_BUCKET.put(`share/${id}.json`, JSON.stringify(record), {
                httpMetadata: { contentType: 'application/json; charset=utf-8' },
            });
            return jsonResponse({
                ok: true,
                id,
                url: `${url.origin}/s/${id}`,
                expiresAt,
            });
        }

        if (path.startsWith('/api/sync/')) {
            const rawKey = path.slice('/api/sync/'.length);
            const key = sanitizeKey(rawKey);
            if (!key) {
                return jsonResponse({ error: 'Invalid sync object key' }, 400);
            }
            const r2Key = `sync/${key}`;

            if (request.method === 'GET') {
                const obj = await env.LINK_MAP_BUCKET.get(r2Key);
                if (!obj) return jsonResponse({ error: 'Not found' }, 404);
                const text = await obj.text();
                return new Response(text, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                        ...CORS_HEADERS,
                    },
                });
            }

            if (request.method === 'PUT') {
                const buf = await request.arrayBuffer();
                if (buf.byteLength > MAX_SYNC_BYTES) {
                    return jsonResponse({ error: 'Payload exceeds 10 MB limit' }, 413);
                }
                await env.LINK_MAP_BUCKET.put(r2Key, buf, {
                    httpMetadata: { contentType: 'application/json; charset=utf-8' },
                });
                return jsonResponse({ ok: true });
            }

            if (request.method === 'DELETE') {
                await env.LINK_MAP_BUCKET.delete(r2Key);
                return jsonResponse({ ok: true });
            }

            return jsonResponse({ error: 'Method not allowed' }, 405);
        }

        return jsonResponse({ error: 'Unknown API route' }, 404);
    },
};
