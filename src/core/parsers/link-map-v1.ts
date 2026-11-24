import { createNodeId } from '../tree-engine';
import type { CollectionNode, NoteNode, TabNode, TreeNode, WindowNode } from '../types';

export interface LegacyV1Node {
    key?: string;
    title?: string;
    expanded?: boolean;
    children?: LegacyV1Node[];
    data?: {
        id?: number;
        windowId?: number;
        nodeType?: 'tab' | 'window' | 'note';
        alias?: string;
        closed?: boolean;
        save?: boolean;
        url?: string;
        pendingUrl?: string;
        favIconUrl?: string;
        index?: number;
        pinned?: boolean;
        type?: WindowNode['windowType'];
        incognito?: boolean;
        left?: number;
        top?: number;
        width?: number;
        height?: number;
    };
}

export interface LegacyV1Export {
    rawData: LegacyV1Node[];
    version?: string;
    exportTime?: string;
}

export interface ParsedLinkMapData {
    nodes: TreeNode[];
    collections: CollectionNode[];
    exportTime?: string;
}

const ENTITY_MAP: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
};

export function unescapeHtmlEntities(input?: string): string {
    if (!input) return '';
    return input.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (m) => ENTITY_MAP[m] ?? m);
}

export function isLinkMapV1Export(raw: unknown): raw is LegacyV1Export {
    return (
        typeof raw === 'object' &&
        raw !== null &&
        'rawData' in raw &&
        Array.isArray((raw as LegacyV1Export).rawData)
    );
}

export function isLinkMapV2Export(
    raw: unknown,
): raw is { schemaVersion: 2; nodes: TreeNode[]; collections?: CollectionNode[]; exportedAt?: string } {
    return (
        typeof raw === 'object' &&
        raw !== null &&
        (raw as { schemaVersion?: unknown }).schemaVersion === 2 &&
        Array.isArray((raw as { nodes?: unknown }).nodes)
    );
}

function convertLegacyNode(legacy: LegacyV1Node): TreeNode {
    const data = legacy.data ?? {};
    const children = Array.isArray(legacy.children) ? legacy.children.map(convertLegacyNode) : [];
    const title = unescapeHtmlEntities(legacy.title);
    const alias = data.alias ? unescapeHtmlEntities(data.alias) : undefined;
    const expanded = legacy.expanded ?? true;

    if (data.nodeType === 'window') {
        const winNode: WindowNode = {
            id: createNodeId('win'),
            nodeType: 'window',
            title: title || 'Window',
            alias,
            expanded,
            saved: Boolean(data.save),
            closed: true,
            windowType: data.type ?? 'normal',
            incognito: data.incognito,
            left: data.left,
            top: data.top,
            width: data.width,
            height: data.height,
            children,
        };
        return winNode;
    }

    if (data.nodeType === 'note') {
        const noteNode: NoteNode = {
            id: createNodeId('note'),
            nodeType: 'note',
            title: alias || title || 'Note',
            alias,
            expanded,
            saved: Boolean(data.save),
            children,
        };
        return noteNode;
    }

    const tabNode: TabNode = {
        id: createNodeId('tab'),
        nodeType: 'tab',
        title: title || data.url || data.pendingUrl || 'Untitled',
        alias,
        url: data.url || data.pendingUrl || '',
        pendingUrl: data.pendingUrl,
        favIconUrl: data.favIconUrl,
        index: data.index ?? 0,
        pinned: Boolean(data.pinned),
        active: false,
        closed: true,
        saved: Boolean(data.save),
        expanded,
        children,
    };
    return tabNode;
}

function normalizeV2Node(raw: TreeNode): TreeNode {
    const children = Array.isArray(raw.children) ? raw.children.map(normalizeV2Node) : [];
    const id = createNodeId(raw.nodeType || 'n');
    if (raw.nodeType === 'tab') {
        return {
            ...raw,
            id,
            browserTabId: undefined,
            browserWindowId: undefined,
            browserGroupId: undefined,
            closed: true,
            active: false,
            children,
        };
    }
    if (raw.nodeType === 'window' || raw.nodeType === 'tabGroup') {
        return {
            ...raw,
            id,
            browserWindowId: undefined,
            closed: true,
            children,
        };
    }
    return {
        ...raw,
        id,
        children,
    };
}

export function parseLinkMapJson(raw: unknown): ParsedLinkMapData {
    if (isLinkMapV2Export(raw)) {
        return {
            nodes: raw.nodes.map(normalizeV2Node),
            collections: (raw.collections ?? []).map((c) => normalizeV2Node(c) as CollectionNode),
            exportTime: raw.exportedAt,
        };
    }

    if (isLinkMapV1Export(raw)) {
        return {
            nodes: raw.rawData.map(convertLegacyNode),
            collections: [],
            exportTime: raw.exportTime,
        };
    }

    throw new Error('Unrecognized Link Map JSON format');
}
