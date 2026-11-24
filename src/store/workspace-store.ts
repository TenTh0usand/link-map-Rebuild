import { create } from 'zustand';

import { buildExportV2Payload, exportNodesToMarkdown, exportNodesToText } from '../core/exporter';
import {
    activateLiveTab,
    attachLiveTab,
    cloneWithFreshIdsAndClosed,
    closeNodes,
    collectSubtreeTabs,
    createCollectionNode,
    createLiveWindow,
    deleteNodes,
    expandAncestorsOf,
    findNodeByBrowserTabId,
    findNodeById,
    findParentTabGroup,
    findParentWindow,
    flattenVisibleTree,
    insertExternalNodes,
    insertLiveTab,
    insertNoteNode,
    moveLiveTab,
    moveNodes,
    reconcileSnapshotWithLive,
    removeLiveTab,
    removeLiveWindow,
    replaceLiveTab,
    setAllExpanded,
    syncTabGroupRemoved,
    syncTabGroupUpsert,
    toggleNodeExpanded,
    toggleSaveNodes,
    updateLiveTab,
    updateNodeAlias,
} from '../core/tree-engine';
import type { SyncRunMode } from '../core/sync-engine';
import { filterTree } from '../core/search';
import {
    DEFAULT_APP_SETTINGS,
    type AppSettings,
    type CollectionCategory,
    type CollectionNode,
    type DropPosition,
    type FlatVisibleNode,
    type ShareBundle,
    type SiteMetaRecord,
    type TabGroupColor,
    type TabGroupNode,
    type TabNode,
    type TreeNode,
    type WindowNode,
} from '../core/types';
import {
    activateOrReopenTab,
    closeBrowserTabs,
    downloadTextOrJsonFile,
    fetchLiveBrowserState,
    getDefaultNewTabUrl,
    moveBrowserTabs,
    openCollectionInChrome,
    openTabsAsChromeGroup,
    reopenTabGroupNode,
    reopenWindowNode,
    syncChromeWindowTabOrder,
    ungroupBrowserTabs,
    updateChromeTabGroupMeta,
} from '../services/browser-bridge';
import { db, type BackupRecord } from '../services/db';
import { setOfflineOnlyMode } from '../services/network-guard';
import {
    broadcastAiStateUpdated,
    broadcastImportNodesAck,
    broadcastSettingsUpdated,
    broadcastSiteMetaUpdated,
    broadcastStateUpdated,
    broadcastSyncStateUpdated,
    sendBackgroundCommand,
    subscribeCrossViewBroadcast,
    type BackgroundRelayEvent,
} from '../services/sync-channel';
import {
    generateOrganizeProposal,
    generateReadlistCuration,
    generateSiteDescriptions,
    generateWorkDigest,
    testAiConnection,
} from '../services/ai/ai-client';
import {
    DEFAULT_AI_CONFIG,
    type AiConfig,
    type AiOrganizeProposal,
    type AiProposedGroup,
    type AiReadlistCuration,
    type AiWorkDigestRecord,
} from '../services/ai/types';
import {
    createShortShareWithWorker,
    runWorkspaceSync,
    testProviderConnection,
} from '../services/sync/sync-manager';
import {
    DEFAULT_SYNC_CONFIG,
    type ShortShareResponse,
    type SyncConfig,
    type SyncConflictState,
    type SyncResult,
    type SyncStateMeta,
} from '../services/sync/types';

export type WorkspaceView = 'tree' | 'groups';
export type SettingsTabKey = 'general' | 'sync' | 'ai' | 'backup';
export type AiAssistantTabKey = 'digest' | 'organize' | 'readlist' | 'descriptions';
export type ShareModalTarget =
    | { mode: 'single'; tab: TabNode }
    | { mode: 'group'; title: string; color?: TabGroupColor; nodes: TreeNode[] };

export interface WorkspaceState {
    nodes: TreeNode[];
    collections: CollectionNode[];
    settings: AppSettings;
    siteMetaMap: Record<string, SiteMetaRecord>;
    shareModalTarget: ShareModalTarget | null;
    activeView: WorkspaceView;
    searchQuery: string;
    focusedNodeId: string | null;
    selectedIds: string[];
    multiSelectMode: boolean;
    editingNodeId: string | null;
    initialized: boolean;
    lastSavedAt: number | null;
    settingsModalOpen: boolean;
    settingsTab: SettingsTabKey;
    backups: BackupRecord[];
    syncConfig: SyncConfig;
    syncMeta: SyncStateMeta;
    syncing: boolean;
    syncConflict: SyncConflictState | null;
    aiConfig: AiConfig;
    aiDigests: AiWorkDigestRecord[];
    aiModalOpen: boolean;
    aiModalTab: AiAssistantTabKey;
    aiBusy: boolean;

    init: () => Promise<() => void>;
    setActiveView: (view: WorkspaceView) => void;
    setSearchQuery: (query: string) => void;
    setFocusedNodeId: (id: string | null) => void;
    setEditingNodeId: (id: string | null) => void;
    setMultiSelectMode: (enabled: boolean) => void;
    setSettingsModalOpen: (open: boolean, tab?: SettingsTabKey) => void;
    setShareModalTarget: (target: ShareModalTarget | null) => void;
    saveSiteDescription: (
        url: string,
        description: string,
        category?: CollectionCategory,
    ) => Promise<void>;

