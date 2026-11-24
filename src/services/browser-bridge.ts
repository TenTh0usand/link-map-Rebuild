import {
    collectSubtreeTabs,
    findParentTabGroup,
    findParentWindow,
} from '../core/tree-engine';
import type {
    CollectionNode,
    LiveTabDTO,
    LiveTabGroupDTO,
    LiveWindowDTO,
    TabGroupColor,
    TabGroupNode,
    TabNode,
    TreeNode,
    WindowNode,
} from '../core/types';

export const OPEN_MODE_STORAGE_KEY = 'openMode';
export const DETACHED_BOUNDS_STORAGE_KEY = 'detachedWindowBounds';
export const DETACHED_WINDOW_ID_KEY = 'detachedWindowId';

export function getExtensionBaseUrl(): string {
    return chrome.runtime.getURL('');
}

export function isExtensionPageUrl(url?: string): boolean {
    if (!url) return false;
    return url.startsWith(getExtensionBaseUrl());
}

export function isExtensionPopupWindow(win: chrome.windows.Window): boolean {
    if (win.type !== 'popup' || !win.tabs || win.tabs.length === 0) return false;
    return win.tabs.every((t) => isExtensionPageUrl(t.url || t.pendingUrl));
}

export function getFaviconUrl(pageUrl: string): string {
    if (!pageUrl) return '/icons/chrome_icon.svg';
    try {
        const u = new URL(chrome.runtime.getURL('/_favicon/'));
        u.searchParams.set('pageUrl', pageUrl);
        u.searchParams.set('size', '32');
        return u.toString();
    } catch {
        return '/icons/chrome_icon.svg';
    }
}

export function mapChromeTabToDTO(tab: chrome.tabs.Tab): LiveTabDTO | null {
    if (tab.id === undefined || tab.windowId === undefined) return null;
    return {
        id: tab.id,
        windowId: tab.windowId,
        groupId: tab.groupId ?? -1,
        index: tab.index,
        title: tab.title ?? tab.url ?? tab.pendingUrl ?? 'New Tab',
        url: tab.url ?? tab.pendingUrl ?? '',
        pendingUrl: tab.pendingUrl,
        favIconUrl: tab.favIconUrl,
        active: Boolean(tab.active),
        pinned: Boolean(tab.pinned),
        openerTabId: tab.openerTabId,
    };
}

export function mapChromeGroupToDTO(group: chrome.tabGroups.TabGroup): LiveTabGroupDTO {
    return {
        id: group.id,
        windowId: group.windowId,
        title: group.title ?? '',
        color: (group.color as TabGroupColor) || 'grey',
        collapsed: Boolean(group.collapsed),
    };
}

export async function fetchLiveBrowserState(): Promise<{
    windows: LiveWindowDTO[];
    groups: LiveTabGroupDTO[];
}> {
    const [chromeWindows, chromeGroups] = await Promise.all([
        chrome.windows.getAll({ populate: true }),
        chrome.tabGroups?.query({}).catch(() => []) ?? Promise.resolve([]),
    ]);

    const windows: LiveWindowDTO[] = [];
    for (const win of chromeWindows) {
        if (win.id === undefined || isExtensionPopupWindow(win)) continue;
        const tabs: LiveTabDTO[] = [];
        for (const t of win.tabs ?? []) {
            const dto = mapChromeTabToDTO(t);
            if (dto && !isExtensionPageUrl(dto.url)) {
                tabs.push(dto);
            }
        }
        windows.push({
            id: win.id,
            type: (win.type as LiveWindowDTO['type']) || 'normal',
            incognito: Boolean(win.incognito),
            focused: Boolean(win.focused),
            left: win.left,
            top: win.top,
            width: win.width,
            height: win.height,
            tabs,
        });
    }

    const groups = chromeGroups.map(mapChromeGroupToDTO);
    return { windows, groups };
}

