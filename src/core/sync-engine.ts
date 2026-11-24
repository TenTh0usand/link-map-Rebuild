import type {
    SyncChunk,
    SyncConflictState,
    SyncManifest,
    SyncProvider,
    SyncResult,
    SyncStateMeta,
    SyncWorkspacePayload,
} from '../services/sync/types';
import { packSyncChunk, sha256Hex, unpackSyncChunk } from './sync-crypto';
import type { CollectionNode, SiteMetaRecord, TabNode, TreeNode } from './types';

export const SYNC_CHUNK_IDS = ['tree', 'collections', 'siteMeta'] as const;
export type SyncChunkId = (typeof SYNC_CHUNK_IDS)[number];

export type SyncRunMode = 'smart' | 'forcePush' | 'forcePull' | 'resolveMerge';

function countTreeNodes(nodes: TreeNode[]): number {
    let total = 0;
    for (const n of nodes) {
        total += 1 + countTreeNodes(n.children);
    }
    return total;
}

/**
 * Strips device-local live browser IDs and ephemeral focus/geometry state so
 * cross-device syncs do not churn hashes on tab switches or collide on integer IDs.
 */
export function sanitizeTreeForSync(nodes: TreeNode[]): TreeNode[] {
    return nodes.map((node): TreeNode => {
        const children = sanitizeTreeForSync(node.children);
        if (node.nodeType === 'window') {
            return {
                id: node.id,
                nodeType: 'window',
                title: node.title,
                ...(node.alias ? { alias: node.alias } : {}),
                expanded: node.expanded,
                ...(node.saved ? { saved: node.saved } : {}),
                closed: true,
                ...(node.windowType ? { windowType: node.windowType } : {}),
                ...(node.incognito ? { incognito: node.incognito } : {}),
                ...(node.createdAt ? { createdAt: node.createdAt } : {}),
                ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
                children,
            };
        }
        if (node.nodeType === 'tabGroup') {
            return {
                id: node.id,
                nodeType: 'tabGroup',
                title: node.title,
                ...(node.alias ? { alias: node.alias } : {}),
                color: node.color,
                collapsed: node.collapsed,
                expanded: node.expanded,
                ...(node.saved ? { saved: node.saved } : {}),
                closed: true,
                ...(node.createdAt ? { createdAt: node.createdAt } : {}),
                ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
                children,
            };
        }
        if (node.nodeType === 'tab') {
            const url = node.url || node.pendingUrl || '';
            return {
                id: node.id,
                nodeType: 'tab',
                title: node.title,
                ...(node.alias ? { alias: node.alias } : {}),
                url,
                ...(node.favIconUrl ? { favIconUrl: node.favIconUrl } : {}),
                index: node.index,
                ...(node.pinned ? { pinned: node.pinned } : {}),
                active: false,
                closed: true,
                expanded: node.expanded,
                ...(node.saved ? { saved: node.saved } : {}),
                ...(node.categoryHint ? { categoryHint: node.categoryHint } : {}),
                ...(node.description ? { description: node.description } : {}),
                ...(node.tags && node.tags.length > 0 ? { tags: [...node.tags] } : {}),
                ...(node.createdAt ? { createdAt: node.createdAt } : {}),
                ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
                children,
            };
        }
        if (node.nodeType === 'collection') {
            return {
                ...node,
                children,
            };
        }
        return {
            id: node.id,
            nodeType: 'note',
            title: node.title,
            ...(node.alias ? { alias: node.alias } : {}),
            expanded: node.expanded,
            ...(node.saved ? { saved: node.saved } : {}),
            ...(node.createdAt ? { createdAt: node.createdAt } : {}),
            ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
            children,
        };
    });
}

function normalizePayloadForSync(payload: SyncWorkspacePayload): SyncWorkspacePayload {
    const sortedSiteMeta: Record<string, SiteMetaRecord> = {};
    for (const key of Object.keys(payload.siteMeta).sort()) {
        sortedSiteMeta[key] = payload.siteMeta[key]!;
    }
    return {
        nodes: sanitizeTreeForSync(payload.nodes),
        collections: payload.collections.map((c) => ({
            ...c,
            children: sanitizeTreeForSync(c.children),
        })),
        siteMeta: sortedSiteMeta,
    };
}

export async function computeManifestHash(manifest: SyncManifest): Promise<string> {
    const pairs = SYNC_CHUNK_IDS.map((id) => [id, manifest.chunks[id]?.hash ?? '']);
    return sha256Hex(JSON.stringify(pairs));
}

