import type {
    CollectionCategory,
    CollectionNode,
    DropPosition,
    FlatVisibleNode,
    LiveTabDTO,
    LiveTabGroupDTO,
    LiveWindowDTO,
    NoteNode,
    TabGroupColor,
    TabGroupNode,
    TabNode,
    TreeNode,
    WindowNode,
} from './types';
import type { MoveResult, ReconcileOptions } from './kernel-interface';

export function createNodeId(prefix = 'n'): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function cloneNodes<T extends TreeNode>(nodes: T[]): T[] {
    return nodes.map((node) => ({
        ...node,
        children: cloneNodes(node.children),
    }));
}

export function findNodeById(nodes: TreeNode[], id: string): TreeNode | null {
    for (const node of nodes) {
        if (node.id === id) return node;
        const found = findNodeById(node.children, id);
        if (found) return found;
    }
    return null;
}

export function findNodeWithParent(
    nodes: TreeNode[],
    id: string,
    parent: TreeNode | null = null,
): { node: TreeNode; parent: TreeNode | null; index: number } | null {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        if (node.id === id) return { node, parent, index: i };
        const found = findNodeWithParent(node.children, id, node);
        if (found) return found;
    }
    return null;
}

export function findNodeByBrowserTabId(nodes: TreeNode[], browserTabId: number): TabNode | null {
    for (const node of nodes) {
        if (node.nodeType === 'tab' && node.browserTabId === browserTabId) {
            return node;
        }
        const found = findNodeByBrowserTabId(node.children, browserTabId);
        if (found) return found;
    }
    return null;
}

export function findNodeByBrowserWindowId(
    nodes: TreeNode[],
    browserWindowId: number,
): WindowNode | null {
    for (const node of nodes) {
        if (node.nodeType === 'window' && node.browserWindowId === browserWindowId) {
            return node;
        }
        const found = findNodeByBrowserWindowId(node.children, browserWindowId);
        if (found) return found;
    }
    return null;
}

export function findNodeByBrowserGroupId(
    nodes: TreeNode[],
    browserGroupId: number,
): TabGroupNode | null {
    for (const node of nodes) {
        if (node.nodeType === 'tabGroup' && node.browserGroupId === browserGroupId) {
            return node;
        }
        const found = findNodeByBrowserGroupId(node.children, browserGroupId);
        if (found) return found;
    }
    return null;
}

export function findAncestorPath(nodes: TreeNode[], targetId: string): TreeNode[] | null {
    for (const node of nodes) {
        if (node.id === targetId) return [node];
        const childPath = findAncestorPath(node.children, targetId);
        if (childPath) return [node, ...childPath];
    }
    return null;
}

export function findParentNode(nodes: TreeNode[], targetId: string): TreeNode | null {
    const path = findAncestorPath(nodes, targetId);
    if (!path || path.length < 2) return null;
    return path[path.length - 2] ?? null;
}

export function findParentWindow(nodes: TreeNode[], targetId: string): WindowNode | null {
    const path = findAncestorPath(nodes, targetId);
    if (!path) return null;
    for (let i = path.length - 1; i >= 0; i--) {
        const item = path[i];
        if (item?.nodeType === 'window') {
            return item as WindowNode;
        }
    }
    return null;
}

export function findParentTabGroup(nodes: TreeNode[], targetId: string): TabGroupNode | null {
    const path = findAncestorPath(nodes, targetId);
    if (!path) return null;
    for (let i = path.length - 1; i >= 0; i--) {
        const item = path[i];
        if (item?.nodeType === 'tabGroup') {
            return item as TabGroupNode;
        }
        if (item?.nodeType === 'window') {
            return null;
        }
    }
    return null;
}

export function collectSubtreeTabs(
    node: TreeNode,
    options: { onlyOpened?: boolean; stopAtNestedWindow?: boolean } = {},
): TabNode[] {
    const { onlyOpened = false, stopAtNestedWindow = false } = options;
    const result: TabNode[] = [];

    const walk = (current: TreeNode, isRoot: boolean) => {
        if (!isRoot && stopAtNestedWindow && current.nodeType === 'window') {
            return;
        }
        if (current.nodeType === 'tab') {
            if (!onlyOpened || !current.closed) {
                result.push(current);
            }
        }
        for (const child of current.children) {
            walk(child, false);
        }
    };

    walk(node, true);
    return result;
}

export function collectSubtreeIds(node: TreeNode): string[] {
    const ids: string[] = [node.id];
    for (const child of node.children) {
        ids.push(...collectSubtreeIds(child));
    }
    return ids;
}

export function canAutoRemoveTab(node: TabNode): boolean {
    return !node.closed && !node.alias && !node.saved;
}

export function generateWindowTitle(windowType: WindowNode['windowType'] = 'normal'): string {
    return windowType && windowType !== 'normal' ? `Window (${windowType})` : 'Window';
}

export function createWindowNodeFromLive(win: LiveWindowDTO): WindowNode {
    return {
        id: createNodeId('win'),
        nodeType: 'window',
        title: generateWindowTitle(win.type),
        browserWindowId: win.id,
        windowType: win.type,
        incognito: win.incognito,
        focused: win.focused,
        left: win.left,
        top: win.top,
        width: win.width,
        height: win.height,
        closed: false,
        expanded: true,
        children: [],
    };
}

