import type { OpenMode } from '../core/types';
import {
    DETACHED_BOUNDS_STORAGE_KEY,
    DETACHED_WINDOW_ID_KEY,
    OPEN_MODE_STORAGE_KEY,
    isExtensionPageUrl,
    isExtensionPopupWindow,
    mapChromeGroupToDTO,
    mapChromeTabToDTO,
} from '../services/browser-bridge';
import type { BackgroundCommandMessage, BackgroundRelayEvent } from '../services/sync-channel';

const PREV_FOCUS_WINDOW_KEY = 'prevFocusWindowId';

interface WindowBounds {
    left: number;
    top: number;
    width: number;
    height: number;
}

let cachedOpenMode: OpenMode = 'sidepanel';
let cachedPrevNormalWindowId: number | null = null;
let cachedDetachedWindowId: number | null = null;
let stateReadyPromise: Promise<void> | null = null;

async function syncTabsCountBadge(): Promise<void> {
    try {
        const tabs = await chrome.tabs.query({});
        const normalTabs = tabs.filter((t) => !isExtensionPageUrl(t.url || t.pendingUrl));
        await chrome.action.setBadgeBackgroundColor({ color: '#2b2d31' });
        await chrome.action.setBadgeText({ text: String(normalTabs.length) });
    } catch {
        // Ignore transient badge errors during shutdown
    }
}

function relayEvent(event: BackgroundRelayEvent): void {
    chrome.runtime.sendMessage(event).catch(() => {
        // Expected when neither Side Panel nor Detached Window is open
    });
}

async function applyOpenMode(mode: OpenMode): Promise<void> {
    cachedOpenMode = mode;
    await chrome.storage.local.set({ [OPEN_MODE_STORAGE_KEY]: mode });
    if (chrome.sidePanel?.setPanelBehavior) {
        await chrome.sidePanel
            .setPanelBehavior({ openPanelOnActionClick: mode === 'sidepanel' })
            .catch(() => {});
    }
}

async function loadCachedState(): Promise<void> {
    const stored = await chrome.storage.local.get([
        OPEN_MODE_STORAGE_KEY,
        PREV_FOCUS_WINDOW_KEY,
        DETACHED_WINDOW_ID_KEY,
    ]);
    if (stored[OPEN_MODE_STORAGE_KEY] === 'window' || stored[OPEN_MODE_STORAGE_KEY] === 'sidepanel') {
        cachedOpenMode = stored[OPEN_MODE_STORAGE_KEY];
    }
    if (typeof stored[PREV_FOCUS_WINDOW_KEY] === 'number') {
        cachedPrevNormalWindowId = stored[PREV_FOCUS_WINDOW_KEY];
    }
    if (typeof stored[DETACHED_WINDOW_ID_KEY] === 'number') {
        cachedDetachedWindowId = stored[DETACHED_WINDOW_ID_KEY];
    }
}

function ensureStateLoaded(): Promise<void> {
    if (!stateReadyPromise) {
        stateReadyPromise = loadCachedState();
    }
    return stateReadyPromise;
}

async function computeDetachedBounds(): Promise<WindowBounds> {
    const stored = await chrome.storage.local.get(DETACHED_BOUNDS_STORAGE_KEY);
    const saved = stored[DETACHED_BOUNDS_STORAGE_KEY] as WindowBounds | undefined;
    if (saved && saved.width >= 260 && saved.height >= 320) {
        return saved;
    }

    try {
        const displays = await chrome.system.display.getInfo();
        const primary = displays.find((d) => d.isPrimary) ?? displays[0];
        if (primary) {
            const width = Math.max(360, Math.min(460, Math.floor(primary.workArea.width * 0.24)));
            const height = primary.workArea.height;
            const left = primary.workArea.left + primary.workArea.width - width;
            const top = primary.workArea.top;
            return { left, top, width, height };
        }
    } catch {
        // Fallback below
    }
    return { left: 1000, top: 40, width: 400, height: 820 };
}

