import type { GoogleDriveConfig, SyncChunk, SyncManifest, SyncProvider } from '../types';

/**
 * Reserved Google Drive (`appDataFolder`) adapter scaffold for a future release.
 * Keeps `identity` OAuth permissions out of MV3 manifest until enabled.
 */
export class GoogleDriveSyncProvider implements SyncProvider {
    readonly type = 'google-drive' as const;
    readonly config: GoogleDriveConfig;

    constructor(config: GoogleDriveConfig) {
        this.config = config;
    }

    async testConnection(): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
        return {
            ok: false,
            latencyMs: 0,
            message: 'Google Drive (appDataFolder) OAuth sync is planned for a future release.',
        };
    }

    async readManifest(): Promise<SyncManifest | null> {
        throw new Error('Google Drive sync is not yet enabled.');
    }

    async writeManifest(_manifest: SyncManifest): Promise<void> {
        throw new Error('Google Drive sync is not yet enabled.');
    }

    async readChunk(_chunkId: string): Promise<SyncChunk | null> {
        throw new Error('Google Drive sync is not yet enabled.');
    }

    async writeChunk(_chunk: SyncChunk): Promise<void> {
        throw new Error('Google Drive sync is not yet enabled.');
    }

    async deleteChunk(_chunkId: string): Promise<void> {
        throw new Error('Google Drive sync is not yet enabled.');
    }
}
