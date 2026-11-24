import { utf8ToBase64 } from '../../../core/sync-crypto';
import { guardedFetch, NetworkBlockedError } from '../../network-guard';
import type { SyncManifest, SyncProvider, WebDavConfig, WebDavPreset } from '../types';

export interface WebDavPresetMeta {
    label: string;
    defaultEndpoint: string;
    defaultBasePath: string;
    minRecommendedIntervalSec: number;
}

export const WEBDAV_PRESETS: Record<WebDavPreset, WebDavPresetMeta> = {
    jianguoyun: {
        label: '坚果云 (Jianguoyun)',
        defaultEndpoint: 'https://dav.jianguoyun.com/dav/',
        defaultBasePath: 'LinkMap',
        minRecommendedIntervalSec: 120,
    },
    '123pan': {
        label: '123云盘 (123Pan)',
        defaultEndpoint: 'https://webdav.123pan.cn/webdav/',
        defaultBasePath: 'LinkMap',
        minRecommendedIntervalSec: 60,
    },
    openlist: {
        label: 'OpenList / AList',
        defaultEndpoint: 'https://your-openlist-host/dav/',
        defaultBasePath: 'LinkMap',
        minRecommendedIntervalSec: 60,
    },
    custom: {
        label: '自定义 WebDAV',
        defaultEndpoint: '',
        defaultBasePath: 'LinkMap',
        minRecommendedIntervalSec: 60,
    },
};

export interface WebDavProviderOptions {
    timeoutMs?: number;
    sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function normalizeWebDavEndpoint(rawEndpoint: string, preset: WebDavPreset): string {
    const trimmed = rawEndpoint.trim();
    if (!trimmed) return '';
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        throw new Error(`Invalid WebDAV endpoint URL: ${rawEndpoint}`);
    }
    if (preset === 'openlist' && (url.pathname === '/' || url.pathname === '')) {
        url.pathname = '/dav';
    }
    return url.toString().replace(/\/+$/, '');
}

export function joinWebDavUrl(
    endpoint: string,
    basePath: string,
    relPath = '',
    preset: WebDavPreset = 'custom',
): string {
    const cleanEndpoint = normalizeWebDavEndpoint(endpoint, preset);
    if (!cleanEndpoint) {
        throw new Error('WebDAV server URL is required.');
    }
    const cleanSegments = [
        ...basePath
            .split('/')
            .map((s) => s.trim())
            .filter(Boolean),
        ...relPath
            .split('/')
            .map((s) => s.trim())
            .filter(Boolean),
    ].map((seg) => encodeURIComponent(seg));

    return cleanSegments.length > 0
        ? `${cleanEndpoint}/${cleanSegments.join('/')}`
        : cleanEndpoint;
}

export class WebDavSyncProvider implements SyncProvider {
    readonly type = 'webdav' as const;
    private readonly config: WebDavConfig;
    private readonly timeoutMs: number;
    private readonly sleep: (ms: number) => Promise<void>;
    private dirEnsured = false;

    constructor(config: WebDavConfig, options: WebDavProviderOptions = {}) {
        this.config = config;
        this.timeoutMs = options.timeoutMs ?? 15000;
        this.sleep = options.sleepFn ?? defaultSleep;
    }

    private buildHeaders(extra?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = { ...(extra ?? {}) };
        if (this.config.username || this.config.password) {
            headers.Authorization = `Basic ${utf8ToBase64(`${this.config.username}:${this.config.password}`)}`;
        }
        return headers;
    }

