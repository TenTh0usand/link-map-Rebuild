import type { ShareBundle } from '../../../core/types';
import { guardedFetch, NetworkBlockedError } from '../../network-guard';
import type {
    R2WorkerConfig,
    ShortShareResponse,
    SyncChunk,
    SyncManifest,
    SyncProvider,
} from '../types';

export function normalizeWorkerEndpoint(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error('Cloudflare Worker URL is required.');
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error(`Invalid Worker URL: ${raw}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Unsupported Worker URL protocol: ${parsed.protocol}`);
    }
    return parsed.toString().replace(/\/+$/, '');
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class R2WorkerSyncProvider implements SyncProvider {
    readonly type = 'r2-worker' as const;
    private readonly config: R2WorkerConfig;
    private readonly timeoutMs: number;
    private readonly sleep: (ms: number) => Promise<void>;

    constructor(
        config: R2WorkerConfig,
        options: { timeoutMs?: number; sleepFn?: (ms: number) => Promise<void> } = {},
    ) {
        this.config = config;
        this.timeoutMs = options.timeoutMs ?? 15000;
        this.sleep = options.sleepFn ?? defaultSleep;
    }

    private syncKey(relPath: string): string {
        const cleanPrefix = this.config.prefix
            .split('/')
            .map((s) => s.trim())
            .filter(Boolean)
            .join('/');
        const cleanRel = relPath.replace(/^\/+/, '');
        return cleanPrefix ? `${cleanPrefix}/${cleanRel}` : cleanRel;
    }

    private async request(path: string, init: RequestInit, retries = 2): Promise<Response> {
        const base = normalizeWorkerEndpoint(this.config.endpoint);
        const token = this.config.token.trim();
        if (!token) {
            throw new Error('Worker Bearer Token is required.');
        }

        const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            ...((init.headers as Record<string, string> | undefined) ?? {}),
        };

        let lastError: unknown;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.timeoutMs);
            try {
                const res = await guardedFetch(`${base}${path}`, {
                    ...init,
                    headers,
                    signal: controller.signal,
                });
                if ((res.status === 429 || res.status >= 500) && attempt < retries) {
                    await this.sleep(600 * (attempt + 1));
                    continue;
                }
                return res;
            } catch (err) {
                if (err instanceof NetworkBlockedError) throw err;
                lastError = err;
                if (attempt < retries) {
                    await this.sleep(500 * (attempt + 1));
                    continue;
                }
                throw err;
            } finally {
                clearTimeout(timer);
            }
        }
        throw lastError instanceof Error ? lastError : new Error('Worker request failed.');
    }

    async testConnection(): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
        const start = Date.now();
        try {
            const res = await this.request('/api/health', { method: 'GET' }, 1);
            const latencyMs = Date.now() - start;
            if (res.status === 401 || res.status === 403) {
                return {
                    ok: false,
                    latencyMs,
                    message: 'Worker Bearer Token rejected (401/403). Check AUTH_TOKEN secret.',
                };
            }
            if (!res.ok) {
                return {
                    ok: false,
                    latencyMs,
                    message: `Worker health check failed (${res.status}).`,
                };
            }
            return {
                ok: true,
                latencyMs,
                message: 'Connected to Cloudflare Worker R2 proxy',
            };
        } catch (err) {
            if (err instanceof NetworkBlockedError) throw err;
            return {
                ok: false,
                latencyMs: Date.now() - start,
                message: err instanceof Error ? err.message : String(err),
            };
        }
    }

    async readManifest(): Promise<SyncManifest | null> {
        const res = await this.request(`/api/sync/${this.syncKey('manifest.json')}`, {
            method: 'GET',
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`Worker GET manifest failed (${res.status}).`);
        return (await res.json()) as SyncManifest;
    }

    async writeManifest(manifest: SyncManifest): Promise<void> {
        const res = await this.request(`/api/sync/${this.syncKey('manifest.json')}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(manifest),
        });
        if (!res.ok) throw new Error(`Worker PUT manifest failed (${res.status}).`);
    }

    async readChunk(chunkId: string): Promise<SyncChunk | null> {
        const res = await this.request(`/api/sync/${this.syncKey(`chunks/${chunkId}.json`)}`, {
            method: 'GET',
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`Worker GET chunk "${chunkId}" failed (${res.status}).`);
        return (await res.json()) as SyncChunk;
    }

    async writeChunk(chunk: SyncChunk): Promise<void> {
        const res = await this.request(`/api/sync/${this.syncKey(`chunks/${chunk.id}.json`)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(chunk),
        });
        if (!res.ok) throw new Error(`Worker PUT chunk "${chunk.id}" failed (${res.status}).`);
    }

    async deleteChunk(chunkId: string): Promise<void> {
        const res = await this.request(`/api/sync/${this.syncKey(`chunks/${chunkId}.json`)}`, {
            method: 'DELETE',
        });
        if (res.status === 404 || res.ok) return;
        throw new Error(`Worker DELETE chunk "${chunkId}" failed (${res.status}).`);
    }

    async createShortShare(bundle: ShareBundle, ttlSeconds = 2592000): Promise<ShortShareResponse> {
        const res = await this.request('/api/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ bundle, ttlSeconds }),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`Create short share failed (${res.status}): ${errText || res.statusText}`);
        }
        const data = (await res.json()) as Partial<ShortShareResponse>;
        if (!data.id || !data.url) {
            throw new Error('Worker returned malformed short-share response.');
        }
        return {
            id: data.id,
            url: data.url,
            expiresAt: data.expiresAt ?? null,
        };
    }
}