export async function buildLocalChunks(
    payload: SyncWorkspacePayload,
    options: { deviceId: string; passphrase?: string; appVersion?: string },
): Promise<{
    sanitizedPayload: SyncWorkspacePayload;
    chunks: Record<SyncChunkId, SyncChunk>;
    manifest: SyncManifest;
    manifestHash: string;
}> {
    const sanitizedPayload = normalizePayloadForSync(payload);
    const now = Date.now();
    const passphrase = options.passphrase?.trim() ?? '';

    const [treePacked, collectionsPacked, siteMetaPacked] = await Promise.all([
        packSyncChunk('tree', sanitizedPayload.nodes, { passphrase }),
        packSyncChunk('collections', sanitizedPayload.collections, { passphrase }),
        packSyncChunk('siteMeta', sanitizedPayload.siteMeta, { passphrase }),
    ]);

    const chunks: Record<SyncChunkId, SyncChunk> = {
        tree: treePacked.chunk,
        collections: collectionsPacked.chunk,
        siteMeta: siteMetaPacked.chunk,
    };

    const manifest: SyncManifest = {
        schemaVersion: 2,
        updatedAt: now,
        deviceId: options.deviceId,
        encrypted: passphrase.length > 0,
        appVersion: options.appVersion ?? '2.0.0',
        chunks: {
            tree: {
                hash: treePacked.plainHash,
                updatedAt: now,
                size: treePacked.rawSize,
            },
            collections: {
                hash: collectionsPacked.plainHash,
                updatedAt: now,
                size: collectionsPacked.rawSize,
            },
            siteMeta: {
                hash: siteMetaPacked.plainHash,
                updatedAt: now,
                size: siteMetaPacked.rawSize,
            },
        },
    };

    const manifestHash = await computeManifestHash(manifest);
    return { sanitizedPayload, chunks, manifest, manifestHash };
}

