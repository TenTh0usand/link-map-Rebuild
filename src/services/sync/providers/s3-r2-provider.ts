import { guardedFetch, NetworkBlockedError } from '../../network-guard';
import type { S3R2Config, SyncChunk, SyncManifest, SyncProvider } from '../types';
import { buildS3ObjectUrl, signS3Request } from './s3-sigv4';

export const R2_RECOMMENDED_CORS_JSON = JSON.stringify(
    [
        {
            AllowedOrigins: ['*'],
            AllowedMethods: ['GET', 'PUT', 'DELETE', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 86400,
        },
    ],
    null,
    2,
);

export function resolveS3Endpoint(type: 'r2' | 's3', config: S3R2Config): string {
    const custom = config.endpoint.trim();
    if (type === 'r2') {
        if (custom) return custom;
        const accountId = config.accountId.trim();
        if (!accountId) return '';
        return `https://${accountId}.r2.cloudflarestorage.com`;
    }
    return custom;
}

export interface S3R2ProviderOptions {
    timeoutMs?: number;
    sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class S3R2SyncProvider implements SyncProvider {
    readonly type: 'r2' | 's3';
    private readonly config: S3R2Config;
    private readonly timeoutMs: number;
    private readonly sleep: (ms: number) => Promise<void>;

    constructor(type: 'r2' | 's3', config: S3R2Config, options: S3R2ProviderOptions = {}) {
        this.type = type;
        this.config = config;
        this.timeoutMs = options.timeoutMs ?? 15000;
        this.sleep = options.sleepFn ?? defaultSleep;
    }

    private keyFor(relPath: string): string {
        const cleanPrefix = this.config.prefix
            .split('/')
            .map((s) => s.trim())
            .filter(Boolean)
            .join('/');
        const cleanRel = relPath.replace(/^\/+/, '');
        return cleanPrefix ? `${cleanPrefix}/${cleanRel}` : cleanRel;
    }

    private async signedRequest(
        method: string,
        relPath: string,
        body?: string,
        contentType?: string,
        retries = 2,
    ): Promise<Response> {
        const endpoint = resolveS3Endpoint(this.type, this.config);
        if (!endpoint) {
            throw new Error(
                this.type === 'r2'
                    ? 'Cloudflare R2 Account ID or Endpoint URL is required.'
                    : 'S3 Endpoint URL is required.',
            );
        }

        const url = buildS3ObjectUrl({
            endpoint,
            bucket: this.config.bucket,
            key: this.keyFor(relPath),
            forcePathStyle: this.type === 'r2' ? true : this.config.forcePathStyle,
        });

        const region = this.type === 'r2' ? 'auto' : this.config.region.trim() || 'us-east-1';

        let lastError: unknown;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const signed = await signS3Request({
                method,
                url,
                region,
                accessKeyId: this.config.accessKeyId,
                secretAccessKey: this.config.secretAccessKey,
                body,
                contentType,
            });

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.timeoutMs);
            try {
                const res = await guardedFetch(url.toString(), {
                    method,
                    headers: signed.headers,
                    body,
                    signal: controller.signal,
                });
                if ((res.status === 429 || res.status >= 500) && attempt < retries) {
                    await this.sleep(800 * (attempt + 1));
                    continue;
                }
                return res;
            } catch (err) {
                if (err instanceof NetworkBlockedError) {
                    throw err;
                }
                lastError = err;
                if (attempt < retries) {
                    await this.sleep(700 * (attempt + 1));
                    continue;
                }
                throw err;
            } finally {
                clearTimeout(timer);
            }
        }
        throw lastError instanceof Error ? lastError : new Error('S3/R2 request failed.');
    }

    async testConnection(): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
        const start = Date.now();
        try {
            // Signing GET on manifest.json avoids requiring ListBucket on scoped R2 tokens.
            const res = await this.signedRequest('GET', 'manifest.json', undefined, undefined, 1);
            const latencyMs = Date.now() - start;

            if (res.status === 200 || res.status === 404) {
                return {
                    ok: true,
                    latencyMs,
                    message:
                        res.status === 200
                            ? 'Connected (existing cloud backup found)'
                            : 'Connected (bucket ready)',
                };
            }
            if (res.status === 403 || res.status === 401) {
                return {
                    ok: false,
                    latencyMs,
                    message: `Access denied (${res.status}). Verify Access Key ID, Secret Key, Region, and Bucket permissions.`,
                };
            }
            return {
                ok: false,
                latencyMs,
                message: `S3/R2 returned HTTP ${res.status}.`,
            };
        } catch (err) {
            if (err instanceof NetworkBlockedError) throw err;
            const latencyMs = Date.now() - start;
            const raw = err instanceof Error ? err.message : String(err);
            const r2Hint =
                this.type === 'r2'
                    ? ' Check R2 CORS policy or consider "Cloudflare R2 + Worker" for mainland China acceleration.'
                    : '';
            return { ok: false, latencyMs, message: `${raw}${r2Hint}` };
        }
    }

    private async readJson<T>(relPath: string): Promise<T | null> {
        const res = await this.signedRequest('GET', relPath);
        if (res.status === 404) return null;
        if (!res.ok) {
            throw new Error(`S3/R2 GET ${relPath} failed (${res.status}).`);
        }
        const text = await res.text();
        if (!text.trim()) return null;
        return JSON.parse(text) as T;
    }

    private async writeJson(relPath: string, data: unknown): Promise<void> {
        const res = await this.signedRequest(
            'PUT',
            relPath,
            JSON.stringify(data),
            'application/json; charset=utf-8',
        );
        if (!res.ok) {
            throw new Error(`S3/R2 PUT ${relPath} failed (${res.status}).`);
        }
    }

    async readManifest(): Promise<SyncManifest | null> {
        return this.readJson<SyncManifest>('manifest.json');
    }

    async writeManifest(manifest: SyncManifest): Promise<void> {
        await this.writeJson('manifest.json', manifest);
    }

    async readChunk(chunkId: string): Promise<SyncChunk | null> {
        return this.readJson<SyncChunk>(`chunks/${chunkId}.json`);
    }

    async writeChunk(chunk: SyncChunk): Promise<void> {
        await this.writeJson(`chunks/${chunk.id}.json`, chunk);
    }

    async deleteChunk(chunkId: string): Promise<void> {
        const res = await this.signedRequest('DELETE', `chunks/${chunkId}.json`);
        if (res.status === 404 || res.ok) return;
        throw new Error(`S3/R2 DELETE chunk "${chunkId}" failed (${res.status}).`);
    }
}