export function createTabGroupNodeFromLive(group: LiveTabGroupDTO): TabGroupNode {
    return {
        id: createNodeId('grp'),
        nodeType: 'tabGroup',
        title: group.title || 'Tab Group',
        browserGroupId: group.id,
        browserWindowId: group.windowId,
        color: group.color,
        collapsed: group.collapsed,
        closed: false,
        expanded: !group.collapsed,
        children: [],
    };
}

export function createTabNodeFromLive(tab: LiveTabDTO): TabNode {
    return {
        id: createNodeId('tab'),
        nodeType: 'tab',
        title: tab.title || tab.url || tab.pendingUrl || 'New Tab',
        url: tab.url || tab.pendingUrl || '',
        pendingUrl: tab.pendingUrl,
        favIconUrl: tab.favIconUrl,
        browserTabId: tab.id,
        browserWindowId: tab.windowId,
        browserGroupId: tab.groupId,
        openerTabId: tab.openerTabId,
        index: tab.index,
        pinned: tab.pinned,
        active: tab.active,
        closed: false,
        expanded: true,
        children: [],
    };
}

export function createNoteNode(title = 'Note'): NoteNode {
    return {
        id: createNodeId('note'),
        nodeType: 'note',
        title,
        expanded: true,
        children: [],
    };
}

export function createCollectionNode(
    title: string,
    color: TabGroupColor = 'blue',
    category: CollectionCategory = 'workspace',
    children: TreeNode[] = [],
): CollectionNode {
    return {
        id: createNodeId('col'),
        nodeType: 'collection',
        title,
        color,
        category,
        expanded: true,
        saved: true,
        children,
    };
}

export function flattenVisibleTree(nodes: TreeNode[]): FlatVisibleNode[] {
    const out: FlatVisibleNode[] = [];
    const walk = (
        list: TreeNode[],
        depth: number,
        parentId: string | null,
        ancestorIds: string[],
    ) => {
        for (const node of list) {
            const hasChildren = node.children.length > 0;
            out.push({
                node,
                depth,
                parentId,
                ancestorIds,
                hasChildren,
            });
            if (hasChildren && node.expanded) {
                walk(node.children, depth + 1, node.id, [...ancestorIds, node.id]);
            }
        }
    };
    walk(nodes, 0, null, []);
    return out;
}

function hasOpenTabDescendant(node: TreeNode, stopAtNestedWindow = true): boolean {
    for (const child of node.children) {
        if (stopAtNestedWindow && child.nodeType === 'window') continue;
        if (child.nodeType === 'tab' && !child.closed) return true;
        if (hasOpenTabDescendant(child, stopAtNestedWindow)) return true;
    }
    return false;
}

/**
 * Recomputes closed flags and tab indices across all WindowNode and TabGroupNode items.
 */
export function normalizeWindowStatuses(nodes: TreeNode[]): TreeNode[] {
    const visit = (list: TreeNode[]): TreeNode[] =>
        list.map((node) => {
            const nextChildren = visit(node.children);
            const nextNode = { ...node, children: nextChildren };
            if (nextNode.nodeType === 'window') {
                const openTabs = collectSubtreeTabs(nextNode, {
                    onlyOpened: true,
                    stopAtNestedWindow: true,
                });
                openTabs.forEach((t, idx) => {
                    t.index = idx;
                });
                return {
                    ...nextNode,
                    closed: openTabs.length === 0,
                };
            }
            if (nextNode.nodeType === 'tabGroup') {
                const openTabs = collectSubtreeTabs(nextNode, {
                    onlyOpened: true,
                    stopAtNestedWindow: true,
                });
                return {
                    ...nextNode,
                    closed: openTabs.length === 0,
                };
            }
            return nextNode;
        });

    return visit(nodes);
}

function markTreeNodesClosed(nodes: TreeNode[]): TreeNode[] {
    return nodes.map((node) => {
        const nextChildren = markTreeNodesClosed(node.children);
        if (node.nodeType === 'window') {
            return { ...node, closed: true, focused: false, children: nextChildren };
        }
        if (node.nodeType === 'tabGroup') {
            return { ...node, closed: true, children: nextChildren };
        }
        if (node.nodeType === 'tab') {
            return {
                ...node,
                closed: true,
                active: false,
                url: node.url || node.pendingUrl || '',
                children: nextChildren,
            };
        }
        return { ...node, children: nextChildren };
    });
}

function detachNodeById(nodes: TreeNode[], id: string): { nodes: TreeNode[]; detached: TreeNode | null } {
    let detached: TreeNode | null = null;
    const walk = (list: TreeNode[]): TreeNode[] => {
        const out: TreeNode[] = [];
        for (const item of list) {
            if (item.id === id) {
                detached = item;
                continue;
            }
            out.push({ ...item, children: walk(item.children) });
        }
        return out;
    };
    const nextNodes = walk(nodes);
    return { nodes: nextNodes, detached };
}

function clearActiveTabInWindow(nodes: TreeNode[], browserWindowId: number, activeId: string): void {
    const walk = (list: TreeNode[]) => {
        for (const item of list) {
            if (item.nodeType === 'tab' && item.browserWindowId === browserWindowId) {
                item.active = item.id === activeId;
            }
            walk(item.children);
        }
    };
    walk(nodes);
}