async function focusOrCreateDetachedWindow(): Promise<void> {
    if (cachedDetachedWindowId !== null) {
        try {
            await chrome.windows.update(cachedDetachedWindowId, { focused: true });
            return;
        } catch {
            cachedDetachedWindowId = null;
            await chrome.storage.local.remove(DETACHED_WINDOW_ID_KEY);
        }
    }

    const bounds = await computeDetachedBounds();
    const win = await chrome.windows.create({
        url: chrome.runtime.getURL('/window.html'),
        type: 'popup',
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        focused: true,
    });

    if (win?.id !== undefined) {
        cachedDetachedWindowId = win.id;
        await chrome.storage.local.set({ [DETACHED_WINDOW_ID_KEY]: win.id });
    }
}

async function openImportWindow(): Promise<void> {
    const displays = await chrome.system.display.getInfo().catch(() => []);
    const primary = displays.find((d) => d.isPrimary) ?? displays[0];
    const width = primary ? Math.max(380, Math.floor(primary.workArea.width * 0.28)) : 440;
    const height = primary ? Math.floor(primary.workArea.height * 0.85) : 780;
    const left = primary ? primary.workArea.left + 40 : 60;
    const top = primary ? primary.workArea.top + 40 : 60;

    await chrome.windows.create({
        url: chrome.runtime.getURL('/import.html'),
        type: 'popup',
        width,
        height,
        left,
        top,
        focused: true,
    });
}

async function resolveTargetNormalWindowId(): Promise<number | undefined> {
    if (cachedPrevNormalWindowId !== null) {
        try {
            const win = await chrome.windows.get(cachedPrevNormalWindowId);
            if (win.type === 'normal' && win.id !== undefined) return win.id;
        } catch {
            // Fall through
        }
    }
    const last = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
    return last?.id;
}

