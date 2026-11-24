import { describe, expect, it } from 'vitest';

import type {
    SyncChunk,
    SyncManifest,
    SyncProvider,
    SyncStateMeta,
    SyncWorkspacePayload,
} from '../../services/sync/types';
import { executeSyncCycle, sanitizeTreeForSync } from '../sync-engine';
import type { CollectionNode, TabNode, WindowNode } from '../types';

class MemorySyncProvider implements SyncProvider {
    readonly type = 'r2' as const;
    manifest: SyncManifest | null = null;
    chunks = new Map<string, SyncChunk>();
    writtenChunks: string[] = [];
    readChunks: string[] = [];

    resetCounters() {
        this.writtenChunks = [];
        this.readChunks = [];
    }

    async testConnection() {
        return { ok: true, latencyMs: 1 };
    }

    async readManifest(): Promise<SyncManifest | null> {
        return this.manifest ? structuredClone(this.manifest) : null;
    }

    async writeManifest(manifest: SyncManifest): Promise<void> {
        this.manifest = structuredClone(manifest);
    }

    async readChunk(chunkId: string): Promise<SyncChunk | null> {
        this.readChunks.push(chunkId);
        const found = this.chunks.get(chunkId);
        return found ? structuredClone(found) : null;
    }

    async writeChunk(chunk: SyncChunk): Promise<void> {
        this.writtenChunks.push(chunk.id);
        this.chunks.set(chunk.id, structuredClone(chunk));
    }

    async deleteChunk(chunkId: string): Promise<void> {
        this.chunks.delete(chunkId);
    }
}

function makeTab(id: string, title: string, url: string, browserTabId?: number): TabNode {
    return {
        id,
        nodeType: 'tab',
        title,
        url,
        browserTabId,
        index: 0,
        active: Boolean(browserTabId),
        closed: !browserTabId,
        expanded: true,
        saved: true,
        children: [],
    };
}

function makeWindow(id: string, tabs: TabNode[], browserWindowId?: number): WindowNode {
    return {
        id,
        nodeType: 'window',
        title: 'Window',
        browserWindowId,
        focused: Boolean(browserWindowId),
        closed: !browserWindowId,
        expanded: true,
        children: tabs,
    };
}

function makeMeta(deviceId: string): SyncStateMeta {
    return {
        deviceId,
        lastSyncedAt: null,
        lastSyncStatus: 'idle',
        lastManifestHash: null,
        lastChunkHashes: {},
    };
}

