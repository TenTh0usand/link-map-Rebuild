import { createNodeId } from '../tree-engine';
import type { CollectionNode, NoteNode, TabNode, TreeNode, WindowNode } from '../types';

export interface TabsOutlinerMarks {
    customTitle?: string;
}

export interface TabsOutlinerRawNode {
    type?: 'savedwin' | 'win' | 'textnote' | 'group' | 'separatorline' | 'tab';
    colapsed?: boolean;
    marks?: TabsOutlinerMarks;
    data?: {
        type?: WindowNode['windowType'];
        note?: string;
        title?: string;
        url?: string;
        pendingUrl?: string;
        favIconUrl?: string;
        pinned?: boolean;
        index?: number;
    };
}

export type TabsOutlinerEntry =
    | [number, TabsOutlinerRawNode, number[]]
    | { type?: number; time?: number; node?: unknown };

export function isTabsOutlinerExport(raw: unknown): raw is TabsOutlinerEntry[] {
    if (!Array.isArray(raw) || raw.length < 3) return false;
    const last = raw[raw.length - 1];
    if (typeof last === 'object' && last !== null && 'type' in last && (last as { type: unknown }).type === 11111) {
        return true;
    }
    return Array.isArray(raw[1]) && typeof raw[1][0] === 'number' && Array.isArray(raw[1][2]);
}

function transformTabsOutlinerNode(rawNode: TabsOutlinerRawNode): TreeNode {
    const expanded = !rawNode.colapsed;
    const alias = rawNode.marks?.customTitle || undefined;
    const data = rawNode.data ?? {};

    switch (rawNode.type) {
        case 'savedwin':
        case 'win': {
            const winType = data.type ?? 'normal';
            const win: WindowNode = {
                id: createNodeId('win'),
                nodeType: 'window',
                title: winType !== 'normal' ? `Window (${winType})` : 'Window',
                alias,
                windowType: winType,
                closed: true,
                expanded,
                saved: rawNode.type === 'savedwin',
                children: [],
            };
            return win;
        }
        case 'textnote': {
            const note: NoteNode = {
                id: createNodeId('note'),
                nodeType: 'note',
                title: data.note || 'Note',
                alias: data.note || undefined,
                expanded,
                children: [],
            };
            return note;
        }
        case 'group': {
            const col: CollectionNode = {
                id: createNodeId('col'),
                nodeType: 'collection',
                title: alias || 'Group',
                alias,
                color: 'blue',
                category: 'general',
                expanded,
                saved: true,
                children: [],
            };
            return col;
        }
        case 'separatorline': {
            const sep: NoteNode = {
                id: createNodeId('note'),
                nodeType: 'note',
                title: '──────────',
                expanded: true,
                children: [],
            };
            return sep;
        }
        default: {
            const tab: TabNode = {
                id: createNodeId('tab'),
                nodeType: 'tab',
                title: data.title || data.url || 'Untitled',
                alias,
                url: data.url || data.pendingUrl || '',
                pendingUrl: data.pendingUrl,
                favIconUrl: data.favIconUrl,
                index: data.index ?? 0,
                pinned: Boolean(data.pinned),
                active: false,
                closed: true,
                expanded,
                children: [],
            };
            return tab;
        }
    }
}

export function parseTabsOutlinerData(entries: TabsOutlinerEntry[]): TreeNode[] {
    const rootChildren: TreeNode[] = [];

    for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length < 3) continue;
        const rawNode = entry[1];
        const keyPath = entry[2];
        if (!rawNode || !Array.isArray(keyPath) || keyPath.length === 0) continue;

        const converted = transformTabsOutlinerNode(rawNode);

        let container = rootChildren;
        for (let depth = 0; depth < keyPath.length - 1; depth++) {
            const idx = keyPath[depth];
            const parent = idx !== undefined ? container[idx] : undefined;
            if (!parent) {
                container = [];
                break;
            }
            container = parent.children;
        }

        const leafIdx = keyPath[keyPath.length - 1];
        if (leafIdx === undefined) continue;
        if (container.length >= leafIdx) {
            container[leafIdx] = converted;
        } else {
            container.push(converted);
        }
    }

    // Compact any sparse holes if malformed paths existed
    const compact = (list: TreeNode[]): TreeNode[] =>
        list.filter(Boolean).map((n) => ({ ...n, children: compact(n.children) }));

    return compact(rootChildren);
}