function insertRelativeToNode(
    nodes: TreeNode[],
    targetId: string,
    toInsert: TreeNode[],
    position: 'before' | 'inside' | 'firstChild' | 'after',
): { nodes: TreeNode[]; inserted: boolean } {
    let inserted = false;
    const walk = (list: TreeNode[]): TreeNode[] => {
        const out: TreeNode[] = [];
        for (const item of list) {
            if (item.id === targetId) {
                inserted = true;
                if (position === 'before') {
                    out.push(...toInsert, item);
                } else if (position === 'after') {
                    out.push(item, ...toInsert);
                } else if (position === 'firstChild') {
                    out.push({
                        ...item,
                        expanded: true,
                        children: [...toInsert, ...item.children],
                    });
                } else {
                    out.push({
                        ...item,
                        expanded: true,
                        children: [...item.children, ...toInsert],
                    });
                }
                continue;
            }
            out.push({ ...item, children: walk(item.children) });
        }
        return out;
    };

    const next = walk(nodes);
    return { nodes: next, inserted };
}

export interface InsertLiveTabOptions {
    createNewTabByLevel: boolean;
    newTabUrl: string;
    syncNativeTabGroups: boolean;
    groupInfo?: LiveTabGroupDTO;
}

export function insertLiveTab(
    nodes: TreeNode[],
    tab: LiveTabDTO,
    options: InsertLiveTabOptions,
): TreeNode[] {
    const existing = findNodeByBrowserTabId(nodes, tab.id);
    if (existing) {
        return updateLiveTab(nodes, tab);
    }

    let draft = cloneNodes(nodes);
    let winNode = findNodeByBrowserWindowId(draft, tab.windowId);
    if (!winNode) {
        winNode = createWindowNodeFromLive({
            id: tab.windowId,
            type: 'normal',
            incognito: false,
            focused: false,
            tabs: [],
        });
        draft.push(winNode);
    }

    const newNode = createTabNodeFromLive(tab);

    // Handle Chrome native TabGroup placement
    if (options.syncNativeTabGroups && tab.groupId > -1) {
        let groupNode = findNodeByBrowserGroupId(winNode.children, tab.groupId);
        if (!groupNode) {
            groupNode = createTabGroupNodeFromLive(
                options.groupInfo ?? {
                    id: tab.groupId,
                    windowId: tab.windowId,
                    title: '',
                    color: 'grey',
                    collapsed: false,
                },
            );
            winNode.children.push(groupNode);
        }
        // Try nesting under opener if inside the same group
        const openerInGroup =
            tab.openerTabId !== undefined
                ? findNodeByBrowserTabId(groupNode.children, tab.openerTabId)
                : null;
        if (openerInGroup) {
            openerInGroup.children.unshift(newNode);
        } else {
            groupNode.children.push(newNode);
        }
    } else {
        // Standard Link Map opener-level placement
        const openTabsInWin = collectSubtreeTabs(winNode, {
            onlyOpened: true,
            stopAtNestedWindow: true,
        });
        const prevTab = openTabsInWin.find((t) => t.index === tab.index - 1) ?? null;
        const isBlankNewTab =
            tab.pendingUrl === options.newTabUrl || tab.url === options.newTabUrl;

        if (!options.createNewTabByLevel && isBlankNewTab) {
            winNode.children.push(newNode);
        } else if (!prevTab) {
            winNode.children.unshift(newNode);
        } else if (prevTab.browserTabId === tab.openerTabId) {
            prevTab.children.unshift(newNode);
        } else if (!prevTab.openerTabId || prevTab.openerTabId === tab.openerTabId) {
            const res = insertRelativeToNode(draft, prevTab.id, [newNode], 'after');
            draft = res.nodes;
        } else {
            winNode.children.push(newNode);
        }
    }

    if (tab.active) {
        clearActiveTabInWindow(draft, tab.windowId, newNode.id);
    }

    return normalizeWindowStatuses(draft);
}

export function updateLiveTab(nodes: TreeNode[], tab: LiveTabDTO, groupInfo?: LiveTabGroupDTO, syncNativeTabGroups = true): TreeNode[] {
    const draft = cloneNodes(nodes);
    const existing = findNodeByBrowserTabId(draft, tab.id);
    if (!existing) return draft;

    const prevGroupId = existing.browserGroupId;
    existing.title = tab.title || tab.url || existing.title;
    existing.url = tab.url || existing.url;
    existing.pendingUrl = tab.pendingUrl;
    if (tab.favIconUrl) existing.favIconUrl = tab.favIconUrl;
    existing.browserWindowId = tab.windowId;
    existing.browserGroupId = tab.groupId;
    existing.pinned = tab.pinned;
    existing.closed = false;

    if (tab.active) {
        clearActiveTabInWindow(draft, tab.windowId, existing.id);
    }

    // Handle native Chrome tabGroup membership change
    if (syncNativeTabGroups && prevGroupId !== tab.groupId) {
        const winNode = findNodeByBrowserWindowId(draft, tab.windowId);
        if (winNode) {
            const detachedRes = detachNodeById(draft, existing.id);
            if (detachedRes.detached) {
                const nextDraft = detachedRes.nodes;
                const nextWin = findNodeByBrowserWindowId(nextDraft, tab.windowId);
                if (nextWin) {
                    if (tab.groupId > -1) {
                        let grp = findNodeByBrowserGroupId(nextWin.children, tab.groupId);
                        if (!grp) {
                            grp = createTabGroupNodeFromLive(
                                groupInfo ?? {
                                    id: tab.groupId,
                                    windowId: tab.windowId,
                                    title: '',
                                    color: 'grey',
                                    collapsed: false,
                                },
                            );
                            nextWin.children.push(grp);
                        }
                        grp.children.push(detachedRes.detached);
                    } else {
                        nextWin.children.push(detachedRes.detached);
                    }
                    return normalizeWindowStatuses(nextDraft);
                }
            }
        }
    }

    return normalizeWindowStatuses(draft);
}