describe('sync-engine', () => {
    it('strips ephemeral browser IDs during sanitizeTreeForSync', () => {
        const win = makeWindow('w1', [makeTab('t1', 'Docs', 'https://example.com', 101)], 55);
        const sanitized = sanitizeTreeForSync([win]);
        const sWin = sanitized[0] as WindowNode;
        const sTab = sWin.children[0] as TabNode;

        expect(sWin.browserWindowId).toBeUndefined();
        expect(sWin.closed).toBe(true);
        expect(sTab.browserTabId).toBeUndefined();
        expect(sTab.active).toBe(false);
        expect(sTab.closed).toBe(true);
    });

    it('performs initial push, noop when unchanged, and incremental chunk push/pull', async () => {
        const remote = new MemorySyncProvider();
        const colA: CollectionNode = {
            id: 'col_1',
            nodeType: 'collection',
            title: 'AI Tools',
            color: 'blue',
            category: 'workspace',
            expanded: true,
            saved: true,
            children: [makeTab('ct_1', 'DeepSeek', 'https://deepseek.com')],
            updatedAt: 1000,
        };

        const payloadA: SyncWorkspacePayload = {
            nodes: [makeWindow('w_1', [makeTab('t_1', 'GitHub', 'https://github.com', 10)], 1)],
            collections: [colA],
            siteMeta: {
                'https://github.com/': {
                    url: 'https://github.com/',
                    description: 'Code hosting',
                    source: 'manual',
                    updatedAt: 1000,
                },
            },
        };

        // 1. Device A initial push -> uploads all 3 chunks
        const push1 = await executeSyncCycle({
            provider: remote,
            local: payloadA,
            meta: makeMeta('dev_A'),
            mode: 'smart',
            e2eeEnabled: true,
            passphrase: 'secret-sync-password',
        });
        expect(push1.result.status).toBe('pushed');
        expect(remote.writtenChunks.sort()).toEqual(['collections', 'siteMeta', 'tree']);

        // 2. Device A re-syncs with only ephemeral browserTabId changed -> noop!
        remote.resetCounters();
        const payloadAEphemeral: SyncWorkspacePayload = {
            ...payloadA,
            nodes: [makeWindow('w_1', [makeTab('t_1', 'GitHub', 'https://github.com', 999)], 88)],
        };
        const noopRes = await executeSyncCycle({
            provider: remote,
            local: payloadAEphemeral,
            meta: push1.nextMeta,
            mode: 'smart',
            e2eeEnabled: true,
            passphrase: 'secret-sync-password',
        });
        expect(noopRes.result.status).toBe('noop');
        expect(remote.writtenChunks).toEqual([]);

        // 3. Modify ONLY siteMeta -> uploads ONLY 'siteMeta' chunk
        remote.resetCounters();
        const payloadASiteUpdated: SyncWorkspacePayload = {
            ...payloadA,
            siteMeta: {
                ...payloadA.siteMeta,
                'https://deepseek.com/': {
                    url: 'https://deepseek.com/',
                    description: 'LLM Workspace',
                    source: 'manual',
                    updatedAt: 2000,
                },
            },
        };
        const push2 = await executeSyncCycle({
            provider: remote,
            local: payloadASiteUpdated,
            meta: noopRes.nextMeta,
            mode: 'smart',
            e2eeEnabled: true,
            passphrase: 'secret-sync-password',
        });
        expect(push2.result.status).toBe('pushed');
        expect(remote.writtenChunks).toEqual(['siteMeta']);

        // 4. Device B starts empty -> auto-pulls initial remote snapshot
        remote.resetCounters();
        const pullB = await executeSyncCycle({
            provider: remote,
            local: { nodes: [], collections: [], siteMeta: {} },
            meta: makeMeta('dev_B'),
            mode: 'smart',
            e2eeEnabled: true,
            passphrase: 'secret-sync-password',
        });
        expect(pullB.result.status).toBe('pulled');
        expect(pullB.pulledPayload?.collections).toHaveLength(1);
        expect(pullB.pulledPayload?.siteMeta['https://deepseek.com/']?.description).toBe(
            'LLM Workspace',
        );

        // 5. Device A updates siteMeta again -> Device B pulls ONLY 'siteMeta'
        const payloadASite2: SyncWorkspacePayload = {
            ...payloadASiteUpdated,
            siteMeta: {
                ...payloadASiteUpdated.siteMeta,
                'https://cloudflare.com/': {
                    url: 'https://cloudflare.com/',
                    description: 'R2 & Workers',
                    source: 'manual',
                    updatedAt: 3000,
                },
            },
        };
        await executeSyncCycle({
            provider: remote,
            local: payloadASite2,
            meta: push2.nextMeta,
            mode: 'smart',
            e2eeEnabled: true,
            passphrase: 'secret-sync-password',
        });

        remote.resetCounters();
        const incrementalPullB = await executeSyncCycle({
            provider: remote,
            local: pullB.pulledPayload!,
            meta: pullB.nextMeta,
            mode: 'smart',
            e2eeEnabled: true,
            passphrase: 'secret-sync-password',
        });
        expect(incrementalPullB.result.status).toBe('pulled');
        expect(remote.readChunks).toEqual(['siteMeta']);
        expect(
            incrementalPullB.pulledPayload?.siteMeta['https://cloudflare.com/']?.description,
        ).toBe('R2 & Workers');
    });

    it('detects conflicts when both devices edit and merges non-destructively', async () => {
        const remote = new MemorySyncProvider();
        const base: SyncWorkspacePayload = {
            nodes: [makeWindow('w_shared', [makeTab('t_base', 'Base', 'https://example.com')])],
            collections: [],
            siteMeta: {},
        };

        const devASync = await executeSyncCycle({
            provider: remote,
            local: base,
            meta: makeMeta('dev_A'),
            mode: 'smart',
            e2eeEnabled: false,
        });
        const devBSync = await executeSyncCycle({
            provider: remote,
            local: { nodes: [], collections: [], siteMeta: {} },
            meta: makeMeta('dev_B'),
            mode: 'smart',
            e2eeEnabled: false,
        });

        // Device A pushes a new collection
        const localA: SyncWorkspacePayload = {
            ...base,
            collections: [
                {
                    id: 'col_A',
                    nodeType: 'collection',
                    title: 'From A',
                    color: 'green',
                    category: 'repo',
                    expanded: true,
                    saved: true,
                    children: [makeTab('ta', 'Repo A', 'https://github.com/a')],
                    updatedAt: 100,
                },
            ],
        };
        await executeSyncCycle({
            provider: remote,
            local: localA,
            meta: devASync.nextMeta,
            mode: 'smart',
            e2eeEnabled: false,
        });

        // Device B simultaneously adds its own collection before pulling A
        const localB: SyncWorkspacePayload = {
            nodes: [
                makeWindow('w_shared', [
                    makeTab('t_base', 'Base', 'https://example.com'),
                    makeTab('t_from_b', 'Added in B', 'https://news.ycombinator.com'),
                ]),
            ],
            collections: [
                {
                    id: 'col_B',
                    nodeType: 'collection',
                    title: 'From B',
                    color: 'pink',
                    category: 'readlist',
                    expanded: true,
                    saved: true,
                    children: [makeTab('tb', 'Read B', 'https://hn.algolia.com')],
                    updatedAt: 200,
                },
            ],
            siteMeta: {
                'https://hn.algolia.com/': {
                    url: 'https://hn.algolia.com/',
                    description: 'HN Search',
                    source: 'manual',
                    updatedAt: 200,
                },
            },
        };

        const conflictRes = await executeSyncCycle({
            provider: remote,
            local: localB,
            meta: devBSync.nextMeta,
            mode: 'smart',
            e2eeEnabled: false,
        });
        expect(conflictRes.result.status).toBe('conflict');
        expect(conflictRes.conflict).toBeDefined();

        const resolved = await executeSyncCycle({
            provider: remote,
            local: localB,
            meta: conflictRes.nextMeta,
            mode: 'resolveMerge',
            e2eeEnabled: false,
        });
        expect(resolved.result.status).toBe('pushed');
        expect(resolved.pulledPayload?.collections.map((c) => c.id).sort()).toEqual([
            'col_A',
            'col_B',
        ]);
        const winChildren = resolved.pulledPayload?.nodes[0]?.children ?? [];
        expect(winChildren.some((n) => n.id === 't_from_b')).toBe(true);
    });
});