function mergeTreeNodeLists(localNodes: TreeNode[], remoteNodes: TreeNode[]): TreeNode[] {
    const localMap = new Map<string, TreeNode>();
    const result: TreeNode[] = localNodes.map((n) => {
        const cloned: TreeNode = { ...n, children: [...n.children] };
        localMap.set(cloned.id, cloned);
        return cloned;
    });

    for (const rNode of remoteNodes) {
        const existing = localMap.get(rNode.id);
        if (!existing) {
            result.push(rNode);
        } else {
            existing.children = mergeTreeNodeLists(existing.children, rNode.children);
            if ((rNode.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
                if (rNode.alias && !existing.alias) existing.alias = rNode.alias;
                if (rNode.saved) existing.saved = true;
            }
        }
    }

    return result;
}

function collectTabUrls(nodes: TreeNode[]): Set<string> {
    const urls = new Set<string>();
    const walk = (list: TreeNode[]) => {
        for (const n of list) {
            if (n.nodeType === 'tab') {
                const u = (n as TabNode).url || (n as TabNode).pendingUrl;
                if (u) urls.add(u);
            }
            walk(n.children);
        }
    };
    walk(nodes);
    return urls;
}

function mergeCollections(
    localCols: CollectionNode[],
    remoteCols: CollectionNode[],
): CollectionNode[] {
    const byId = new Map<string, CollectionNode>();
    const out: CollectionNode[] = localCols.map((c) => {
        const copy: CollectionNode = { ...c, children: [...c.children] };
        byId.set(copy.id, copy);
        return copy;
    });

    for (const rCol of remoteCols) {
        const existing = byId.get(rCol.id);
        if (!existing) {
            out.push(rCol);
            continue;
        }
        const mergedChildren = mergeTreeNodeLists(existing.children, []);
        const existingIds = new Set(mergedChildren.map((c) => c.id));
        const existingUrls = collectTabUrls(mergedChildren);
        for (const child of rCol.children) {
            if (existingIds.has(child.id)) continue;
            if (child.nodeType === 'tab' && existingUrls.has(child.url)) continue;
            mergedChildren.push(child);
            existingIds.add(child.id);
        }
        existing.children = mergedChildren;
        if ((rCol.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
            existing.title = rCol.title;
            existing.color = rCol.color;
            existing.category = rCol.category;
            existing.updatedAt = rCol.updatedAt;
        }
    }

    return out;
}

export function mergeSyncPayloads(
    local: SyncWorkspacePayload,
    remote: SyncWorkspacePayload,
): SyncWorkspacePayload {
    const siteMeta: Record<string, SiteMetaRecord> = { ...local.siteMeta };
    for (const [url, rRecord] of Object.entries(remote.siteMeta)) {
        const lRecord = siteMeta[url];
        if (!lRecord || rRecord.updatedAt > lRecord.updatedAt) {
            siteMeta[url] = rRecord;
        }
    }

    return {
        nodes: mergeTreeNodeLists(local.nodes, remote.nodes),
        collections: mergeCollections(local.collections, remote.collections),
        siteMeta,
    };
}

function isTrivialLocalWorkspace(payload: SyncWorkspacePayload): boolean {
    if (payload.collections.length > 0 || Object.keys(payload.siteMeta).length > 0) {
        return false;
    }
    if (payload.nodes.length === 0) return true;
    if (payload.nodes.length > 1) return false;
    const onlyRoot = payload.nodes[0]!;
    if (onlyRoot.nodeType !== 'window' || onlyRoot.saved || onlyRoot.alias) return false;
    if (onlyRoot.children.length > 2) return false;
    return onlyRoot.children.every((c) => {
        if (c.nodeType !== 'tab' || c.saved || c.alias || c.children.length > 0) return false;
        const u = c.url || c.pendingUrl || '';
        return (
            !u ||
            u === 'chrome://newtab/' ||
            u === 'edge://newtab/' ||
            u === 'about:blank'
        );
    });
}

async function readRemotePayload(
    provider: SyncProvider,
    remoteManifest: SyncManifest,
    localFallback: SyncWorkspacePayload,
    localChunks: Record<SyncChunkId, SyncChunk>,
    options: { passphrase?: string; downloadAll?: boolean },
): Promise<SyncWorkspacePayload> {
    const passphrase = options.passphrase?.trim() ?? '';
    if (remoteManifest.encrypted && !passphrase) {
        throw new Error('Remote sync data is encrypted. Please enter your E2EE passphrase.');
    }

    const needDownload = (id: SyncChunkId): boolean => {
        if (options.downloadAll) return true;
        const remoteMeta = remoteManifest.chunks[id];
        if (!remoteMeta) return false;
        return remoteMeta.hash !== localChunks[id].hash;
    };

    const fetchAndUnpack = async <T>(id: SyncChunkId, fallbackValue: T): Promise<T> => {
        if (!needDownload(id)) return fallbackValue;
        const remoteMeta = remoteManifest.chunks[id];
        if (!remoteMeta) return fallbackValue;
        const chunk = await provider.readChunk(id);
        if (!chunk) {
            throw new Error(`Remote sync chunk "${id}" is missing from cloud storage.`);
        }
        return unpackSyncChunk<T>(chunk, { passphrase });
    };

    const [nodes, collections, siteMeta] = await Promise.all([
        fetchAndUnpack<TreeNode[]>('tree', localFallback.nodes),
        fetchAndUnpack<CollectionNode[]>('collections', localFallback.collections),
        fetchAndUnpack<Record<string, SiteMetaRecord>>('siteMeta', localFallback.siteMeta),
    ]);

    return { nodes, collections, siteMeta };
}

function extractChunkHashes(manifest: SyncManifest): Record<string, string> {
    const hashes: Record<string, string> = {};
    for (const id of SYNC_CHUNK_IDS) {
        const entry = manifest.chunks[id];
        if (entry) {
            hashes[id] = entry.hash;
        }
    }
    return hashes;
}

export async function executeSyncCycle(params: {
    provider: SyncProvider;
    local: SyncWorkspacePayload;
    meta: SyncStateMeta;
    mode: SyncRunMode;
    passphrase?: string;
    e2eeEnabled: boolean;
}): Promise<{
    result: SyncResult;
    nextMeta: SyncStateMeta;
    pulledPayload?: SyncWorkspacePayload;
    conflict?: SyncConflictState;
}> {
    const effectivePassphrase = params.e2eeEnabled ? (params.passphrase?.trim() ?? '') : '';
    if (params.e2eeEnabled && !effectivePassphrase) {
        throw new Error('E2EE encryption is enabled, but no passphrase has been set.');
    }

    const built = await buildLocalChunks(params.local, {
        deviceId: params.meta.deviceId,
        passphrase: effectivePassphrase,
    });

    const remoteManifest = await params.provider.readManifest();
    const remoteManifestHash = remoteManifest ? await computeManifestHash(remoteManifest) : null;
    const syncedAt = Date.now();

    const uploadChangedChunksAndManifest = async (
        targetBuilt: typeof built,
        baselineManifest: SyncManifest | null,
        forceAllChunks = false,
    ) => {
        for (const id of SYNC_CHUNK_IDS) {
            const chunk = targetBuilt.chunks[id];
            const remoteHash = baselineManifest?.chunks[id]?.hash;
            if (forceAllChunks || !remoteHash || remoteHash !== chunk.hash) {
                await params.provider.writeChunk(chunk);
            }
        }
        await params.provider.writeManifest(targetBuilt.manifest);
    };

    if (!remoteManifest) {
        if (params.mode === 'forcePull') {
            return {
                result: { status: 'noop', syncedAt, message: 'No remote backup found on server.' },
                nextMeta: {
                    ...params.meta,
                    lastSyncedAt: syncedAt,
                    lastSyncStatus: 'noop',
                    lastSyncMessage: 'No remote backup found on server.',
                },
            };
        }
        await uploadChangedChunksAndManifest(built, null, true);
        return {
            result: { status: 'pushed', syncedAt, message: 'Initialized cloud backup.' },
            nextMeta: {
                deviceId: params.meta.deviceId,
                lastSyncedAt: syncedAt,
                lastSyncStatus: 'pushed',
                lastSyncMessage: 'Initialized cloud backup.',
                lastManifestHash: built.manifestHash,
                lastChunkHashes: extractChunkHashes(built.manifest),
            },
        };
    }

    const passphraseForRead = effectivePassphrase || params.passphrase?.trim() || '';

    if (params.mode === 'forcePush') {
        const forceAll = Boolean(remoteManifest.encrypted) !== Boolean(effectivePassphrase);
        await uploadChangedChunksAndManifest(built, remoteManifest, forceAll);
        return {
            result: { status: 'pushed', syncedAt, message: 'Overwrote cloud backup from local.' },
            nextMeta: {
                deviceId: params.meta.deviceId,
                lastSyncedAt: syncedAt,
                lastSyncStatus: 'pushed',
                lastSyncMessage: 'Overwrote cloud backup from local.',
                lastManifestHash: built.manifestHash,
                lastChunkHashes: extractChunkHashes(built.manifest),
            },
        };
    }

    if (params.mode === 'forcePull') {
        const pulled = await readRemotePayload(
            params.provider,
            remoteManifest,
            built.sanitizedPayload,
            built.chunks,
            { passphrase: passphraseForRead, downloadAll: true },
        );
        return {
            result: { status: 'pulled', syncedAt, message: 'Restored workspace from cloud.' },
            pulledPayload: pulled,
            nextMeta: {
                deviceId: params.meta.deviceId,
                lastSyncedAt: syncedAt,
                lastSyncStatus: 'pulled',
                lastSyncMessage: 'Restored workspace from cloud.',
                lastManifestHash: remoteManifestHash,
                lastChunkHashes: extractChunkHashes(remoteManifest),
            },
        };
    }

    if (params.mode === 'resolveMerge') {
        const remotePayload = await readRemotePayload(
            params.provider,
            remoteManifest,
            built.sanitizedPayload,
            built.chunks,
            { passphrase: passphraseForRead, downloadAll: false },
        );
        const merged = mergeSyncPayloads(built.sanitizedPayload, remotePayload);
        const mergedBuilt = await buildLocalChunks(merged, {
            deviceId: params.meta.deviceId,
            passphrase: effectivePassphrase,
        });
        await uploadChangedChunksAndManifest(mergedBuilt, remoteManifest, false);
        return {
            result: {
                status: 'pushed',
                syncedAt,
                message: 'Merged local and cloud changes.',
            },
            pulledPayload: mergedBuilt.sanitizedPayload,
            nextMeta: {
                deviceId: params.meta.deviceId,
                lastSyncedAt: syncedAt,
                lastSyncStatus: 'pushed',
                lastSyncMessage: 'Merged local and cloud changes.',
                lastManifestHash: mergedBuilt.manifestHash,
                lastChunkHashes: extractChunkHashes(mergedBuilt.manifest),
            },
        };
    }

    // Smart sync mode
    if (remoteManifestHash === built.manifestHash) {
        return {
            result: { status: 'noop', syncedAt, message: 'Already up to date.' },
            nextMeta: {
                deviceId: params.meta.deviceId,
                lastSyncedAt: syncedAt,
                lastSyncStatus: 'noop',
                lastSyncMessage: 'Already up to date.',
                lastManifestHash: built.manifestHash,
                lastChunkHashes: extractChunkHashes(built.manifest),
            },
        };
    }

    if (params.meta.lastManifestHash === null) {
        if (isTrivialLocalWorkspace(built.sanitizedPayload)) {
            const pulled = await readRemotePayload(
                params.provider,
                remoteManifest,
                built.sanitizedPayload,
                built.chunks,
                { passphrase: passphraseForRead, downloadAll: true },
            );
            return {
                result: { status: 'pulled', syncedAt, message: 'Initial pull from cloud.' },
                pulledPayload: pulled,
                nextMeta: {
                    deviceId: params.meta.deviceId,
                    lastSyncedAt: syncedAt,
                    lastSyncStatus: 'pulled',
                    lastSyncMessage: 'Initial pull from cloud.',
                    lastManifestHash: remoteManifestHash,
                    lastChunkHashes: extractChunkHashes(remoteManifest),
                },
            };
        }

        const conflict: SyncConflictState = {
            detectedAt: syncedAt,
            remoteManifest,
            localCounts: {
                nodes: countTreeNodes(built.sanitizedPayload.nodes),
                collections: built.sanitizedPayload.collections.length,
                siteMeta: Object.keys(built.sanitizedPayload.siteMeta).length,
            },
            remoteUpdatedAt: remoteManifest.updatedAt,
            remoteDeviceId: remoteManifest.deviceId,
        };
        return {
            result: {
                status: 'conflict',
                syncedAt,
                message: 'Both local and cloud have data on first sync; choose how to reconcile.',
            },
            conflict,
            nextMeta: {
                ...params.meta,
                lastSyncStatus: 'conflict',
                lastSyncMessage: 'Sync conflict requires manual resolution.',
            },
        };
    }

    const localChanged = params.meta.lastManifestHash !== built.manifestHash;
    const remoteChanged = params.meta.lastManifestHash !== remoteManifestHash;

    if (localChanged && !remoteChanged) {
        const forceAll = Boolean(remoteManifest.encrypted) !== Boolean(effectivePassphrase);
        await uploadChangedChunksAndManifest(built, remoteManifest, forceAll);
        return {
            result: { status: 'pushed', syncedAt, message: 'Uploaded local changes.' },
            nextMeta: {
                deviceId: params.meta.deviceId,
                lastSyncedAt: syncedAt,
                lastSyncStatus: 'pushed',
                lastSyncMessage: 'Uploaded local changes.',
                lastManifestHash: built.manifestHash,
                lastChunkHashes: extractChunkHashes(built.manifest),
            },
        };
    }

    if (!localChanged && remoteChanged) {
        const pulled = await readRemotePayload(
            params.provider,
            remoteManifest,
            built.sanitizedPayload,
            built.chunks,
            { passphrase: passphraseForRead, downloadAll: false },
        );
        return {
            result: { status: 'pulled', syncedAt, message: 'Downloaded cloud updates.' },
            pulledPayload: pulled,
            nextMeta: {
                deviceId: params.meta.deviceId,
                lastSyncedAt: syncedAt,
                lastSyncStatus: 'pulled',
                lastSyncMessage: 'Downloaded cloud updates.',
                lastManifestHash: remoteManifestHash,
                lastChunkHashes: extractChunkHashes(remoteManifest),
            },
        };
    }

    const conflict: SyncConflictState = {
        detectedAt: syncedAt,
        remoteManifest,
        localCounts: {
            nodes: countTreeNodes(built.sanitizedPayload.nodes),
            collections: built.sanitizedPayload.collections.length,
            siteMeta: Object.keys(built.sanitizedPayload.siteMeta).length,
        },
        remoteUpdatedAt: remoteManifest.updatedAt,
        remoteDeviceId: remoteManifest.deviceId,
    };
    return {
        result: {
            status: 'conflict',
            syncedAt,
            message: 'Both local and cloud changed since last sync.',
        },
        conflict,
        nextMeta: {
            ...params.meta,
            lastSyncStatus: 'conflict',
            lastSyncMessage: 'Both local and cloud changed since last sync.',
        },
    };
}