export function activateLiveTab(nodes: TreeNode[], browserWindowId: number, browserTabId: number): TreeNode[] {
    if (browserWindowId < 0) return nodes;
    const draft = cloneNodes(nodes);
    const target = findNodeByBrowserTabId(draft, browserTabId);
    if (!target) return draft;
    clearActiveTabInWindow(draft, browserWindowId, target.id);
    return draft;
}

export function removeLiveTab(nodes: TreeNode[], browserTabId: number): TreeNode[] {
    const target = findNodeByBrowserTabId(nodes, browserTabId);
    if (!target) return nodes;

    let draft = cloneNodes(nodes);
    const nodeInDraft = findNodeByBrowserTabId(draft, browserTabId);
    if (!nodeInDraft) return nodes;

    if (!canAutoRemoveTab(nodeInDraft)) {
        nodeInDraft.closed = true;
        nodeInDraft.active = false;
        return normalizeWindowStatuses(draft);
    }

    // Lift children as siblings and remove the tab node
    const liftRemove = (list: TreeNode[]): TreeNode[] => {
        const out: TreeNode[] = [];
        for (const item of list) {
            if (item.id === nodeInDraft.id) {
                out.push(...liftRemove(item.children));
                continue;
            }
            out.push({ ...item, children: liftRemove(item.children) });
        }
        return out;
    };

    draft = liftRemove(draft);
    return normalizeWindowStatuses(draft);
}

export function moveLiveTab(
    nodes: TreeNode[],
    browserWindowId: number,
    browserTabId: number,
    fromIndex: number,
    toIndex: number,
): TreeNode[] {
    if (fromIndex === toIndex) return nodes;
    const draft = cloneNodes(nodes);
    const targetTab = findNodeByBrowserTabId(draft, browserTabId);
    if (!targetTab || targetTab.index === toIndex) return draft;

    const targetWin = findNodeByBrowserWindowId(draft, browserWindowId);
    if (!targetWin) return draft;

    // Lift children before repositioning
    const childrenToLift = [...targetTab.children];
    targetTab.children = [];

    if (childrenToLift.length > 0) {
        const liftRes = insertRelativeToNode(draft, targetTab.id, childrenToLift, 'after');
        return repositionTabInWindow(liftRes.nodes, targetTab.id, targetWin.id, toIndex);
    }
    return repositionTabInWindow(draft, targetTab.id, targetWin.id, toIndex);
}

function repositionTabInWindow(
    nodes: TreeNode[],
    tabNodeId: string,
    windowNodeId: string,
    toIndex: number,
): TreeNode[] {
    const detachedRes = detachNodeById(nodes, tabNodeId);
    if (!detachedRes.detached) return nodes;
    const movedTab = detachedRes.detached as TabNode;
    const winNode = findNodeById(detachedRes.nodes, windowNodeId) as WindowNode | null;
    if (!winNode) return nodes;

    movedTab.browserWindowId = winNode.browserWindowId;

    if (toIndex <= 0) {
        const res = insertRelativeToNode(detachedRes.nodes, winNode.id, [movedTab], 'firstChild');
        return normalizeWindowStatuses(res.nodes);
    }

    const openTabs = collectSubtreeTabs(winNode, { onlyOpened: true, stopAtNestedWindow: true });
    let anchor = openTabs.find((t) => t.index === toIndex - 1);
    if (!anchor || anchor.id === movedTab.id) {
        anchor = openTabs.find((t) => t.index === toIndex) ?? openTabs[openTabs.length - 1];
    }

    if (!anchor) {
        const res = insertRelativeToNode(detachedRes.nodes, winNode.id, [movedTab], 'inside');
        return normalizeWindowStatuses(res.nodes);
    }

    const firstOpenChild = anchor.children.find((c) => c.nodeType === 'tab' && !c.closed);
    if (firstOpenChild) {
        const res = insertRelativeToNode(detachedRes.nodes, firstOpenChild.id, [movedTab], 'before');
        return normalizeWindowStatuses(res.nodes);
    }

    const res = insertRelativeToNode(detachedRes.nodes, anchor.id, [movedTab], 'after');
    return normalizeWindowStatuses(res.nodes);
}

export function attachLiveTab(
    nodes: TreeNode[],
    newBrowserWindowId: number,
    browserTabId: number,
    newIndex: number,
): TreeNode[] {
    const draft = cloneNodes(nodes);
    const tabNode = findNodeByBrowserTabId(draft, browserTabId);
    const winNode = findNodeByBrowserWindowId(draft, newBrowserWindowId);
    if (!tabNode || !winNode) return draft;
    tabNode.browserWindowId = newBrowserWindowId;
    return repositionTabInWindow(draft, tabNode.id, winNode.id, newIndex);
}

