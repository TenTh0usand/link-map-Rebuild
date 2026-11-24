import Dexie, { type Table } from 'dexie';

import { normalizeSiteUrl } from '../core/categorizer';
import { parseLinkMapJson, type LegacyV1Export, type LegacyV1Node } from '../core/parsers/link-map-v1';
import {
    DEFAULT_APP_SETTINGS,
    type AppSettings,
    type CollectionCategory,
    type CollectionNode,
    type SiteMetaRecord,
    type TreeNode,
} from '../core/types';
import {
    DEFAULT_AI_CONFIG,
    type AiConfig,
    type AiWorkDigestRecord,
} from './ai/types';
import {
    DEFAULT_SYNC_CONFIG,
    type SyncConfig,
    type SyncStateMeta,
} from './sync/types';

export const SNAPSHOT_ID = 'current';
export const SETTINGS_ID = 1;
export const IMPORT_STAGING_ID = 'latest';
const SYNC_CONFIG_KEY = 'syncConfig';
const SYNC_META_KEY = 'syncMeta';
const AI_CONFIG_KEY = 'aiConfig';
const MAX_ROLLING_BACKUPS = 10;
const MAX_AI_DIGESTS = 20;

export interface SnapshotRecord {
    id: string;
    nodes: TreeNode[];
    collections: CollectionNode[];
    updatedAt: number;
}

export interface BackupRecord {
    id?: number;
    createdAt: number;
    reason: 'auto' | 'manual' | 'pre-import';
    label?: string;
    nodeCount: number;
    nodes: TreeNode[];
    collections: CollectionNode[];
}

export interface SettingsRecord extends AppSettings {
    id: number;
}

export interface ImportStagingRecord {
    id: string;
    sourceType: 'linkMap' | 'tabsOutliner';
    nodes: TreeNode[];
    collections: CollectionNode[];
    exportTime?: string;
    createdAt: number;
}

function countTreeNodes(nodes: TreeNode[]): number {
    let total = 0;
    for (const n of nodes) {
        total += 1 + countTreeNodes(n.children);
    }
    return total;
}

export interface SyncStoreRecord {
    id: string;
    value: unknown;
}

function mergeSyncConfig(raw?: Partial<SyncConfig> | null): SyncConfig {
    return {
        provider: raw?.provider ?? DEFAULT_SYNC_CONFIG.provider,
        autoSync: raw?.autoSync ?? DEFAULT_SYNC_CONFIG.autoSync,
        autoSyncIntervalSec: raw?.autoSyncIntervalSec ?? DEFAULT_SYNC_CONFIG.autoSyncIntervalSec,
        e2eeEnabled: raw?.e2eeEnabled ?? DEFAULT_SYNC_CONFIG.e2eeEnabled,
        e2eePassphrase: raw?.e2eePassphrase ?? DEFAULT_SYNC_CONFIG.e2eePassphrase,
        webdav: { ...DEFAULT_SYNC_CONFIG.webdav, ...(raw?.webdav ?? {}) },
        r2: { ...DEFAULT_SYNC_CONFIG.r2, ...(raw?.r2 ?? {}) },
        s3: { ...DEFAULT_SYNC_CONFIG.s3, ...(raw?.s3 ?? {}) },
        r2Worker: { ...DEFAULT_SYNC_CONFIG.r2Worker, ...(raw?.r2Worker ?? {}) },
        googleDrive: { ...DEFAULT_SYNC_CONFIG.googleDrive, ...(raw?.googleDrive ?? {}) },
    };
}

function mergeAiConfig(raw?: Partial<AiConfig> | null): AiConfig {
    return {
        ...DEFAULT_AI_CONFIG,
        ...(raw ?? {}),
        excludedDomains: Array.isArray(raw?.excludedDomains)
            ? raw.excludedDomains
            : [...DEFAULT_AI_CONFIG.excludedDomains],
    };
}