    private async request(
        url: string,
        init: RequestInit,
        retries = 2,
    ): Promise<Response> {
        let lastError: unknown;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.timeoutMs);
            try {
                const response = await guardedFetch(url, {
                    ...init,
                    headers: this.buildHeaders(init.headers as Record<string, string> | undefined),
                    signal: controller.signal,
                });

                if ((response.status === 429 || response.status === 503) && attempt < retries) {
                    const retryAfter = response.headers.get('Retry-After');
                    const parsedSec = retryAfter ? Number.parseInt(retryAfter, 10) : NaN;
                    const delayMs = Number.isFinite(parsedSec)
                        ? Math.min(Math.max(parsedSec * 1000, 500), 10000)
                        : 1200 * 2 ** attempt;
                    await this.sleep(delayMs);
                    continue;
                }
                return response;
            } catch (err) {
                if (err instanceof NetworkBlockedError) {
                    throw err;
                }
                lastError = err;
                if (attempt < retries) {
                    await this.sleep(600 * (attempt + 1));
                    continue;
                }
                throw err;
            } finally {
                clearTimeout(timer);
            }
        }
        throw lastError instanceof Error ? lastError : new Error('WebDAV request failed.');
    }

    private async ensureDirectories(): Promise<void> {
        const cleanEndpoint = normalizeWebDavEndpoint(this.config.endpoint, this.config.preset);
        if (!cleanEndpoint) {
            throw new Error('WebDAV endpoint is required.');
        }

        const baseSegments = this.config.basePath
            .split('/')
            .map((s) => s.trim())
            .filter(Boolean);
        const allFolders = [...baseSegments, 'chunks'];

        let currentUrl = cleanEndpoint;
        for (const folder of allFolders) {
            currentUrl = `${currentUrl}/${encodeURIComponent(folder)}`;
            const res = await this.request(currentUrl, { method: 'MKCOL' }, 1);
            if (res.status === 401 || res.status === 403) {
                throw new Error(`WebDAV authentication failed (${res.status}). Check username/app password.`);
            }
            if (
                res.status === 200 ||
                res.status === 201 ||
                res.status === 204 ||
                res.status === 301 ||
                res.status === 405 ||
                res.status === 409
            ) {
                continue;
            }
            if (!res.ok) {
                throw new Error(`WebDAV MKCOL failed (${res.status}) for ${currentUrl}`);
            }
        }

        this.dirEnsured = true;
    }

    private urlFor(relPath: string): string {
        return joinWebDavUrl(
            this.config.endpoint,
            this.config.basePath,
            relPath,
            this.config.preset,
        );
    }

    async testConnection(): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
        const start = Date.now();
        try {
            const rootUrl = normalizeWebDavEndpoint(this.config.endpoint, this.config.preset);
            if (!rootUrl) {
                return { ok: false, latencyMs: 0, message: 'WebDAV URL is required.' };
            }

            const res = await this.request(
                rootUrl,
                {
                    method: 'PROPFIND',
                    headers: { Depth: '0' },
                    redirect: 'manual',
                },
                0,
            );
            const latencyMs = Date.now() - start;

            if (res.type === 'opaqueredirect' || res.status === 301 || res.status === 302) {
                const hint =
                    this.config.preset === 'openlist'
                        ? 'OpenList returned a 302 redirect. Enable "WebDAV Proxy" in OpenList or verify /dav/ path.'
                        : `WebDAV endpoint returned HTTP ${res.status || 302} redirect; verify exact WebDAV base URL.`;
                return { ok: false, latencyMs, message: hint };
            }

            if (res.status === 401 || res.status === 403) {
                return {
                    ok: false,
                    latencyMs,
                    message:
                        this.config.preset === 'jianguoyun'
                            ? `Auth failed (${res.status}): Jianguoyun requires an App-Specific Password, not your login password.`
                            : `Authentication failed (${res.status}): Check username and password.`,
                };
            }

            if (res.status === 429) {
                return {
                    ok: false,
                    latencyMs,
                    message: 'HTTP 429 Too Many Requests: Rate limit hit. Wait a moment before retrying.',
                };
            }

            if (!res.ok && res.status !== 207) {
                return {
                    ok: false,
                    latencyMs,
                    message: `WebDAV PROPFIND failed with HTTP ${res.status}.`,
                };
            }

            await this.ensureDirectories();
            return {
                ok: true,
                latencyMs: Date.now() - start,
                message: `Connected (${res.status}) · Folder "${this.config.basePath || 'LinkMap'}" ready`,
            };
        } catch (err) {
            if (err instanceof NetworkBlockedError) throw err;
            const latencyMs = Date.now() - start;
            const rawMsg = err instanceof Error ? err.message : String(err);
            const openlistHint =
                this.config.preset === 'openlist'
                    ? ' (For OpenList, ensure /dav/ path and CORS / WebDAV Proxy are enabled.)'
                    : '';
            return {
                ok: false,
                latencyMs,
                message: `${rawMsg}${openlistHint}`,
            };
        }
    }

    private async readJson<T>(relPath: string): Promise<T | null> {
        const res = await this.request(this.urlFor(relPath), { method: 'GET' });
        if (res.status === 404) {
            return null;
        }
        if (res.status === 401 || res.status === 403) {
            throw new Error(`WebDAV authentication failed (${res.status}).`);
        }
        if (!res.ok) {
            throw new Error(`WebDAV GET ${relPath} failed (${res.status}).`);
        }
        const text = await res.text();
        if (!text.trim()) return null;
        return JSON.parse(text) as T;
    }

    private async writeJson(relPath: string, data: unknown): Promise<void> {
        if (!this.dirEnsured) {
            await this.ensureDirectories();
        }
        const url = this.urlFor(relPath);
        const body = JSON.stringify(data);
        let res = await this.request(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body,
        });

        if (res.status === 404 || res.status === 409) {
            this.dirEnsured = false;
            await this.ensureDirectories();
            res = await this.request(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body,
            });
        }

        if (res.status === 401 || res.status === 403) {
            throw new Error(`WebDAV authentication failed (${res.status}).`);
        }
        if (!res.ok) {
            throw new Error(`WebDAV PUT ${relPath} failed (${res.status}).`);
        }
    }

    async readManifest(): Promise<SyncManifest | null> {
        return this.readJson<SyncManifest>('manifest.json');
    }

    async writeManifest(manifest: SyncManifest): Promise<void> {
        await this.writeJson('manifest.json', manifest);
    }

    async readChunk(chunkId: string) {
        return this.readJson<import('../types').SyncChunk>(`chunks/${chunkId}.json`);
    }

    async writeChunk(chunk: import('../types').SyncChunk): Promise<void> {
        await this.writeJson(`chunks/${chunk.id}.json`, chunk);
    }

    async deleteChunk(chunkId: string): Promise<void> {
        const res = await this.request(this.urlFor(`chunks/${chunkId}.json`), {
            method: 'DELETE',
        });
        if (res.status === 404 || res.ok) return;
        throw new Error(`WebDAV DELETE chunk "${chunkId}" failed (${res.status}).`);
    }
}