export function replaceLiveTab(
    nodes: TreeNode[],
    addedTab: LiveTabDTO,
    removedBrowserTabId: number,
): TreeNode[] {
    const draft = cloneNodes(nodes);
    const target = findNodeByBrowserTabId(draft, removedBrowserTabId);
    if (!target) return draft;
    target.browserTabId = addedTab.id;
    target.title = addedTab.title || target.title;
    target.url = addedTab.url || target.url;
    target.pendingUrl = addedTab.pendingUrl;
    if (addedTab.favIconUrl) target.favIconUrl = addedTab.favIconUrl;
    target.browserWindowId = addedTab.windowId;
    target.browserGroupId = addedTab.groupId;
    target.closed = false;
    return normalizeWindowStatuses(draft);
}

export function createLiveWindow(nodes: TreeNode[], win: LiveWindowDTO): TreeNode[] {
    const existing = findNodeByBrowserWindowId(nodes, win.id);
    if (existing) return nodes;
    const draft = cloneNodes(nodes);
    const newWin = createWindowNodeFromLive(win);
    for (const tab of win.tabs) {
        newWin.children.push(createTabNodeFromLive(tab));
    }
    draft.push(newWin);
    return normalizeWindowStatuses(draft);
}

export function removeLiveWindow(nodes: TreeNode[], browserWindowId: number): TreeNode[] {
    const winNode = findNodeByBrowserWindowId(nodes, browserWindowId);
    if (!winNode) return nodes;
    let draft = cloneNodes(nodes);
    const winInDraft = findNodeByBrowserWindowId(draft, browserWindowId);
    if (!winInDraft) return nodes;

    if (winInDraft.children.length === 0 && !winInDraft.saved && !winInDraft.alias) {
        draft = detachNodeById(draft, winInDraft.id).nodes;
    } else {
        winInDraft.closed = true;
        winInDraft.focused = false;
    }
    return normalizeWindowStatuses(draft);
}

export function syncTabGroupUpsert(nodes: TreeNode[], group: LiveTabGroupDTO): TreeNode[] {
    const draft = cloneNodes(nodes);
    const existing = findNodeByBrowserGroupId(draft, group.id);
    if (existing) {
        existing.title = group.title || existing.title;
        existing.color = group.color;
        existing.collapsed = group.collapsed;
        existing.browserWindowId = group.windowId;
        existing.closed = false;
        return normalizeWindowStatuses(draft);
    }
    const winNode = findNodeByBrowserWindowId(draft, group.windowId);
    if (!winNode) return draft;
    winNode.children.push(createTabGroupNodeFromLive(group));
    return normalizeWindowStatuses(draft);
}

export function syncTabGroupRemoved(nodes: TreeNode[], browserGroupId: number): TreeNode[] {
    const existing = findNodeByBrowserGroupId(nodes, browserGroupId);
    if (!existing) return nodes;
    const draft = cloneNodes(nodes);
    const grp = findNodeByBrowserGroupId(draft, browserGroupId);
    if (!grp) return nodes;

    // If any closed/saved children remain, keep the TabGroupNode as a saved closed group;
    // otherwise dissolve it and lift remaining open tabs if any.
    const hasSavedOrClosedChildren = grp.children.some(
        (c) => c.saved || c.alias || (c.nodeType === 'tab' && c.closed),
    );
    if (hasSavedOrClosedChildren) {
        grp.closed = !hasOpenTabDescendant(grp, true);
        return normalizeWindowStatuses(draft);
    }

    const lift = (list: TreeNode[]): TreeNode[] => {
        const out: TreeNode[] = [];
        for (const item of list) {
            if (item.id === grp.id) {
                for (const child of item.children) {
                    if (child.nodeType === 'tab') {
                        out.push({ ...child, browserGroupId: -1 });
                    } else {
                        out.push(child);
                    }
                }
                continue;
            }
            out.push({ ...item, children: lift(item.children) });
        }
        return out;
    };

    return normalizeWindowStatuses(lift(draft));
}