    toggleSelect: (id: string, additive?: boolean) => void;
    selectRange: (targetId: string, visibleFlat: FlatVisibleNode[]) => void;
    selectAllVisible: (visibleFlat: FlatVisibleNode[]) => void;
    clearSelection: () => void;

    toggleExpand: (id: string) => void;
    expandAll: () => void;
    collapseAll: () => void;
    locateActiveTab: () => Promise<string | null>;

    openOrActivateNode: (id: string) => Promise<void>;
    closeNodeAction: (ids: string[], mode?: 'item' | 'subtree' | 'auto') => Promise<void>;
    deleteNodeAction: (ids: string[], mode?: 'item' | 'subtree' | 'auto') => Promise<void>;
    toggleSaveAction: (ids: string[]) => void;
    renameAliasAction: (id: string, alias: string) => void;
    insertNoteAction: (
        targetId: string | null,
        position: 'parent' | 'firstChild' | 'lastChild' | 'after' | 'root',
        title?: string,
    ) => string;
    moveNodesByDrop: (sourceIds: string[], targetId: string, position: DropPosition) => Promise<void>;
    importExternalNodes: (
        importedNodes: TreeNode[],
        targetId: string | null,
        position?: DropPosition,
        asCollectionTitle?: string,
    ) => Promise<void>;

    createCollection: (title: string, color: TabGroupColor, category: CollectionCategory, initialNodes?: TreeNode[]) => void;
    deleteCollection: (collectionId: string) => void;
    renameCollection: (collectionId: string, title: string, color?: TabGroupColor) => void;
    addNodesToCollection: (collectionId: string, nodeIds: string[]) => void;
    removeChildFromCollection: (collectionId: string, childId: string) => void;
    openCollectionAction: (collectionId: string) => Promise<void>;

    groupNodesInChrome: (nodeIds: string[], title: string, color?: TabGroupColor) => Promise<void>;
    ungroupTabGroup: (groupNodeId: string) => Promise<void>;
    updateTabGroupMeta: (
        groupNodeId: string,
        meta: { title?: string; color?: TabGroupColor },
    ) => Promise<void>;

    copyNodeLink: (id: string) => Promise<void>;
    copyNodeMarkdown: (id: string) => Promise<void>;
    copySubtreeText: (ids: string[]) => Promise<void>;
    copySubtreeMarkdown: (ids: string[]) => Promise<void>;

    updateSettings: (partial: Partial<AppSettings>) => Promise<void>;
    exportBackupJson: () => Promise<void>;
    refreshBackups: () => Promise<void>;
    createManualBackup: (label?: string) => Promise<void>;
    restoreBackup: (backupId: number) => Promise<void>;
    deleteBackup: (backupId: number) => Promise<void>;

    saveSyncConfig: (config: SyncConfig) => Promise<void>;
    testSyncConnection: (
        config?: SyncConfig,
    ) => Promise<{ ok: boolean; latencyMs: number; message?: string }>;
    runCloudSync: (mode?: SyncRunMode) => Promise<SyncResult>;
    resolveSyncConflict: (
        strategy: 'mergeBoth' | 'keepLocal' | 'keepRemote',
    ) => Promise<SyncResult>;
    dismissSyncConflict: () => void;
    createR2ShortShare: (bundle: ShareBundle, ttlSeconds?: number) => Promise<ShortShareResponse>;