export default defineBackground(() => {
    void ensureStateLoaded().then(() => applyOpenMode(cachedOpenMode));
    void syncTabsCountBadge();

    chrome.runtime.onInstalled.addListener(async () => {
        stateReadyPromise = loadCachedState();
        await stateReadyPromise;
        await applyOpenMode(cachedOpenMode);
        await syncTabsCountBadge();
        await chrome.storage.local.remove(DETACHED_WINDOW_ID_KEY);
    });

    chrome.runtime.onStartup.addListener(async () => {
        stateReadyPromise = loadCachedState();
        await stateReadyPromise;
        await applyOpenMode(cachedOpenMode);
        await syncTabsCountBadge();
    });

    chrome.action.onClicked.addListener(async (tab) => {
        await ensureStateLoaded();
        if (tab.windowId !== undefined && tab.windowId !== cachedDetachedWindowId) {
            cachedPrevNormalWindowId = tab.windowId;
            void chrome.storage.local.set({ [PREV_FOCUS_WINDOW_KEY]: tab.windowId });
        }
        if (cachedOpenMode === 'window') {
            await focusOrCreateDetachedWindow();
        } else if (tab.windowId !== undefined && chrome.sidePanel?.open) {
            await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
        }
    });

    chrome.commands.onCommand.addListener(async (command) => {
        if (command !== 'openLinkMap') return;
        await ensureStateLoaded();

        if (cachedOpenMode === 'sidepanel' && chrome.sidePanel?.open) {
            const windowId = await resolveTargetNormalWindowId();
            if (windowId !== undefined) {
                try {
                    await chrome.sidePanel.open({ windowId });
                    return;
                } catch {
                    // Fallback to detached window if sidePanel.open is blocked
                }
            }
        }
        await focusOrCreateDetachedWindow();
    });

    chrome.runtime.onMessage.addListener((msg: BackgroundCommandMessage, _sender, sendResponse) => {
        if (!msg || typeof msg !== 'object' || !('action' in msg)) {
            return false;
        }

        switch (msg.action) {
            case 'OPEN_DETACHED_WINDOW':
                void ensureStateLoaded()
                    .then(() => focusOrCreateDetachedWindow())
                    .then(() => sendResponse({ ok: true }));
                return true;

            case 'OPEN_SIDE_PANEL':
                void (async () => {
                    await ensureStateLoaded();
                    const targetWindowId = msg.windowId ?? (await resolveTargetNormalWindowId());
                    if (targetWindowId !== undefined && chrome.sidePanel?.open) {
                        await chrome.sidePanel.open({ windowId: targetWindowId }).catch(() => {});
                    }
                    sendResponse({ ok: true });
                })();
                return true;

            case 'OPEN_IMPORT_WINDOW':
                void openImportWindow().then(() => sendResponse({ ok: true }));
                return true;

            case 'OPEN_DASHBOARD_TAB':
                void (async () => {
                    const base = chrome.runtime.getURL('/dashboard.html');
                    const targetUrl = msg.groupId
                        ? `${base}#group=${encodeURIComponent(msg.groupId)}`
                        : base;
                    const existing = await chrome.tabs.query({ url: `${base}*` }).catch(() => []);
                    const hit = existing[0];
                    if (hit?.id !== undefined) {
                        await chrome.tabs.update(hit.id, { url: targetUrl, active: true });
                        if (hit.windowId !== undefined) {
                            await chrome.windows.update(hit.windowId, { focused: true }).catch(() => {});
                        }
                    } else {
                        const targetWinId = await resolveTargetNormalWindowId();
                        await chrome.tabs.create({
                            url: targetUrl,
                            ...(targetWinId !== undefined ? { windowId: targetWinId } : {}),
                        });
                    }
                    sendResponse({ ok: true });
                })();
                return true;

            case 'OPEN_SHARE_VIEWER_TAB':
                void (async () => {
                    const base = chrome.runtime.getURL('/share.html');
                    const cleanHash = msg.hash ? `#${msg.hash.replace(/^#/, '')}` : '';
                    const targetWinId = await resolveTargetNormalWindowId();
                    await chrome.tabs.create({
                        url: `${base}${cleanHash}`,
                        ...(targetWinId !== undefined ? { windowId: targetWinId } : {}),
                    });
                    sendResponse({ ok: true });
                })();
                return true;

            case 'SET_OPEN_MODE':
                void applyOpenMode(msg.openMode).then(() => sendResponse({ ok: true }));
                return true;

            case 'GET_PREV_FOCUS_WINDOW':
                void resolveTargetNormalWindowId().then((windowId) =>
                    sendResponse({ windowId: windowId ?? null }),
                );
                return true;

            default:
                return false;
        }
    });

    // --- Tab lifecycle listeners ---
    chrome.tabs.onCreated.addListener(async (tab) => {
        void syncTabsCountBadge();
        if (isExtensionPageUrl(tab.url) || isExtensionPageUrl(tab.pendingUrl)) return;
        const dto = mapChromeTabToDTO(tab);
        if (!dto) return;
        let group;
        if (dto.groupId > -1 && chrome.tabGroups?.get) {
            const rawGrp = await chrome.tabGroups.get(dto.groupId).catch(() => null);
            if (rawGrp) group = mapChromeGroupToDTO(rawGrp);
        }
        relayEvent({ type: 'TAB_CREATED', tab: dto, group });
    });

    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
        void syncTabsCountBadge();
        relayEvent({ type: 'TAB_REMOVED', tabId, windowId: removeInfo.windowId });
    });

    chrome.tabs.onUpdated.addListener(async (_tabId, _changeInfo, tab) => {
        if (isExtensionPageUrl(tab.url) || isExtensionPageUrl(tab.pendingUrl)) return;
        const dto = mapChromeTabToDTO(tab);
        if (!dto) return;
        let group;
        if (dto.groupId > -1 && chrome.tabGroups?.get) {
            const rawGrp = await chrome.tabGroups.get(dto.groupId).catch(() => null);
            if (rawGrp) group = mapChromeGroupToDTO(rawGrp);
        }
        relayEvent({ type: 'TAB_UPDATED', tab: dto, group });
    });

    chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
        relayEvent({
            type: 'TAB_MOVED',
            tabId,
            windowId: moveInfo.windowId,
            fromIndex: moveInfo.fromIndex,
            toIndex: moveInfo.toIndex,
        });
    });

    chrome.tabs.onActivated.addListener((activeInfo) => {
        if (activeInfo.windowId === cachedDetachedWindowId) return;
        relayEvent({
            type: 'TAB_ACTIVATED',
            tabId: activeInfo.tabId,
            windowId: activeInfo.windowId,
        });
    });

    chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
        relayEvent({
            type: 'TAB_ATTACHED',
            tabId,
            windowId: attachInfo.newWindowId,
            newIndex: attachInfo.newPosition,
        });
    });

    chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
        const added = await chrome.tabs.get(addedTabId).catch(() => null);
        if (!added) return;
        const dto = mapChromeTabToDTO(added);
        if (!dto || isExtensionPageUrl(dto.url)) return;
        relayEvent({ type: 'TAB_REPLACED', addedTab: dto, removedTabId });
    });

    // --- Window lifecycle listeners ---
    chrome.windows.onCreated.addListener((win) => {
        if (win.id === undefined || isExtensionPopupWindow(win)) return;
        relayEvent({
            type: 'WINDOW_CREATED',
            window: {
                id: win.id,
                type: (win.type as 'normal' | 'popup') || 'normal',
                incognito: Boolean(win.incognito),
                focused: Boolean(win.focused),
                left: win.left,
                top: win.top,
                width: win.width,
                height: win.height,
                tabs: (win.tabs ?? [])
                    .map(mapChromeTabToDTO)
                    .filter((t): t is NonNullable<typeof t> => Boolean(t && !isExtensionPageUrl(t.url))),
            },
        });
    });

    chrome.windows.onRemoved.addListener(async (windowId) => {
        if (windowId === cachedDetachedWindowId) {
            cachedDetachedWindowId = null;
            await chrome.storage.local.remove(DETACHED_WINDOW_ID_KEY);
            return;
        }
        relayEvent({ type: 'WINDOW_REMOVED', windowId });
    });

    chrome.windows.onBoundsChanged?.addListener((win) => {
        if (
            win.id === cachedDetachedWindowId &&
            win.left !== undefined &&
            win.top !== undefined &&
            win.width !== undefined &&
            win.height !== undefined
        ) {
            void chrome.storage.local.set({
                [DETACHED_BOUNDS_STORAGE_KEY]: {
                    left: win.left,
                    top: win.top,
                    width: win.width,
                    height: win.height,
                },
            });
        }
    });

    chrome.windows.onFocusChanged.addListener(async (windowId) => {
        if (windowId < 0 || windowId === cachedDetachedWindowId) return;
        const win = await chrome.windows.get(windowId).catch(() => null);
        if (win && win.type === 'normal') {
            cachedPrevNormalWindowId = windowId;
            void chrome.storage.local.set({ [PREV_FOCUS_WINDOW_KEY]: windowId });
        }
        relayEvent({ type: 'WINDOW_FOCUS', windowId });
    });

    // --- Native Chrome Tab Groups listeners ---
    chrome.tabGroups?.onCreated.addListener((group) => {
        relayEvent({ type: 'GROUP_UPSERTED', group: mapChromeGroupToDTO(group) });
    });

    chrome.tabGroups?.onUpdated.addListener((group) => {
        relayEvent({ type: 'GROUP_UPSERTED', group: mapChromeGroupToDTO(group) });
    });

    chrome.tabGroups?.onRemoved.addListener((group) => {
        relayEvent({ type: 'GROUP_REMOVED', groupId: group.id });
    });
});