export function reconcileSnapshotWithLive(
    snapshotNodes: TreeNode[],
    liveWindows: LiveWindowDTO[],
    liveGroups: LiveTabGroupDTO[],
    options: ReconcileOptions,
): TreeNode[] {
    let draft = markTreeNodesClosed(cloneNodes(snapshotNodes));

    const groupById = new Map<number, LiveTabGroupDTO>();
    for (const g of liveGroups) {
        groupById.set(g.id, g);
    }

    for (const liveWin of liveWindows) {
        let winNode = findNodeByBrowserWindowId(draft, liveWin.id);
        if (winNode) {
            winNode.closed = false;
            winNode.focused = liveWin.focused;
            winNode.incognito = liveWin.incognito;
            winNode.windowType = liveWin.type;
            winNode.left = liveWin.left;
            winNode.top = liveWin.top;
            winNode.width = liveWin.width;
            winNode.height = liveWin.height;
        } else {
            winNode = createWindowNodeFromLive(liveWin);
            draft.push(winNode);
        }

        // Sync live tabGroups inside this window
        if (options.syncNativeTabGroups) {
            const winGroups = liveGroups.filter((g) => g.windowId === liveWin.id);
            for (const g of winGroups) {
                let grpNode = findNodeByBrowserGroupId(draft, g.id);
                if (grpNode) {
                    grpNode.title = g.title || grpNode.title;
                    grpNode.color = g.color;
                    grpNode.collapsed = g.collapsed;
                    grpNode.browserWindowId = liveWin.id;
                    grpNode.closed = false;
                } else {
                    grpNode = createTabGroupNodeFromLive(g);
                    winNode.children.push(grpNode);
                }
            }
        }

        // Sync live tabs inside this window
        const sortedTabs = [...liveWin.tabs].sort((a, b) => a.index - b.index);
        for (const liveTab of sortedTabs) {
            const existingTab = findNodeByBrowserTabId(draft, liveTab.id);
            if (existingTab) {
                const prevWinId = existingTab.browserWindowId;
                existingTab.title = liveTab.title || liveTab.url || existingTab.title;
                existingTab.url = liveTab.url || existingTab.url;
                existingTab.pendingUrl = liveTab.pendingUrl;
                if (liveTab.favIconUrl) existingTab.favIconUrl = liveTab.favIconUrl;
                existingTab.browserWindowId = liveWin.id;
                existingTab.browserGroupId = liveTab.groupId;
                existingTab.index = liveTab.index;
                existingTab.pinned = liveTab.pinned;
                existingTab.active = liveTab.active;
                existingTab.closed = false;

                if (prevWinId !== liveWin.id) {
                    const detachedRes = detachNodeById(draft, existingTab.id);
                    draft = detachedRes.nodes;
                    const targetWin = findNodeByBrowserWindowId(draft, liveWin.id);
                    if (targetWin && detachedRes.detached) {
                        if (options.syncNativeTabGroups && liveTab.groupId > -1) {
                            const grp = findNodeByBrowserGroupId(targetWin.children, liveTab.groupId);
                            if (grp) {
                                grp.children.push(detachedRes.detached);
                            } else {
                                targetWin.children.push(detachedRes.detached);
                            }
                        } else {
                            targetWin.children.push(detachedRes.detached);
                        }
                    }
                } else if (options.syncNativeTabGroups && liveTab.groupId > -1) {
                    const currentGroup = findParentTabGroup(draft, existingTab.id);
                    if (!currentGroup || currentGroup.browserGroupId !== liveTab.groupId) {
                        const detachedRes = detachNodeById(draft, existingTab.id);
                        draft = detachedRes.nodes;
                        const targetGroup = findNodeByBrowserGroupId(draft, liveTab.groupId);
                        if (targetGroup && detachedRes.detached) {
                            targetGroup.children.push(detachedRes.detached);
                        }
                    }
                }
            } else {
                draft = insertLiveTab(draft, liveTab, {
                    createNewTabByLevel: false,
                    newTabUrl: 'chrome://newtab/',
                    syncNativeTabGroups: options.syncNativeTabGroups,
                    groupInfo: liveTab.groupId > -1 ? groupById.get(liveTab.groupId) : undefined,
                });
            }
        }
    }

    return normalizeWindowStatuses(draft);
}

export function closeNodes(
    nodes: TreeNode[],
    targetIds: string[],
    mode: 'item' | 'subtree' | 'auto' = 'auto',
): { nodes: TreeNode[]; tabIdsToClose: number[] } {
    const draft = cloneNodes(nodes);
    const tabIdsToClose = new Set<number>();

    for (const targetId of targetIds) {
        const node = findNodeById(draft, targetId);
        if (!node) continue;

        const effectiveMode: 'item' | 'subtree' =
            mode === 'auto' ? (node.expanded ? 'item' : 'subtree') : mode;

        if (effectiveMode === 'item' && node.nodeType === 'tab') {
            if (!node.closed && node.browserTabId !== undefined) {
                tabIdsToClose.add(node.browserTabId);
            }
            node.closed = true;
            node.active = false;
        } else if (effectiveMode === 'item' && (node.nodeType === 'window' || node.nodeType === 'tabGroup')) {
            const tabs = collectSubtreeTabs(node, { onlyOpened: true, stopAtNestedWindow: true });
            for (const t of tabs) {
                if (t.browserTabId !== undefined) tabIdsToClose.add(t.browserTabId);
                t.closed = true;
                t.active = false;
            }
            node.closed = true;
        } else {
            const tabs = collectSubtreeTabs(node, { onlyOpened: true, stopAtNestedWindow: false });
            for (const t of tabs) {
                if (t.browserTabId !== undefined) tabIdsToClose.add(t.browserTabId);
                t.closed = true;
                t.active = false;
            }
        }
    }

    return {
        nodes: normalizeWindowStatuses(draft),
        tabIdsToClose: [...tabIdsToClose],
    };
}