export async function activateOrReopenTab(
    nodes: TreeNode[],
    tabNode: TabNode,
): Promise<void> {
    if (!tabNode.closed && tabNode.browserTabId !== undefined) {
        try {
            await chrome.tabs.update(tabNode.browserTabId, { active: true });
            if (tabNode.browserWindowId !== undefined) {
                await chrome.windows.update(tabNode.browserWindowId, { focused: true });
            }
            return;
        } catch {
            // Fall through to reopen if the browser tab vanished
        }
    }

    const url = tabNode.url || tabNode.pendingUrl || 'chrome://newtab/';
    const parentWin = findParentWindow(nodes, tabNode.id);
    const parentGroup = findParentTabGroup(nodes, tabNode.id);

    if (parentWin && !parentWin.closed && parentWin.browserWindowId !== undefined) {
        const created = await chrome.tabs.create({
            url,
            windowId: parentWin.browserWindowId,
            active: true,
        });
        if (parentGroup && !parentGroup.closed && parentGroup.browserGroupId !== undefined && created.id) {
            await chrome.tabs.group({
                groupId: parentGroup.browserGroupId,
                tabIds: [created.id],
            }).catch(() => {});
        }
        await chrome.windows.update(parentWin.browserWindowId, { focused: true }).catch(() => {});
        return;
    }

    await chrome.windows.create({
        url,
        focused: true,
        ...(parentWin && parentWin.width && parentWin.height
            ? {
                  incognito: parentWin.incognito,
                  left: parentWin.left,
                  top: parentWin.top,
                  width: parentWin.width,
                  height: parentWin.height,
              }
            : {}),
    });
}

export async function reopenWindowNode(windowNode: WindowNode): Promise<void> {
    if (!windowNode.closed && windowNode.browserWindowId !== undefined) {
        await chrome.windows.update(windowNode.browserWindowId, { focused: true });
        return;
    }

    const tabs = collectSubtreeTabs(windowNode, { onlyOpened: false, stopAtNestedWindow: true });
    const urls = tabs.map((t) => t.url || t.pendingUrl).filter(Boolean) as string[];
    const createdWin = await chrome.windows.create({
        url: urls.length > 0 ? urls : undefined,
        focused: true,
        incognito: windowNode.incognito,
        left: windowNode.left,
        top: windowNode.top,
        width: windowNode.width,
        height: windowNode.height,
    });

    if (!createdWin?.id || !createdWin.tabs) return;

    // Recreate native Chrome TabGroups for any TabGroupNode children
    let cursor = 0;
    const groupNodes = windowNode.children.filter((c): c is TabGroupNode => c.nodeType === 'tabGroup');
    if (groupNodes.length > 0 && chrome.tabs.group) {
        for (const tabNode of tabs) {
            const matchedTab = createdWin.tabs[cursor++];
            if (!matchedTab?.id) continue;
            const owningGroup = findParentTabGroup([windowNode], tabNode.id);
            if (owningGroup) {
                (owningGroup as TabGroupNode & { _pendingIds?: number[] })._pendingIds ??= [];
                (owningGroup as TabGroupNode & { _pendingIds?: number[] })._pendingIds!.push(matchedTab.id);
            }
        }
        for (const grp of groupNodes) {
            const pendingIds = (grp as TabGroupNode & { _pendingIds?: number[] })._pendingIds;
            if (pendingIds && pendingIds.length > 0) {
                const newGroupId = await chrome.tabs.group({
                    createProperties: { windowId: createdWin.id },
                    tabIds: pendingIds as [number, ...number[]],
                });
                await chrome.tabGroups.update(newGroupId, {
                    title: grp.title,
                    color: grp.color,
                    collapsed: grp.collapsed,
                });
            }
        }
    }
}

export async function openTabsAsChromeGroup(
    nodes: TreeNode[],
    options: {
        title: string;
        color?: TabGroupColor;
        targetWindowId?: number;
        existingGroupId?: number;
    },
): Promise<void> {
    const tabNodes = nodes.flatMap((n) => collectSubtreeTabs(n));
    if (tabNodes.length === 0) return;

    const openIds: number[] = [];
    const closedUrls: string[] = [];

    for (const t of tabNodes) {
        if (!t.closed && t.browserTabId !== undefined) {
            openIds.push(t.browserTabId);
        } else {
            const url = t.url || t.pendingUrl;
            if (url) closedUrls.push(url);
        }
    }

    let windowId = options.targetWindowId;
    if (windowId === undefined) {
        const lastFocused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
        windowId = lastFocused?.id;
    }

    const createdIds: number[] = [];
    for (const url of closedUrls) {
        const created = await chrome.tabs.create({
            url,
            windowId,
            active: false,
        });
        if (created.id !== undefined) {
            createdIds.push(created.id);
            if (windowId === undefined) windowId = created.windowId;
        }
    }

    const allTabIds = [...openIds, ...createdIds];
    if (allTabIds.length === 0) return;

    const groupId = await chrome.tabs.group({
        ...(options.existingGroupId !== undefined
            ? { groupId: options.existingGroupId }
            : windowId !== undefined
              ? { createProperties: { windowId } }
              : {}),
        tabIds: allTabIds as [number, ...number[]],
    });

    if (options.existingGroupId === undefined) {
        await chrome.tabGroups.update(groupId, {
            title: options.title,
            color: options.color ?? 'blue',
        });
    }

    if (windowId !== undefined) {
        await chrome.windows.update(windowId, { focused: true }).catch(() => {});
    }
}

