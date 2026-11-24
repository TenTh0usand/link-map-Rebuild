import { executeSyncCycle, type SyncRunMode } from '../../core/sync-engine';
import type { ShareBundle } from '../../core/types';
import { ensureOriginPermissionForUrl, isOfflineOnlyMode, NetworkBlockedError } from '../network-guard';
import type {
    ShortShareResponse,
    SyncConfig,
    SyncConflictState,
    SyncProvider,
    SyncResult,
    SyncStateMeta,
    SyncWorkspacePayload,
} from './types';
import { GoogleDriveSyncProvider } from './providers/google-drive-provider';
import { normalizeWorkerEndpoint, R2WorkerSyncProvider } from './providers/r2-worker-provider';
import { resolveS3Endpoint, S3R2SyncProvider } from './providers/s3-r2-provider';
import { normalizeWebDavEndpoint, WebDavSyncProvider } from './providers/webdav-provider';

let inFlightSync: Promise<{
    result: SyncResult;
    nextMeta: SyncStateMeta;
    pulledPayload?: SyncWorkspacePayload;
    conflict?: SyncConflictState;
}> | null = null;

export function getEndpointUrlForConfig(config: SyncConfig): string | null {
    switch (config.provider) {
        case 'webdav':
            return normalizeWebDavEndpoint(config.webdav.endpoint, config.webdav.preset) || null;
        case 'r2':
            return resolveS3Endpoint('r2', config.r2) || null;
        case 's3':
            return resolveS3Endpoint('s3', config.s3) || null;
        case 'r2-worker':
            return config.r2Worker.endpoint.trim()
                ? normalizeWorkerEndpoint(config.r2Worker.endpoint)
                : null;
        case 'google-drive':
        case 'none':
        default:
            return null;
    }
}

export function createProviderFromConfig(config: SyncConfig): SyncProvider | null {
    switch (config.provider) {
        case 'webdav':
            return new WebDavSyncProvider(config.webdav);
        case 'r2':
            return new S3R2SyncProvider('r2', config.r2);
        case 's3':
            return new S3R2SyncProvider('s3', config.s3);
        case 'r2-worker':
            return new R2WorkerSyncProvider(config.r2Worker);
        case 'google-drive':
            return new GoogleDriveSyncProvider(config.googleDrive);
        case 'none':
        default:
            return null;
    }
}

export async function testProviderConnection(
    config: SyncConfig,
): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
    if (isOfflineOnlyMode()) {
        throw new NetworkBlockedError();
    }
    if (config.provider === 'none') {
        return { ok: false, latencyMs: 0, message: 'No cloud sync provider selected.' };
    }
    if (config.provider === 'google-drive') {
        const drive = new GoogleDriveSyncProvider(config.googleDrive);
        return drive.testConnection();
    }

    const endpointUrl = getEndpointUrlForConfig(config);
    if (!endpointUrl) {
        return { ok: false, latencyMs: 0, message: 'Please enter a valid endpoint URL.' };
    }

    const granted = await ensureOriginPermissionForUrl(endpointUrl);
    if (!granted) {
        return {
            ok: false,
            latencyMs: 0,
            message: 'Browser denied host permission for the sync endpoint.',
        };
    }

    const provider = createProviderFromConfig(config);
    if (!provider) {
        return { ok: false, latencyMs: 0, message: 'Unsupported sync provider.' };
    }
    return provider.testConnection();
}

export async function runWorkspaceSync(params: {
    config: SyncConfig;
    local: SyncWorkspacePayload;
    meta: SyncStateMeta;
    mode: SyncRunMode;
}): Promise<{
    result: SyncResult;
    nextMeta: SyncStateMeta;
    pulledPayload?: SyncWorkspacePayload;
    conflict?: SyncConflictState;
}> {
    if (isOfflineOnlyMode()) {
        throw new NetworkBlockedError();
    }
    if (inFlightSync) {
        return inFlightSync;
    }

    const job = (async () => {
        if (params.config.provider === 'none' || params.config.provider === 'google-drive') {
            throw new Error('Configure an active cloud sync provider before syncing.');
        }

        const endpointUrl = getEndpointUrlForConfig(params.config);
        if (!endpointUrl) {
            throw new Error('Cloud sync endpoint URL is missing.');
        }
        const granted = await ensureOriginPermissionForUrl(endpointUrl);
        if (!granted) {
            throw new Error('Host permission for the cloud sync endpoint was denied.');
        }

        const provider = createProviderFromConfig(params.config);
        if (!provider) {
            throw new Error('Failed to create sync provider.');
        }

        return executeSyncCycle({
            provider,
            local: params.local,
            meta: params.meta,
            mode: params.mode,
            e2eeEnabled: params.config.e2eeEnabled,
            passphrase: params.config.e2eePassphrase,
        });
    })();

    inFlightSync = job;
    try {
        return await job;
    } finally {
        inFlightSync = null;
    }
}

export async function createShortShareWithWorker(
    config: SyncConfig,
    bundle: ShareBundle,
    ttlSeconds = 2592000,
): Promise<ShortShareResponse> {
    if (isOfflineOnlyMode()) {
        throw new NetworkBlockedError();
    }
    if (config.provider !== 'r2-worker') {
        throw new Error('Cloudflare R2 + Worker provider must be active for short-link sharing.');
    }
    const endpointUrl = getEndpointUrlForConfig(config);
    if (!endpointUrl) {
        throw new Error('Worker endpoint URL is required.');
    }
    const granted = await ensureOriginPermissionForUrl(endpointUrl);
    if (!granted) {
        throw new Error('Host permission for Worker URL was denied.');
    }
    const worker = new R2WorkerSyncProvider(config.r2Worker);
    return worker.createShortShare(bundle, ttlSeconds);
}