export function deleteNodes(
    nodes: TreeNode[],
    targetIds: string[],
    mode: 'item' | 'subtree' | 'auto' = 'auto',
): { nodes: TreeNode[]; tabIdsToClose: number[] } {
    let draft = cloneNodes(nodes);
    const tabIdsToClose = new Set<number>();
    const targetSet = new Set(targetIds);

    // Filter out targets whose ancestor is also in targetSet when subtree deletion applies
    for (const targetId of targetIds) {
        const node = findNodeById(draft, targetId);
        if (!node) continue;

        const effectiveMode: 'item' | 'subtree' =
            mode === 'auto' ? (node.expanded ? 'item' : 'subtree') : mode;

        if (effectiveMode === 'item') {
            if (node.nodeType === 'tab' && !node.closed && node.browserTabId !== undefined) {
                tabIdsToClose.add(node.browserTabId);
            } else if (node.nodeType === 'window' || node.nodeType === 'tabGroup') {
                // Only close node's direct/non-preserved open tabs? When deleting a window item only,
                // children are lifted to root; if window was closed or empty nothing to close,
                // if open tabs exist under window we leave them or close only if user chose subtree.
                // Matching Link Map v1: deleting an expanded window lifts children and closes open tabs in that window.
                const tabs = collectSubtreeTabs(node, {
                    onlyOpened: true,
                    stopAtNestedWindow: true,
                });
                for (const t of tabs) {
                    if (t.browserTabId !== undefined) tabIdsToClose.add(t.browserTabId);
                    t.closed = true;
                    t.active = false;
                }
            }
            const removeSingleAndLift = (list: TreeNode[]): TreeNode[] => {
                const out: TreeNode[] = [];
                for (const item of list) {
                    if (item.id === targetId) {
                        out.push(...item.children);
                        continue;
                    }
                    out.push({ ...item, children: removeSingleAndLift(item.children) });
                }
                return out;
            };
            draft = removeSingleAndLift(draft);
        } else {
            const tabs = collectSubtreeTabs(node, { onlyOpened: true, stopAtNestedWindow: false });
            for (const t of tabs) {
                if (t.browserTabId !== undefined) tabIdsToClose.add(t.browserTabId);
            }
            const removeSubtree = (list: TreeNode[]): TreeNode[] => {
                const out: TreeNode[] = [];
                for (const item of list) {
                    if (item.id === targetId && targetSet.has(item.id)) {
                        continue;
                    }
                    out.push({ ...item, children: removeSubtree(item.children) });
                }
                return out;
            };
            draft = removeSubtree(draft);
        }
    }

    return {
        nodes: normalizeWindowStatuses(draft),
        tabIdsToClose: [...tabIdsToClose],
    };
}

export function toggleSaveNodes(nodes: TreeNode[], targetIds: string[]): TreeNode[] {
    const draft = cloneNodes(nodes);
    for (const id of targetIds) {
        const node = findNodeById(draft, id);
        if (!node) continue;
        const nextSaved = !node.saved;
        node.saved = nextSaved;
        if (!node.expanded || node.nodeType === 'window' || node.nodeType === 'tabGroup') {
            const mark = (children: TreeNode[]) => {
                for (const child of children) {
                    if (child.nodeType !== 'note') {
                        child.saved = nextSaved;
                    }
                    mark(child.children);
                }
            };
            mark(node.children);
        }
    }
    return draft;
}

export function updateNodeAlias(nodes: TreeNode[], nodeId: string, alias: string): TreeNode[] {
    const draft = cloneNodes(nodes);
    const node = findNodeById(draft, nodeId);
    if (!node) return nodes;
    const trimmed = alias.trim();
    if (node.nodeType === 'note') {
        node.title = trimmed || 'Note';
        node.alias = trimmed || undefined;
    } else {
        node.alias = trimmed || undefined;
    }
    node.updatedAt = Date.now();
    return draft;
}

export function insertNoteNode(
    nodes: TreeNode[],
    targetId: string | null,
    position: 'parent' | 'firstChild' | 'lastChild' | 'after' | 'root',
    title = 'Note',
): { nodes: TreeNode[]; newNodeId: string } {
    const note = createNoteNode(title);
    if (!targetId || position === 'root') {
        return {
            nodes: [note, ...cloneNodes(nodes)],
            newNodeId: note.id,
        };
    }

    const draft = cloneNodes(nodes);
    if (position === 'parent') {
        const replaceWithParent = (list: TreeNode[]): TreeNode[] =>
            list.map((item) => {
                if (item.id === targetId) {
                    return {
                        ...note,
                        children: [item],
                    };
                }
                return { ...item, children: replaceWithParent(item.children) };
            });
        return { nodes: replaceWithParent(draft), newNodeId: note.id };
    }

    const posMap = {
        firstChild: 'firstChild' as const,
        lastChild: 'inside' as const,
        after: 'after' as const,
    };
    const res = insertRelativeToNode(draft, targetId, [note], posMap[position]);
    return { nodes: res.nodes, newNodeId: note.id };
}

export function setAllExpanded(nodes: TreeNode[], expanded: boolean): TreeNode[] {
    return nodes.map((node) => ({
        ...node,
        expanded,
        children: setAllExpanded(node.children, expanded),
    }));
}

export function toggleNodeExpanded(nodes: TreeNode[], nodeId: string): TreeNode[] {
    return nodes.map((node) => {
        if (node.id === nodeId) {
            return { ...node, expanded: !node.expanded };
        }
        if (node.children.length === 0) return node;
        return { ...node, children: toggleNodeExpanded(node.children, nodeId) };
    });
}

