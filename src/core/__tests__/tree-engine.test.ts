import { describe, expect, it } from 'vitest';

import {
    closeNodes,
    createNoteNode,
    createTabGroupNodeFromLive,
    createTabNodeFromLive,
    createWindowNodeFromLive,
    deleteNodes,
    findNodeByBrowserTabId,
    findNodeById,
    insertLiveTab,
    moveNodes,
    reconcileSnapshotWithLive,
    removeLiveTab,
} from '../tree-engine';
import type { LiveTabDTO, LiveTabGroupDTO, LiveWindowDTO, TreeNode } from '../types';

function makeLiveTab(
    id: number,
    windowId: number,
    index: number,
    overrides: Partial<LiveTabDTO> = {},
): LiveTabDTO {
    return {
        id,
        windowId,
        groupId: -1,
        index,
        title: `Tab ${id}`,
        url: `https://example.com/${id}`,
        active: false,
        pinned: false,
        ...overrides,
    };
}

function makeLiveWin(id: number, tabs: LiveTabDTO[]): LiveWindowDTO {
    return {
        id,
        type: 'normal',
        incognito: false,
        focused: true,
        tabs,
    };
}

describe('tree-engine', () => {
    it('nests new tab under openerTabId and places siblings flat', () => {
        const win = createWindowNodeFromLive(makeLiveWin(1, []));
        const tab10 = createTabNodeFromLive(makeLiveTab(10, 1, 0, { active: true }));
        win.children.push(tab10);

        let tree: TreeNode[] = [win];
        tree = insertLiveTab(tree, makeLiveTab(11, 1, 1, { openerTabId: 10 }), {
            createNewTabByLevel: false,
            newTabUrl: 'chrome://newtab/',
            syncNativeTabGroups: true,
        });
        tree = insertLiveTab(tree, makeLiveTab(12, 1, 2), {
            createNewTabByLevel: false,
            newTabUrl: 'chrome://newtab/',
            syncNativeTabGroups: true,
        });

        const winChildren = tree[0]!.children;
        expect(winChildren).toHaveLength(2);
        expect(winChildren[0]!.id).toBe(tab10.id);
        expect(winChildren[0]!.children).toHaveLength(1);
        expect((winChildren[0]!.children[0] as { browserTabId?: number }).browserTabId).toBe(11);
        expect((winChildren[1] as { browserTabId?: number }).browserTabId).toBe(12);
    });

    it('places blank new tab as child when createNewTabByLevel is enabled', () => {
        const win = createWindowNodeFromLive(makeLiveWin(1, []));
        const tab10 = createTabNodeFromLive(makeLiveTab(10, 1, 0));
        win.children.push(tab10);

        const tree = insertLiveTab(
            [win],
            makeLiveTab(11, 1, 1, {
                openerTabId: 10,
                url: 'chrome://newtab/',
                pendingUrl: 'chrome://newtab/',
            }),
            {
                createNewTabByLevel: true,
                newTabUrl: 'chrome://newtab/',
                syncNativeTabGroups: true,
            },
        );

        expect(tree[0]!.children[0]!.children).toHaveLength(1);
    });

    it('assigns new tab into matching Chrome TabGroupNode when syncNativeTabGroups is enabled', () => {
        const win = createWindowNodeFromLive(makeLiveWin(1, []));
        const groupInfo: LiveTabGroupDTO = {
            id: 77,
            windowId: 1,
            title: 'Research',
            color: 'blue',
            collapsed: false,
        };
        const grpNode = createTabGroupNodeFromLive(groupInfo);
        win.children.push(grpNode);

        const tree = insertLiveTab([win], makeLiveTab(20, 1, 0, { groupId: 77 }), {
            createNewTabByLevel: false,
            newTabUrl: 'chrome://newtab/',
            syncNativeTabGroups: true,
            groupInfo,
        });

        expect(tree[0]!.children[0]!.nodeType).toBe('tabGroup');
        expect(tree[0]!.children[0]!.children).toHaveLength(1);
        expect(findNodeByBrowserTabId(tree, 20)?.browserGroupId).toBe(77);
    });

    it('protects aliased or saved tabs on browser removeLiveTab', () => {
        const win = createWindowNodeFromLive(makeLiveWin(1, []));
        const normalTab = createTabNodeFromLive(makeLiveTab(10, 1, 0));
        const aliasedTab = createTabNodeFromLive(makeLiveTab(11, 1, 1));
        aliasedTab.alias = 'Keep Me';
        const savedTab = createTabNodeFromLive(makeLiveTab(12, 1, 2));
        savedTab.saved = true;
        win.children.push(normalTab, aliasedTab, savedTab);

        let tree: TreeNode[] = [win];
        tree = removeLiveTab(tree, 10);
        tree = removeLiveTab(tree, 11);
        tree = removeLiveTab(tree, 12);

        expect(findNodeByBrowserTabId(tree, 10)).toBeNull();
        const keptAlias = findNodeByBrowserTabId(tree, 11);
        const keptSaved = findNodeByBrowserTabId(tree, 12);
        expect(keptAlias?.closed).toBe(true);
        expect(keptSaved?.closed).toBe(true);
    });

    it('closes item only when expanded and closes subtree when collapsed in auto mode', () => {
        const win = createWindowNodeFromLive(makeLiveWin(1, []));
        const parent = createTabNodeFromLive(makeLiveTab(10, 1, 0));
        const child = createTabNodeFromLive(makeLiveTab(11, 1, 1));
        parent.children.push(child);
        win.children.push(parent);

        // Expanded parent -> close item only
        parent.expanded = true;
        const expandedRes = closeNodes([win], [parent.id], 'auto');
        expect(expandedRes.tabIdsToClose).toEqual([10]);
        expect(findNodeById(expandedRes.nodes, parent.id)?.closed).toBe(true);
        expect(findNodeById(expandedRes.nodes, child.id)?.closed).toBe(false);

        // Collapsed parent -> close entire subtree
        parent.expanded = false;
        const collapsedRes = closeNodes([win], [parent.id], 'auto');
        expect(collapsedRes.tabIdsToClose).toEqual([10, 11]);
        expect(findNodeById(collapsedRes.nodes, child.id)?.closed).toBe(true);
    });

    it('lifts children when deleting expanded single item and removes subtree when collapsed', () => {
        const win = createWindowNodeFromLive(makeLiveWin(1, []));
        const parent = createTabNodeFromLive(makeLiveTab(10, 1, 0));
        const child = createTabNodeFromLive(makeLiveTab(11, 1, 1));
        parent.children.push(child);
        win.children.push(parent);

        parent.expanded = true;
        const liftedRes = deleteNodes([win], [parent.id], 'auto');
        expect(liftedRes.tabIdsToClose).toEqual([10]);
        expect(liftedRes.nodes[0]!.children).toHaveLength(1);
        expect(liftedRes.nodes[0]!.children[0]!.id).toBe(child.id);

        parent.expanded = false;
        const fullRes = deleteNodes([win], [parent.id], 'auto');
        expect(fullRes.tabIdsToClose).toEqual([10, 11]);
        expect(fullRes.nodes[0]!.children).toHaveLength(0);
    });

    it('handles multi-node moveNodes and prevents cyclic self/descendant drops', () => {
        const win = createWindowNodeFromLive(makeLiveWin(1, []));
        const n1 = createTabNodeFromLive(makeLiveTab(10, 1, 0));
        const n1Child = createTabNodeFromLive(makeLiveTab(11, 1, 1));
        n1.children.push(n1Child);
        const n2 = createTabNodeFromLive(makeLiveTab(12, 1, 2));
        const note = createNoteNode('Target Note');
        win.children.push(n1, n2, note);

        // Cyclic drop onto own child must be ignored
        const cyclic = moveNodes([win], [n1.id], n1Child.id, 'inside');
        expect(cyclic.nodes[0]!.children).toHaveLength(3);

        // Move both n1 and n2 inside note (n1Child travels with n1 without duplication)
        const moved = moveNodes([win], [n1.id, n1Child.id, n2.id], note.id, 'inside');
        expect(moved.nodes[0]!.children).toHaveLength(1);
        expect(moved.nodes[0]!.children[0]!.id).toBe(note.id);
        expect(moved.nodes[0]!.children[0]!.children.map((c) => c.id)).toEqual([n1.id, n2.id]);
        expect(moved.movedOpenTabIds).toEqual([10, 11, 12]);
    });

    it('reconciles snapshot with live windows and groups while preserving closed notes & tabs', () => {
        const oldWin = createWindowNodeFromLive(makeLiveWin(1, []));
        const savedClosed = createTabNodeFromLive(makeLiveTab(999, 1, 0));
        savedClosed.closed = true;
        savedClosed.alias = 'Saved Article';
        const note = createNoteNode('Reading Notes');
        const reopeningTab = createTabNodeFromLive(makeLiveTab(50, 1, 0));
        reopeningTab.closed = true;
        note.children.push(reopeningTab);
        oldWin.children.push(savedClosed, note);

        const liveGroups: LiveTabGroupDTO[] = [
            { id: 88, windowId: 1, title: 'Docs', color: 'green', collapsed: false },
        ];
        const liveWindows: LiveWindowDTO[] = [
            makeLiveWin(1, [
                makeLiveTab(50, 1, 0, { title: 'Updated Live Title', active: true }),
                makeLiveTab(51, 1, 1, { groupId: 88 }),
            ]),
        ];

        const reconciled = reconcileSnapshotWithLive([oldWin], liveWindows, liveGroups, {
            syncNativeTabGroups: true,
        });

        expect(reconciled).toHaveLength(1);
        expect(reconciled[0]!.closed).toBe(false);
        expect(findNodeById(reconciled, savedClosed.id)?.closed).toBe(true);
        expect(findNodeByBrowserTabId(reconciled, 50)?.closed).toBe(false);
        expect(findNodeByBrowserTabId(reconciled, 50)?.title).toBe('Updated Live Title');
        expect(findNodeByBrowserTabId(reconciled, 51)?.browserGroupId).toBe(88);
    });
});