    saveAiConfig: (config: AiConfig) => Promise<void>;
    testAiConnectionAction: (
        config?: AiConfig,
    ) => Promise<{ ok: boolean; latencyMs: number; message?: string }>;
    setAiModalOpen: (open: boolean, tab?: AiAssistantTabKey) => void;
    runAiWorkDigest: (
        scopeTitle: string,
        tabs: TabNode[],
    ) => Promise<{ digest: AiWorkDigestRecord; skippedPrivacyCount: number }>;
    deleteAiDigest: (id: string) => Promise<void>;
    runAiOrganizeProposal: (
        tabs: TabNode[],
    ) => Promise<{ proposal: AiOrganizeProposal; skippedPrivacyCount: number }>;
    applyAiProposedGroups: (
        groups: AiProposedGroup[],
        mode: 'collection' | 'chromeGroup',
    ) => Promise<number>;
    runAiReadlistCuration: (
        tabs: TabNode[],
    ) => Promise<{ curation: AiReadlistCuration; skippedPrivacyCount: number }>;
    runAiSiteDescriptions: (
        tabs: TabNode[],
        options?: { overwriteAi?: boolean; onProgress?: (done: number, total: number) => void },
    ) => Promise<{ updatedCount: number; skippedCachedCount: number; skippedPrivacyCount: number }>;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
let sessionAutoBackupCreated = false;
let suppressNextReload = false;

function clearAutoSyncTimer(): void {
    if (autoSyncTimer) {
        clearTimeout(autoSyncTimer);
        autoSyncTimer = null;
    }
}

function formatTimestampForFilename(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
    const scheduleAutoSync = () => {
        clearAutoSyncTimer();
        const { settings, syncConfig, syncConflict } = get();
        if (
            settings.offlineOnlyMode ||
            !syncConfig.autoSync ||
            syncConfig.provider === 'none' ||
            syncConfig.provider === 'google-drive' ||
            syncConflict !== null
        ) {
            return;
        }
        const minSec =
            syncConfig.provider === 'webdav' && syncConfig.webdav.preset === 'jianguoyun'
                ? 60
                : 30;
        const delayMs = Math.max(minSec, syncConfig.autoSyncIntervalSec || 60) * 1000;
        autoSyncTimer = setTimeout(() => {
            autoSyncTimer = null;
            void get().runCloudSync('smart');
        }, delayMs);
    };

    const schedulePersist = () => {
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(async () => {
            const { nodes, collections } = get();
            if (!sessionAutoBackupCreated && nodes.length > 0) {
                sessionAutoBackupCreated = true;
                await db.createRollingBackup(nodes, collections, 'auto', 'Session Auto Snapshot');
                const backups = await db.listBackups();
                set({ backups });
            }
            await db.saveSnapshot(nodes, collections);
            set({ lastSavedAt: Date.now() });
            suppressNextReload = true;
            broadcastStateUpdated();
            scheduleAutoSync();
            setTimeout(() => {
                suppressNextReload = false;
            }, 100);
        }, 400);
    };

    const handleRelayEvent = (ev: BackgroundRelayEvent) => {
        const { nodes, settings } = get();
        const newTabUrl = getDefaultNewTabUrl();

        switch (ev.type) {
            case 'TAB_CREATED': {
                const next = insertLiveTab(nodes, ev.tab, {
                    createNewTabByLevel: settings.createNewTabByLevel,
                    newTabUrl,
                    syncNativeTabGroups: settings.syncNativeTabGroups,
                    groupInfo: ev.group,
                });
                set({ nodes: next });
                schedulePersist();
                break;
            }
            case 'TAB_REMOVED': {
                const next = removeLiveTab(nodes, ev.tabId);
                set({ nodes: next });
                schedulePersist();
                break;
            }
            case 'TAB_UPDATED': {
                const next = updateLiveTab(
                    nodes,
                    ev.tab,
                    ev.group,
                    settings.syncNativeTabGroups,
                );
                set({ nodes: next });
                schedulePersist();
                break;
            }
            case 'TAB_MOVED': {
                const next = moveLiveTab(
                    nodes,
                    ev.windowId,
                    ev.tabId,
                    ev.fromIndex,
                    ev.toIndex,
                );
                set({ nodes: next });
                schedulePersist();
                break;
            }
            case 'TAB_ACTIVATED': {
                let next = activateLiveTab(nodes, ev.windowId, ev.tabId);
                const tabNode = findNodeByBrowserTabId(next, ev.tabId);
                if (tabNode && settings.autoScrollToActiveTab) {
                    next = expandAncestorsOf(next, tabNode.id);
                    set({ nodes: next, focusedNodeId: tabNode.id });
                } else {
                    set({ nodes: next });
                }
                schedulePersist();
                break;
            }
            case 'TAB_ATTACHED': {
                const next = attachLiveTab(nodes, ev.windowId, ev.tabId, ev.newIndex);
                set({ nodes: next });
                schedulePersist();
                break;
            }
            case 'TAB_REPLACED': {
                const next = replaceLiveTab(nodes, ev.addedTab, ev.removedTabId);
                set({ nodes: next });
                schedulePersist();
                break;
            }
            case 'WINDOW_CREATED': {
                const next = createLiveWindow(nodes, ev.window);
                set({ nodes: next });
                schedulePersist();
                break;
            }
            case 'WINDOW_REMOVED': {
                const next = removeLiveWindow(nodes, ev.windowId);
                set({ nodes: next });
                schedulePersist();
                break;
            }
            case 'WINDOW_FOCUS': {
                void chrome.tabs
                    .query({ windowId: ev.windowId, active: true })
                    .then((tabs) => {
                        const active = tabs[0];
                        if (!active?.id) return;
                        const current = get().nodes;
                        let next = activateLiveTab(current, ev.windowId, active.id);
                        const tabNode = findNodeByBrowserTabId(next, active.id);
                        if (tabNode && get().settings.autoScrollToActiveTab) {
                            next = expandAncestorsOf(next, tabNode.id);
                            set({ nodes: next, focusedNodeId: tabNode.id });
                        } else {
                            set({ nodes: next });
                        }
                    })
                    .catch(() => {});
                break;
            }
            case 'GROUP_UPSERTED': {
                if (!settings.syncNativeTabGroups) break;
                const next = syncTabGroupUpsert(nodes, ev.group);
                set({ nodes: next });
                schedulePersist();
                break;
            }
            case 'GROUP_REMOVED': {
                if (!settings.syncNativeTabGroups) break;
                const next = syncTabGroupRemoved(nodes, ev.groupId);
                set({ nodes: next });
                schedulePersist();
                break;
            }
        }
    };

    return {
        nodes: [],
        collections: [],
        settings: DEFAULT_APP_SETTINGS,
        siteMetaMap: {},
        shareModalTarget: null,
        activeView: 'tree',
        searchQuery: '',
        focusedNodeId: null,
        selectedIds: [],
        multiSelectMode: false,
        editingNodeId: null,
        initialized: false,
        lastSavedAt: null,
        settingsModalOpen: false,
        settingsTab: 'general',
        backups: [],
        syncConfig: DEFAULT_SYNC_CONFIG,
        syncMeta: {
            deviceId: '',
            lastSyncedAt: null,
            lastSyncStatus: 'idle',
            lastManifestHash: null,
            lastChunkHashes: {},
        },
        syncing: false,
        syncConflict: null,
        aiConfig: DEFAULT_AI_CONFIG,
        aiDigests: [],
        aiModalOpen: false,
        aiModalTab: 'digest',
        aiBusy: false,

        init: async () => {
            const settings = await db.getSettings();
            setOfflineOnlyMode(settings.offlineOnlyMode);
            await sendBackgroundCommand({ action: 'SET_OPEN_MODE', openMode: settings.openMode });

            let snap = await db.getSnapshot();
            if (!snap) {
                snap = (await db.tryMigrateFromLegacyV1()) ?? undefined;
            }

            const { windows, groups } = await fetchLiveBrowserState();
            const reconciledNodes = reconcileSnapshotWithLive(
                snap?.nodes ?? [],
                windows,
                groups,
                { syncNativeTabGroups: settings.syncNativeTabGroups },
            );
            const collections = snap?.collections ?? [];

            await db.saveSnapshot(reconciledNodes, collections);
            const [backups, siteMetaMap, syncConfig, syncMeta, aiConfig, aiDigests] =
                await Promise.all([
                    db.listBackups(),
                    db.getAllSiteMeta(),
                    db.getSyncConfig(),
                    db.getSyncMeta(),
                    db.getAiConfig(),
                    db.listAiDigests(),
                ]);

            set({
                nodes: reconciledNodes,
                collections,
                settings,
                siteMetaMap,
                backups,
                syncConfig,
                syncMeta,
                aiConfig,
                aiDigests,
                initialized: true,
                lastSavedAt: Date.now(),
            });

            const onRuntimeMsg = (msg: unknown) => {
                if (msg && typeof msg === 'object' && 'type' in msg) {
                    handleRelayEvent(msg as BackgroundRelayEvent);
                }
            };
            chrome.runtime.onMessage.addListener(onRuntimeMsg);

            const unsubBroadcast = subscribeCrossViewBroadcast((msg) => {
                if (msg.type === 'STATE_UPDATED' && !suppressNextReload) {
                    void db.getSnapshot().then((latest) => {
                        if (latest) {
                            set({
                                nodes: latest.nodes,
                                collections: latest.collections,
                                lastSavedAt: latest.updatedAt,
                            });
                        }
                    });
                } else if (msg.type === 'SETTINGS_UPDATED') {
                    void db.getSettings().then((latestSettings) => {
                        setOfflineOnlyMode(latestSettings.offlineOnlyMode);
                        if (latestSettings.offlineOnlyMode) {
                            clearAutoSyncTimer();
                        }
                        set({ settings: latestSettings });
                    });
                } else if (msg.type === 'SITE_META_UPDATED') {
                    void db.getAllSiteMeta().then((latestMeta) => {
                        set({ siteMetaMap: latestMeta });
                    });
                } else if (msg.type === 'SYNC_STATE_UPDATED') {
                    void Promise.all([db.getSyncConfig(), db.getSyncMeta()]).then(
                        ([latestConfig, latestMeta]) => {
                            set({ syncConfig: latestConfig, syncMeta: latestMeta });
                        },
                    );
                } else if (msg.type === 'AI_STATE_UPDATED') {
                    void Promise.all([db.getAiConfig(), db.listAiDigests()]).then(
                        ([latestAiConfig, latestDigests]) => {
                            set({ aiConfig: latestAiConfig, aiDigests: latestDigests });
                        },
                    );
                } else if (msg.type === 'IMPORT_NODES_REQUEST') {
                    broadcastImportNodesAck(msg.requestId);
                    void get().importExternalNodes(
                        msg.nodes,
                        null,
                        'after',
                        msg.asCollectionTitle,
                    );
                }
            });

            return () => {
                chrome.runtime.onMessage.removeListener(onRuntimeMsg);
                unsubBroadcast();
                if (persistTimer) clearTimeout(persistTimer);
                clearAutoSyncTimer();
            };
        },

        setActiveView: (activeView) => set({ activeView }),
        setSearchQuery: (searchQuery) => set({ searchQuery }),
        setFocusedNodeId: (focusedNodeId) => set({ focusedNodeId }),
        setEditingNodeId: (editingNodeId) => set({ editingNodeId }),
        setMultiSelectMode: (multiSelectMode) =>
            set((state) => ({
                multiSelectMode,
                selectedIds: multiSelectMode ? state.selectedIds : [],
            })),
        setSettingsModalOpen: (settingsModalOpen, tab) =>
            set((state) => ({
                settingsModalOpen,
                settingsTab: tab ?? state.settingsTab,
            })),
        setShareModalTarget: (shareModalTarget) => set({ shareModalTarget }),
        saveSiteDescription: async (url, description, category) => {
            const record = await db.upsertSiteMeta(url, description, 'manual', category);
            set((state) => ({
                siteMetaMap: {
                    ...state.siteMetaMap,
                    [record.url]: record,
                },
            }));
            broadcastSiteMetaUpdated();
            scheduleAutoSync();
        },

        toggleSelect: (id, additive = true) => {
            set((state) => {
                const exists = state.selectedIds.includes(id);
                if (!additive) {
                    return { selectedIds: exists && state.selectedIds.length === 1 ? [] : [id] };
                }
                return {
                    selectedIds: exists
                        ? state.selectedIds.filter((item) => item !== id)
                        : [...state.selectedIds, id],
                };
            });
        },

        selectRange: (targetId, visibleFlat) => {
            const { focusedNodeId, selectedIds } = get();
            const anchorId = focusedNodeId ?? selectedIds[0];
            if (!anchorId) {
                set({ selectedIds: [targetId], focusedNodeId: targetId });
                return;
            }
            const aIdx = visibleFlat.findIndex((f) => f.node.id === anchorId);
            const bIdx = visibleFlat.findIndex((f) => f.node.id === targetId);
            if (aIdx === -1 || bIdx === -1) {
                set({ selectedIds: [targetId], focusedNodeId: targetId });
                return;
            }
            const start = Math.min(aIdx, bIdx);
            const end = Math.max(aIdx, bIdx);
            const rangeIds = visibleFlat.slice(start, end + 1).map((f) => f.node.id);
            const merged = Array.from(new Set([...selectedIds, ...rangeIds]));
            set({ selectedIds: merged, focusedNodeId: targetId, multiSelectMode: true });
        },

        selectAllVisible: (visibleFlat) => {
            set({
                multiSelectMode: true,
                selectedIds: visibleFlat.map((f) => f.node.id),
            });
        },

        clearSelection: () => set({ selectedIds: [], multiSelectMode: false }),

        toggleExpand: (id) => {
            set((state) => ({ nodes: toggleNodeExpanded(state.nodes, id) }));
            schedulePersist();
        },

        expandAll: () => {
            set((state) => ({ nodes: setAllExpanded(state.nodes, true) }));
            schedulePersist();
        },

        collapseAll: () => {
            set((state) => ({ nodes: setAllExpanded(state.nodes, false) }));
            schedulePersist();
        },

        locateActiveTab: async () => {
            const { nodes } = get();
            const prevResp = await sendBackgroundCommand<{ windowId: number | null }>({
                action: 'GET_PREV_FOCUS_WINDOW',
            });
            const activeTabs = await chrome.tabs.query({ active: true });
            const preferredTab =
                (prevResp?.windowId !== null && prevResp?.windowId !== undefined
                    ? activeTabs.find((t) => t.windowId === prevResp.windowId)
                    : undefined) ?? activeTabs[0];

            if (!preferredTab?.id) return null;
            const targetNode = findNodeByBrowserTabId(nodes, preferredTab.id);
            if (!targetNode) return null;

            const expanded = expandAncestorsOf(nodes, targetNode.id);
            set({
                activeView: 'tree',
                searchQuery: '',
                nodes: expanded,
                focusedNodeId: targetNode.id,
            });
            schedulePersist();
            return targetNode.id;
        },

        openOrActivateNode: async (id) => {
            const { nodes } = get();
            const node = findNodeById(nodes, id);
            if (!node) return;
            if (node.nodeType === 'tab') {
                await activateOrReopenTab(nodes, node);
            } else if (node.nodeType === 'window') {
                await reopenWindowNode(node as WindowNode);
            } else if (node.nodeType === 'tabGroup') {
                await reopenTabGroupNode(nodes, node as TabGroupNode);
            } else if (node.nodeType === 'collection') {
                await openCollectionInChrome(node as CollectionNode);
            } else if (node.nodeType === 'note') {
                set({ nodes: toggleNodeExpanded(nodes, id) });
                schedulePersist();
            }
        },

        closeNodeAction: async (ids, mode = 'auto') => {
            const { nodes } = get();
            const res = closeNodes(nodes, ids, mode);
            set({ nodes: res.nodes });
            schedulePersist();
            await closeBrowserTabs(res.tabIdsToClose);
        },

        deleteNodeAction: async (ids, mode = 'auto') => {
            const { nodes, selectedIds } = get();
            const res = deleteNodes(nodes, ids, mode);
            const idSet = new Set(ids);
            set({
                nodes: res.nodes,
                selectedIds: selectedIds.filter((s) => !idSet.has(s)),
            });
            schedulePersist();
            await closeBrowserTabs(res.tabIdsToClose);
        },

        toggleSaveAction: (ids) => {
            set((state) => ({ nodes: toggleSaveNodes(state.nodes, ids) }));
            schedulePersist();
        },

        renameAliasAction: (id, alias) => {
            set((state) => ({
                nodes: updateNodeAlias(state.nodes, id, alias),
                editingNodeId: null,
            }));
            schedulePersist();
        },

        insertNoteAction: (targetId, position, title = 'Note') => {
            const { nodes } = get();
            const res = insertNoteNode(nodes, targetId, position, title);
            set({
                nodes: res.nodes,
                focusedNodeId: res.newNodeId,
                editingNodeId: res.newNodeId,
            });
            schedulePersist();
            return res.newNodeId;
        },

        moveNodesByDrop: async (sourceIds, targetId, position) => {
            const { nodes } = get();
            const res = moveNodes(nodes, sourceIds, targetId, position);
            set({ nodes: res.nodes });
            schedulePersist();

            if (res.movedOpenTabIds.length > 0 && res.targetBrowserWindowId !== undefined) {
                const targetWinNode = findNodeById(res.nodes, res.affectedWindowIds[res.affectedWindowIds.length - 1] ?? '');
                if (res.targetBrowserGroupId !== undefined && res.targetBrowserGroupId > -1) {
                    await chrome.tabs
                        .group({
                            groupId: res.targetBrowserGroupId,
                            tabIds: res.movedOpenTabIds as [number, ...number[]],
                        })
                        .catch(() => {});
                } else {
                    await moveBrowserTabs(res.movedOpenTabIds, res.targetBrowserWindowId, -1);
                }

                if (targetWinNode && targetWinNode.nodeType === 'window') {
                    await syncChromeWindowTabOrder(targetWinNode);
                }
            }
        },

        importExternalNodes: async (importedNodes, targetId, position = 'after', asCollectionTitle) => {
            const { nodes, collections } = get();
            if (nodes.length > 0) {
                await db.createRollingBackup(nodes, collections, 'pre-import', 'Before Import');
            }

            if (asCollectionTitle) {
                const fresh = cloneWithFreshIdsAndClosed(importedNodes);
                const col = createCollectionNode(asCollectionTitle, 'blue', 'workspace', fresh);
                set({
                    collections: [col, ...collections],
                    activeView: 'groups',
                });
            } else {
                const nextNodes = insertExternalNodes(nodes, importedNodes, targetId, position);
                set({ nodes: nextNodes });
            }
            const backups = await db.listBackups();
            set({ backups });
            schedulePersist();
        },

        createCollection: (title, color, category, initialNodes = []) => {
            const col = createCollectionNode(title.trim() || 'New Group', color, category, initialNodes);
            set((state) => ({ collections: [col, ...state.collections] }));
            schedulePersist();
        },

        deleteCollection: (collectionId) => {
            set((state) => ({
                collections: state.collections.filter((c) => c.id !== collectionId),
            }));
            schedulePersist();
        },

        renameCollection: (collectionId, title, color) => {
            set((state) => ({
                collections: state.collections.map((c) =>
                    c.id === collectionId
                        ? { ...c, title: title.trim() || c.title, color: color ?? c.color }
                        : c,
                ),
            }));
            schedulePersist();
        },

        addNodesToCollection: (collectionId, nodeIds) => {
            const { nodes, collections } = get();
            const picked: TreeNode[] = [];
            for (const id of nodeIds) {
                const found = findNodeById(nodes, id);
                if (found) picked.push(found);
            }
            if (picked.length === 0) return;

            const cloned = cloneWithFreshIdsAndClosed(picked);
            set({
                collections: collections.map((c) =>
                    c.id === collectionId ? { ...c, children: [...c.children, ...cloned] } : c,
                ),
            });
            schedulePersist();
        },

        removeChildFromCollection: (collectionId, childId) => {
            set((state) => ({
                collections: state.collections.map((c) =>
                    c.id === collectionId
                        ? { ...c, children: c.children.filter((ch) => ch.id !== childId) }
                        : c,
                ),
            }));
            schedulePersist();
        },

        openCollectionAction: async (collectionId) => {
            const col = get().collections.find((c) => c.id === collectionId);
            if (!col) return;
            await openCollectionInChrome(col);
        },

        groupNodesInChrome: async (nodeIds, title, color = 'blue') => {
            const { nodes } = get();
            const targets = nodeIds
                .map((id) => findNodeById(nodes, id))
                .filter((n): n is TreeNode => Boolean(n));
            if (targets.length === 0) return;

            const firstParentWin = findParentWindow(nodes, targets[0]!.id);
            await openTabsAsChromeGroup(targets, {
                title,
                color,
                targetWindowId:
                    firstParentWin && !firstParentWin.closed
                        ? firstParentWin.browserWindowId
                        : undefined,
            });
        },

        ungroupTabGroup: async (groupNodeId) => {
            const { nodes } = get();
            const grp = findNodeById(nodes, groupNodeId);
            if (!grp || grp.nodeType !== 'tabGroup') return;
            const openTabs = collectSubtreeTabs(grp, { onlyOpened: true });
            const tabIds = openTabs
                .map((t) => t.browserTabId)
                .filter((id): id is number => id !== undefined);
            await ungroupBrowserTabs(tabIds);
        },

        updateTabGroupMeta: async (groupNodeId, meta) => {
            const { nodes } = get();
            const grp = findNodeById(nodes, groupNodeId);
            if (!grp || grp.nodeType !== 'tabGroup') return;
            if (!grp.closed && grp.browserGroupId !== undefined) {
                await updateChromeTabGroupMeta(grp.browserGroupId, meta);
            }
            const updateLocal = (list: TreeNode[]): TreeNode[] =>
                list.map((n) =>
                    n.id === groupNodeId && n.nodeType === 'tabGroup'
                        ? { ...n, title: meta.title ?? n.title, color: meta.color ?? n.color }
                        : { ...n, children: updateLocal(n.children) },
                );
            set({ nodes: updateLocal(nodes) });
            schedulePersist();
        },

        copyNodeLink: async (id) => {
            const node = findNodeById(get().nodes, id);
            if (!node || node.nodeType !== 'tab') return;
            await navigator.clipboard.writeText(node.url || node.pendingUrl || '');
        },

        copyNodeMarkdown: async (id) => {
            const node = findNodeById(get().nodes, id);
            if (!node) return;
            if (node.nodeType === 'tab') {
                await navigator.clipboard.writeText(`[${node.title}](${node.url || node.pendingUrl || ''})`);
            } else {
                await navigator.clipboard.writeText(exportNodesToMarkdown([node]));
            }
        },

        copySubtreeText: async (ids) => {
            const { nodes, collections } = get();
            const targets = ids
                .map((id) => findNodeById(nodes, id) ?? findNodeById(collections, id))
                .filter((n): n is TreeNode => Boolean(n));
            if (targets.length === 0) return;
            await navigator.clipboard.writeText(exportNodesToText(targets));
        },

        copySubtreeMarkdown: async (ids) => {
            const { nodes, collections } = get();
            const targets = ids
                .map((id) => findNodeById(nodes, id) ?? findNodeById(collections, id))
                .filter((n): n is TreeNode => Boolean(n));
            if (targets.length === 0) return;
            await navigator.clipboard.writeText(exportNodesToMarkdown(targets));
        },

        updateSettings: async (partial) => {
            const next = await db.updateSettings(partial);
            setOfflineOnlyMode(next.offlineOnlyMode);
            if (next.offlineOnlyMode) {
                clearAutoSyncTimer();
            }
            if (partial.openMode) {
                await sendBackgroundCommand({ action: 'SET_OPEN_MODE', openMode: partial.openMode });
            }
            set({ settings: next });
            broadcastSettingsUpdated();
        },

        exportBackupJson: async () => {
            const { nodes, collections } = get();
            const payload = buildExportV2Payload(nodes, collections, '2.0.0');
            const filename = `link-map-export-${formatTimestampForFilename()}.json`;
            await downloadTextOrJsonFile(JSON.stringify(payload, null, 2), filename, 'application/json');
        },

        refreshBackups: async () => {
            const backups = await db.listBackups();
            set({ backups });
        },

        createManualBackup: async (label) => {
            const { nodes, collections } = get();
            await db.createRollingBackup(nodes, collections, 'manual', label ?? 'Manual Snapshot');
            const backups = await db.listBackups();
            set({ backups });
        },

        restoreBackup: async (backupId) => {
            const target = await db.getBackup(backupId);
            if (!target) return;
            const { nodes, collections, settings } = get();
            await db.createRollingBackup(nodes, collections, 'pre-import', 'Before Restore');
            const { windows, groups } = await fetchLiveBrowserState();
            const reconciled = reconcileSnapshotWithLive(target.nodes, windows, groups, {
                syncNativeTabGroups: settings.syncNativeTabGroups,
            });
            await db.saveSnapshot(reconciled, target.collections);
            const backups = await db.listBackups();
            set({
                nodes: reconciled,
                collections: target.collections,
                backups,
                lastSavedAt: Date.now(),
            });
            broadcastStateUpdated();
        },

        deleteBackup: async (backupId) => {
            await db.deleteBackup(backupId);
            const backups = await db.listBackups();
            set({ backups });
        },

        saveSyncConfig: async (config) => {
            const saved = await db.saveSyncConfig(config);
            set({ syncConfig: saved });
            broadcastSyncStateUpdated();
            if (saved.autoSync && !get().settings.offlineOnlyMode) {
                scheduleAutoSync();
            } else {
                clearAutoSyncTimer();
            }
        },

        testSyncConnection: async (config) => {
            const targetConfig = config ?? get().syncConfig;
            if (config) {
                const saved = await db.saveSyncConfig(config);
                set({ syncConfig: saved });
                broadcastSyncStateUpdated();
            }
            return testProviderConnection(targetConfig);
        },

        runCloudSync: async (mode = 'smart') => {
            const { settings, syncConfig, syncMeta, nodes, collections, siteMetaMap } = get();
            if (settings.offlineOnlyMode) {
                return {
                    status: 'error',
                    syncedAt: Date.now(),
                    message: 'Simple Offline Mode is active.',
                };
            }
            clearAutoSyncTimer();
            set({ syncing: true });
            try {
                const outcome = await runWorkspaceSync({
                    config: syncConfig,
                    local: { nodes, collections, siteMeta: siteMetaMap },
                    meta: syncMeta,
                    mode,
                });

                if (outcome.pulledPayload) {
                    if (nodes.length > 0 || collections.length > 0) {
                        await db.createRollingBackup(
                            nodes,
                            collections,
                            'pre-import',
                            'Before Cloud Sync',
                        );
                    }
                    const { windows, groups } = await fetchLiveBrowserState();
                    const reconciledNodes = reconcileSnapshotWithLive(
                        outcome.pulledPayload.nodes,
                        windows,
                        groups,
                        { syncNativeTabGroups: get().settings.syncNativeTabGroups },
                    );
                    await db.saveSnapshot(reconciledNodes, outcome.pulledPayload.collections);
                    await db.replaceAllSiteMeta(outcome.pulledPayload.siteMeta);
                    const [backups, savedMeta] = await Promise.all([
                        db.listBackups(),
                        db.saveSyncMeta(outcome.nextMeta),
                    ]);
                    suppressNextReload = true;
                    set({
                        nodes: reconciledNodes,
                        collections: outcome.pulledPayload.collections,
                        siteMetaMap: outcome.pulledPayload.siteMeta,
                        backups,
                        syncMeta: savedMeta,
                        syncConflict: null,
                        syncing: false,
                        lastSavedAt: Date.now(),
                    });
                    broadcastStateUpdated();
                    broadcastSiteMetaUpdated();
                    broadcastSyncStateUpdated();
                    setTimeout(() => {
                        suppressNextReload = false;
                    }, 120);
                    return outcome.result;
                }

                const savedMeta = await db.saveSyncMeta(outcome.nextMeta);
                set({
                    syncMeta: savedMeta,
                    syncConflict: outcome.conflict ?? null,
                    syncing: false,
                });
                broadcastSyncStateUpdated();
                return outcome.result;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const errMeta: SyncStateMeta = {
                    ...get().syncMeta,
                    lastSyncedAt: Date.now(),
                    lastSyncStatus: 'error',
                    lastSyncMessage: msg,
                };
                await db.saveSyncMeta(errMeta);
                set({ syncMeta: errMeta, syncing: false });
                broadcastSyncStateUpdated();
                return { status: 'error', syncedAt: Date.now(), message: msg };
            }
        },

        resolveSyncConflict: async (strategy) => {
            if (strategy === 'mergeBoth') {
                return get().runCloudSync('resolveMerge');
            }
            if (strategy === 'keepLocal') {
                return get().runCloudSync('forcePush');
            }
            return get().runCloudSync('forcePull');
        },

        dismissSyncConflict: () => set({ syncConflict: null }),

        createR2ShortShare: async (bundle, ttlSeconds = 2592000) => {
            const { syncConfig } = get();
            return createShortShareWithWorker(syncConfig, bundle, ttlSeconds);
        },

        saveAiConfig: async (config) => {
            const saved = await db.saveAiConfig(config);
            set({ aiConfig: saved });
            broadcastAiStateUpdated();
        },

        testAiConnectionAction: async (config) => {
            const target = config ?? get().aiConfig;
            if (config) {
                const saved = await db.saveAiConfig(config);
                set({ aiConfig: saved });
                broadcastAiStateUpdated();
            }
            return testAiConnection(target);
        },

        setAiModalOpen: (aiModalOpen, tab) =>
            set((state) => ({
                aiModalOpen,
                aiModalTab: tab ?? state.aiModalTab,
            })),

        runAiWorkDigest: async (scopeTitle, tabs) => {
            const { aiConfig, siteMetaMap } = get();
            set({ aiBusy: true });
            try {
                const res = await generateWorkDigest(aiConfig, scopeTitle, tabs, siteMetaMap);
                await db.saveAiDigest(res.digest);
                const aiDigests = await db.listAiDigests();
                set({ aiDigests, aiBusy: false });
                broadcastAiStateUpdated();
                return res;
            } catch (err) {
                set({ aiBusy: false });
                throw err;
            }
        },

        deleteAiDigest: async (id) => {
            await db.deleteAiDigest(id);
            const aiDigests = await db.listAiDigests();
            set({ aiDigests });
            broadcastAiStateUpdated();
        },

        runAiOrganizeProposal: async (tabs) => {
            const { aiConfig, collections, siteMetaMap } = get();
            set({ aiBusy: true });
            try {
                const res = await generateOrganizeProposal(aiConfig, tabs, collections, siteMetaMap);
                set({ aiBusy: false });
                return res;
            } catch (err) {
                set({ aiBusy: false });
                throw err;
            }
        },

        applyAiProposedGroups: async (groups, mode) => {
            const { nodes } = get();
            let applied = 0;
            for (const grp of groups) {
                const matchedTabs = grp.tabIds
                    .map((id) => findNodeById(nodes, id))
                    .filter((n): n is TreeNode => Boolean(n));
                if (matchedTabs.length === 0) continue;

                if (mode === 'collection') {
                    const cloned = cloneWithFreshIdsAndClosed(matchedTabs);
                    get().createCollection(grp.title, grp.color, grp.category, cloned);
                    applied += 1;
                } else {
                    await openTabsAsChromeGroup(matchedTabs, {
                        title: grp.title,
                        color: grp.color,
                    });
                    applied += 1;
                }
            }
            return applied;
        },

        runAiReadlistCuration: async (tabs) => {
            const { aiConfig, siteMetaMap } = get();
            set({ aiBusy: true });
            try {
                const res = await generateReadlistCuration(aiConfig, tabs, siteMetaMap);
                set({ aiBusy: false });
                return res;
            } catch (err) {
                set({ aiBusy: false });
                throw err;
            }
        },

        runAiSiteDescriptions: async (tabs, options) => {
            const { aiConfig, siteMetaMap } = get();
            set({ aiBusy: true });
            try {
                const res = await generateSiteDescriptions(aiConfig, tabs, siteMetaMap, options);
                const nextMetaMap =
                    res.results.length > 0
                        ? await db.bulkUpsertSiteMeta(
                              res.results.map((item) => ({
                                  url: item.url,
                                  description: item.description,
                                  category: item.category,
                                  source: 'ai' as const,
                              })),
                              { overwriteManual: false },
                          )
                        : siteMetaMap;
                set({ siteMetaMap: nextMetaMap, aiBusy: false });
                if (res.results.length > 0) {
                    broadcastSiteMetaUpdated();
                    scheduleAutoSync();
                }
                return {
                    updatedCount: res.results.length,
                    skippedCachedCount: res.skippedCachedCount,
                    skippedPrivacyCount: res.skippedPrivacyCount,
                };
            } catch (err) {
                set({ aiBusy: false });
                throw err;
            }
        },
    };
});

export function selectVisibleTreeRows(nodes: TreeNode[], searchQuery: string): FlatVisibleNode[] {
    return searchQuery.trim() ? filterTree(nodes, searchQuery) : flattenVisibleTree(nodes);
}