export function expandAncestorsOf(nodes: TreeNode[], targetId: string): TreeNode[] {
    const path = findAncestorPath(nodes, targetId);
    if (!path || path.length <= 1) return nodes;
    const ancestorIds = new Set(path.slice(0, -1).map((n) => n.id));
    const walk = (list: TreeNode[]): TreeNode[] =>
        list.map((node) => ({
            ...node,
            expanded: ancestorIds.has(node.id) ? true : node.expanded,
            children: walk(node.children),
        }));
    return walk(nodes);
}

/**
 * Moves single or multiple nodes before/inside/after targetId with cycle protection.
 */
export function moveNodes(
    nodes: TreeNode[],
    sourceIds: string[],
    targetId: string,
    position: DropPosition,
): MoveResult {
    if (sourceIds.length === 0) {
        return { nodes, affectedWindowIds: [], movedOpenTabIds: [] };
    }

    // Keep only top-most selected nodes so children travel with their selected parents
    const rawSet = new Set(sourceIds);
    const filteredSourceIds: string[] = [];
    const collectTopMost = (list: TreeNode[], hasSelectedAncestor: boolean) => {
        for (const item of list) {
            const isSelected = rawSet.has(item.id);
            if (isSelected && !hasSelectedAncestor) {
                filteredSourceIds.push(item.id);
            }
            collectTopMost(item.children, hasSelectedAncestor || isSelected);
        }
    };
    collectTopMost(nodes, false);

    if (filteredSourceIds.length === 0) {
        return { nodes, affectedWindowIds: [], movedOpenTabIds: [] };
    }

    // Prevent dropping onto self or any descendant
    const forbiddenIds = new Set<string>();
    for (const sid of filteredSourceIds) {
        const sNode = findNodeById(nodes, sid);
        if (sNode) {
            for (const descId of collectSubtreeIds(sNode)) {
                forbiddenIds.add(descId);
            }
        }
    }
    if (forbiddenIds.has(targetId)) {
        return { nodes, affectedWindowIds: [], movedOpenTabIds: [] };
    }

    const affectedWindowIds = new Set<string>();
    const movedNodes: TreeNode[] = [];
    let draft = cloneNodes(nodes);

    for (const sid of filteredSourceIds) {
        const prevWin = findParentWindow(draft, sid);
        if (prevWin) affectedWindowIds.add(prevWin.id);
        const res = detachNodeById(draft, sid);
        draft = res.nodes;
        if (res.detached) movedNodes.push(res.detached);
    }

    if (movedNodes.length === 0) {
        return { nodes, affectedWindowIds: [], movedOpenTabIds: [] };
    }

    const inserted = insertRelativeToNode(draft, targetId, movedNodes, position);
    if (!inserted.inserted) {
        return { nodes, affectedWindowIds: [], movedOpenTabIds: [] };
    }
    draft = inserted.nodes;

    const firstMoved = movedNodes[0]!;
    const targetWin = findParentWindow(draft, firstMoved.id);
    if (targetWin) affectedWindowIds.add(targetWin.id);
    const targetGroup = findParentTabGroup(draft, firstMoved.id);

    const movedOpenTabIds: number[] = [];
    for (const m of movedNodes) {
        const tabs = collectSubtreeTabs(m, { onlyOpened: false, stopAtNestedWindow: true });
        for (const t of tabs) {
            if (!t.closed && t.browserTabId !== undefined) {
                movedOpenTabIds.push(t.browserTabId);
            }
            if (targetWin?.browserWindowId !== undefined) {
                t.browserWindowId = targetWin.browserWindowId;
            }
            t.browserGroupId = targetGroup?.browserGroupId ?? -1;
        }
    }

    return {
        nodes: normalizeWindowStatuses(draft),
        affectedWindowIds: [...affectedWindowIds],
        movedOpenTabIds,
        targetBrowserWindowId: targetWin?.browserWindowId,
        targetBrowserGroupId: targetGroup?.browserGroupId,
    };
}

export function cloneWithFreshIdsAndClosed(nodes: TreeNode[]): TreeNode[] {
    return nodes.map((node) => {
        const freshId = createNodeId(node.nodeType);
        const children = cloneWithFreshIdsAndClosed(node.children);
        if (node.nodeType === 'tab') {
            return {
                ...node,
                id: freshId,
                browserTabId: undefined,
                browserWindowId: undefined,
                browserGroupId: undefined,
                closed: true,
                active: false,
                children,
            };
        }
        if (node.nodeType === 'window') {
            return {
                ...node,
                id: freshId,
                browserWindowId: undefined,
                focused: false,
                closed: true,
                children,
            };
        }
        if (node.nodeType === 'tabGroup') {
            return {
                ...node,
                id: freshId,
                browserGroupId: undefined,
                browserWindowId: undefined,
                closed: true,
                children,
            };
        }
        return {
            ...node,
            id: freshId,
            children,
        };
    });
}

export function insertExternalNodes(
    nodes: TreeNode[],
    importedNodes: TreeNode[],
    targetId: string | null,
    position: DropPosition = 'after',
): TreeNode[] {
    const fresh = cloneWithFreshIdsAndClosed(importedNodes);
    const draft = cloneNodes(nodes);
    if (!targetId) {
        return normalizeWindowStatuses([...draft, ...fresh]);
    }
    const res = insertRelativeToNode(draft, targetId, fresh, position);
    return normalizeWindowStatuses(res.inserted ? res.nodes : [...draft, ...fresh]);
}