function generateDeviceId(): string {
    return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class LinkMapV2DB extends Dexie {
    snapshots!: Table<SnapshotRecord, string>;
    backups!: Table<BackupRecord, number>;
    settings!: Table<SettingsRecord, number>;
    importStaging!: Table<ImportStagingRecord, string>;
    siteMeta!: Table<SiteMetaRecord, string>;
    syncStore!: Table<SyncStoreRecord, string>;
    aiDigests!: Table<AiWorkDigestRecord, string>;

    constructor() {
        super('LinkMapV2DB');
        this.version(1).stores({
            snapshots: 'id',
            backups: '++id, createdAt',
            settings: 'id',
            importStaging: 'id',
        });
        this.version(2).stores({
            snapshots: 'id',
            backups: '++id, createdAt',
            settings: 'id',
            importStaging: 'id',
            siteMeta: 'url',
        });
        this.version(3).stores({
            snapshots: 'id',
            backups: '++id, createdAt',
            settings: 'id',
            importStaging: 'id',
            siteMeta: 'url',
            syncStore: 'id',
        });
        this.version(4).stores({
            snapshots: 'id',
            backups: '++id, createdAt',
            settings: 'id',
            importStaging: 'id',
            siteMeta: 'url',
            syncStore: 'id',
            aiDigests: 'id, createdAt',
        });
    }

    async getSnapshot(): Promise<SnapshotRecord | undefined> {
        return this.snapshots.get(SNAPSHOT_ID);
    }

    async saveSnapshot(nodes: TreeNode[], collections: CollectionNode[]): Promise<void> {
        await this.snapshots.put({
            id: SNAPSHOT_ID,
            nodes,
            collections,
            updatedAt: Date.now(),
        });
    }

    async getSettings(): Promise<AppSettings> {
        const stored = await this.settings.get(SETTINGS_ID);
        if (!stored) {
            const initial: SettingsRecord = { id: SETTINGS_ID, ...DEFAULT_APP_SETTINGS };
            await this.settings.put(initial);
            return { ...DEFAULT_APP_SETTINGS };
        }
        const { id: _id, ...rest } = stored;
        return { ...DEFAULT_APP_SETTINGS, ...rest };
    }

    async updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
        const current = await this.getSettings();
        const next: AppSettings = { ...current, ...partial };
        await this.settings.put({ id: SETTINGS_ID, ...next });
        return next;
    }

    async createRollingBackup(
        nodes: TreeNode[],
        collections: CollectionNode[],
        reason: BackupRecord['reason'],
        label?: string,
    ): Promise<number> {
        const id = await this.backups.add({
            createdAt: Date.now(),
            reason,
            label,
            nodeCount: countTreeNodes(nodes) + countTreeNodes(collections),
            nodes,
            collections,
        });

        const allIds = await this.backups.orderBy('createdAt').primaryKeys();
        if (allIds.length > MAX_ROLLING_BACKUPS) {
            const toDelete = allIds.slice(0, allIds.length - MAX_ROLLING_BACKUPS);
            await this.backups.bulkDelete(toDelete);
        }
        return id;
    }

    async listBackups(): Promise<BackupRecord[]> {
        return this.backups.orderBy('createdAt').reverse().toArray();
    }

    async getBackup(id: number): Promise<BackupRecord | undefined> {
        return this.backups.get(id);
    }

    async deleteBackup(id: number): Promise<void> {
        await this.backups.delete(id);
    }

    async stageImportData(
        sourceType: 'linkMap' | 'tabsOutliner',
        nodes: TreeNode[],
        collections: CollectionNode[],
        exportTime?: string,
    ): Promise<void> {
        await this.importStaging.put({
            id: IMPORT_STAGING_ID,
            sourceType,
            nodes,
            collections,
            exportTime,
            createdAt: Date.now(),
        });
    }

    async getStagedImportData(): Promise<ImportStagingRecord | undefined> {
        return this.importStaging.get(IMPORT_STAGING_ID);
    }

    async getAllSiteMeta(): Promise<Record<string, SiteMetaRecord>> {
        const rows = await this.siteMeta.toArray();
        const out: Record<string, SiteMetaRecord> = {};
        for (const row of rows) {
            out[row.url] = row;
        }
        return out;
    }

    async upsertSiteMeta(
        rawUrl: string,
        description: string,
        source: 'manual' | 'ai' = 'manual',
        category?: CollectionCategory,
    ): Promise<SiteMetaRecord> {
        const url = normalizeSiteUrl(rawUrl);
        const existing = await this.siteMeta.get(url);
        const next: SiteMetaRecord = {
            url,
            description: description.trim(),
            category: category ?? existing?.category,
            source,
            updatedAt: Date.now(),
        };
        await this.siteMeta.put(next);
        return next;
    }

    async deleteSiteMeta(rawUrl: string): Promise<void> {
        await this.siteMeta.delete(normalizeSiteUrl(rawUrl));
    }

    async replaceAllSiteMeta(map: Record<string, SiteMetaRecord>): Promise<void> {
        await this.transaction('rw', this.siteMeta, async () => {
            await this.siteMeta.clear();
            const entries = Object.values(map);
            if (entries.length > 0) {
                await this.siteMeta.bulkPut(entries);
            }
        });
    }

    async getSyncConfig(): Promise<SyncConfig> {
        const row = await this.syncStore.get(SYNC_CONFIG_KEY);
        if (!row) {
            const initial = mergeSyncConfig();
            await this.syncStore.put({ id: SYNC_CONFIG_KEY, value: initial });
            return initial;
        }
        return mergeSyncConfig(row.value as Partial<SyncConfig>);
    }

    async saveSyncConfig(config: SyncConfig): Promise<SyncConfig> {
        const normalized = mergeSyncConfig(config);
        await this.syncStore.put({ id: SYNC_CONFIG_KEY, value: normalized });
        return normalized;
    }

    async getSyncMeta(): Promise<SyncStateMeta> {
        const row = await this.syncStore.get(SYNC_META_KEY);
        if (!row) {
            const initial: SyncStateMeta = {
                deviceId: generateDeviceId(),
                lastSyncedAt: null,
                lastSyncStatus: 'idle',
                lastManifestHash: null,
                lastChunkHashes: {},
            };
            await this.syncStore.put({ id: SYNC_META_KEY, value: initial });
            return initial;
        }
        const stored = row.value as Partial<SyncStateMeta>;
        return {
            deviceId: stored.deviceId || generateDeviceId(),
            lastSyncedAt: stored.lastSyncedAt ?? null,
            lastSyncStatus: stored.lastSyncStatus ?? 'idle',
            lastSyncMessage: stored.lastSyncMessage,
            lastManifestHash: stored.lastManifestHash ?? null,
            lastChunkHashes: stored.lastChunkHashes ?? {},
        };
    }

    async saveSyncMeta(meta: SyncStateMeta): Promise<SyncStateMeta> {
        await this.syncStore.put({ id: SYNC_META_KEY, value: meta });
        return meta;
    }

    async bulkUpsertSiteMeta(
        items: Array<{
            url: string;
            description: string;
            category?: CollectionCategory;
            source: 'manual' | 'ai';
        }>,
        options: { overwriteManual?: boolean } = {},
    ): Promise<Record<string, SiteMetaRecord>> {
        await this.transaction('rw', this.siteMeta, async () => {
            const now = Date.now();
            for (const item of items) {
                const url = normalizeSiteUrl(item.url);
                const existing = await this.siteMeta.get(url);
                if (existing?.source === 'manual' && !options.overwriteManual) {
                    continue;
                }
                const next: SiteMetaRecord = {
                    url,
                    description: item.description.trim(),
                    category: item.category ?? existing?.category,
                    source: item.source,
                    updatedAt: now,
                };
                await this.siteMeta.put(next);
            }
        });
        return this.getAllSiteMeta();
    }

    async getAiConfig(): Promise<AiConfig> {
        const row = await this.syncStore.get(AI_CONFIG_KEY);
        if (!row) {
            const initial = mergeAiConfig();
            await this.syncStore.put({ id: AI_CONFIG_KEY, value: initial });
            return initial;
        }
        return mergeAiConfig(row.value as Partial<AiConfig>);
    }

    async saveAiConfig(config: AiConfig): Promise<AiConfig> {
        const normalized = mergeAiConfig(config);
        await this.syncStore.put({ id: AI_CONFIG_KEY, value: normalized });
        return normalized;
    }

    async listAiDigests(): Promise<AiWorkDigestRecord[]> {
        return this.aiDigests.orderBy('createdAt').reverse().toArray();
    }

    async saveAiDigest(record: AiWorkDigestRecord): Promise<void> {
        await this.aiDigests.put(record);
        const ids = await this.aiDigests.orderBy('createdAt').primaryKeys();
        if (ids.length > MAX_AI_DIGESTS) {
            await this.aiDigests.bulkDelete(ids.slice(0, ids.length - MAX_AI_DIGESTS));
        }
    }

    async deleteAiDigest(id: string): Promise<void> {
        await this.aiDigests.delete(id);
    }

    /**
     * Read-only migration from legacy v1 TabMasterDB if v2 snapshot does not yet exist.
     */
    async tryMigrateFromLegacyV1(): Promise<SnapshotRecord | null> {
        const existing = await this.getSnapshot();
        if (existing) return existing;

        try {
            if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
                return null;
            }
            const dbs = await indexedDB.databases();
            const hasLegacy = dbs.some((d) => d.name === 'TabMasterDB');
            if (!hasLegacy) return null;

            const legacyDb = new Dexie('TabMasterDB');
            legacyDb.version(2).stores({
                snapshot: 'id',
                setting: 'id',
            });
            await legacyDb.open();
            const legacySnap = (await legacyDb.table('snapshot').get('snapshot')) as
                | { data?: LegacyV1Node[] }
                | undefined;
            legacyDb.close();

            if (!legacySnap?.data || !Array.isArray(legacySnap.data) || legacySnap.data.length === 0) {
                return null;
            }
            const payload: LegacyV1Export = { rawData: legacySnap.data };
            const parsed = parseLinkMapJson(payload);
            await this.saveSnapshot(parsed.nodes, parsed.collections);
            return (await this.getSnapshot()) ?? null;
        } catch {
            return null;
        }
    }
}

export const db = new LinkMapV2DB();