export async function reopenTabGroupNode(
    nodes: TreeNode[],
    groupNode: TabGroupNode,
): Promise<void> {
    if (!groupNode.closed && groupNode.browserGroupId !== undefined) {
        const tabs = collectSubtreeTabs(groupNode, { onlyOpened: true });
        if (tabs[0]?.browserTabId !== undefined) {
            await chrome.tabs.update(tabs[0].browserTabId, { active: true }).catch(() => {});
        }
        if (groupNode.browserWindowId !== undefined) {
            await chrome.windows.update(groupNode.browserWindowId, { focused: true }).catch(() => {});
        }
        return;
    }

    const parentWin = findParentWindow(nodes, groupNode.id);
    const targetWindowId =
        parentWin && !parentWin.closed ? parentWin.browserWindowId : undefined;

    await openTabsAsChromeGroup([groupNode], {
        title: groupNode.title,
        color: groupNode.color,
        targetWindowId,
    });
}

export async function openCollectionInChrome(collection: CollectionNode): Promise<void> {
    await openTabsAsChromeGroup([collection], {
        title: collection.title,
        color: collection.color,
    });
}

export async function ungroupBrowserTabs(tabIds: number[]): Promise<void> {
    if (tabIds.length === 0 || !chrome.tabs.ungroup) return;
    await chrome.tabs.ungroup(tabIds as [number, ...number[]]).catch(() => {});
}

export async function updateChromeTabGroupMeta(
    browserGroupId: number,
    meta: { title?: string; color?: TabGroupColor; collapsed?: boolean },
): Promise<void> {
    await chrome.tabGroups.update(browserGroupId, meta).catch(() => {});
}

export async function closeBrowserTabs(tabIds: number[]): Promise<void> {
    if (tabIds.length === 0) return;
    await chrome.tabs.remove(tabIds).catch(() => {});
}

export async function moveBrowserTabs(
    tabIds: number[],
    targetWindowId: number,
    index = -1,
): Promise<void> {
    if (tabIds.length === 0) return;
    await chrome.tabs.move(tabIds, { windowId: targetWindowId, index }).catch(() => {});
}

export async function syncChromeWindowTabOrder(windowNode: WindowNode): Promise<void> {
    if (windowNode.closed || windowNode.browserWindowId === undefined) return;
    const openTabs = collectSubtreeTabs(windowNode, {
        onlyOpened: true,
        stopAtNestedWindow: true,
    });
    const ids = openTabs.map((t) => t.browserTabId).filter((id): id is number => id !== undefined);
    if (ids.length === 0) return;
    await chrome.tabs.move(ids, { windowId: windowNode.browserWindowId, index: 0 }).catch(() => {});
}

export async function downloadTextOrJsonFile(
    content: string,
    filename: string,
    mimeType = 'application/json',
): Promise<void> {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
        await chrome.downloads.download({ url, filename, saveAs: true });
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
}

export function getShortcutSettingsUrl(): string {
    return import.meta.env.BROWSER === 'edge'
        ? 'edge://extensions/shortcuts'
        : 'chrome://extensions/shortcuts';
}

export function getDefaultNewTabUrl(): string {
    return import.meta.env.BROWSER === 'edge' ? 'edge://newtab/' : 'chrome://newtab/';
}

export async function getOpenLinkMapShortcut(): Promise<string> {
    try {
        const commands = await chrome.commands.getAll();
        const found = commands.find((c) => c.name === 'openLinkMap');
        return found?.shortcut || '';
    } catch {
        return '';
    }
}
