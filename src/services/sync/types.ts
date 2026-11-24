import type { CollectionNode, SiteMetaRecord, TreeNode } from '../../core/types';

export type SyncProviderType = 'webdav' | 's3' | 'r2' | 'r2-worker' | 'google-drive';
export type ActiveSyncProviderType = 'none' | SyncProviderType;

export type WebDavPreset = 'jianguoyun' | '123pan' | 'openlist' | 'custom';

export interface WebDavConfig {
    preset: WebDavPreset;
    endpoint: string;
    basePath: string;
    username: string;
    password: string;
}

export interface S3R2Config {
    endpoint: string;
    accountId: string;
    region: string;
    bucket: string;
    prefix: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
}

export interface R2WorkerConfig {
    endpoint: string;
    token: string;
    prefix: string;
}

export interface GoogleDriveConfig {
    folderName: string;
    connectedEmail?: string;
}

export interface SyncConfig {
    provider: ActiveSyncProviderType;
    autoSync: boolean;
    autoSyncIntervalSec: number;
    e2eeEnabled: boolean;
    e2eePassphrase: string;
    webdav: WebDavConfig;
    r2: S3R2Config;
    s3: S3R2Config;
    r2Worker: R2WorkerConfig;
    googleDrive: GoogleDriveConfig;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
    provider: 'none',
    autoSync: false,
    autoSyncIntervalSec: 60,
    e2eeEnabled: false,
    e2eePassphrase: '',
    webdav: {
        preset: 'jianguoyun',
        endpoint: 'https://dav.jianguoyun.com/dav/',
        basePath: 'LinkMap',
        username: '',
        password: '',
    },
    r2: {
        endpoint: '',
        accountId: '',
        region: 'auto',
        bucket: '',
        prefix: 'link-map',
        accessKeyId: '',
        secretAccessKey: '',
        forcePathStyle: true,
    },
    s3: {
        endpoint: '',
        accountId: '',
        region: 'us-east-1',
        bucket: '',
        prefix: 'link-map',
        accessKeyId: '',
        secretAccessKey: '',
        forcePathStyle: true,
    },
    r2Worker: {
        endpoint: '',
        token: '',
        prefix: 'link-map',
    },
    googleDrive: {
        folderName: 'appDataFolder',
    },
};

export interface SyncManifest {
    schemaVersion: 2;
    updatedAt: number;
    deviceId: string;
    encrypted?: boolean;
    appVersion?: string;
    chunks: Record<
        string,
        {
            hash: string;
            updatedAt: number;
            size: number;
        }
    >;
}

export interface SyncChunk {
    id: string;
    hash: string;
    payloadBase64: string;
    encrypted: boolean;
    compressed: boolean;
}

export interface SyncResult {
    status: 'pushed' | 'pulled' | 'noop' | 'conflict' | 'error';
    syncedAt: number;
    message?: string;
}

export interface SyncStateMeta {
    deviceId: string;
    lastSyncedAt: number | null;
    lastSyncStatus: 'idle' | 'pushed' | 'pulled' | 'noop' | 'conflict' | 'error';
    lastSyncMessage?: string;
    lastManifestHash: string | null;
    lastChunkHashes: Record<string, string>;
}

export interface SyncWorkspacePayload {
    nodes: TreeNode[];
    collections: CollectionNode[];
    siteMeta: Record<string, SiteMetaRecord>;
}

export interface SyncConflictState {
    detectedAt: number;
    remoteManifest: SyncManifest;
    localCounts: {
        nodes: number;
        collections: number;
        siteMeta: number;
    };
    remoteUpdatedAt: number;
    remoteDeviceId: string;
}

export interface ShortShareResponse {
    id: string;
    url: string;
    expiresAt: number | null;
}

/**
 * SyncProvider adapter contract (WebDAV, S3 / Cloudflare R2 + Worker, Google Drive).
 */
export interface SyncProvider {
    readonly type: SyncProviderType;
    testConnection(): Promise<{ ok: boolean; latencyMs: number; message?: string }>;
    readManifest(): Promise<SyncManifest | null>;
    writeManifest(manifest: SyncManifest): Promise<void>;
    readChunk(chunkId: string): Promise<SyncChunk | null>;
    writeChunk(chunk: SyncChunk): Promise<void>;
    deleteChunk(chunkId: string): Promise<void>;
}
