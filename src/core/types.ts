export type TreeNodeType = 'window' | 'tabGroup' | 'tab' | 'note' | 'collection';

export type TabGroupColor =
    | 'grey'
    | 'blue'
    | 'red'
    | 'yellow'
    | 'green'
    | 'pink'
    | 'purple'
    | 'cyan'
    | 'orange';

export type CollectionCategory = 'workspace' | 'readlist' | 'repo' | 'media' | 'general';

export type DropPosition = 'before' | 'inside' | 'after';

export interface BaseTreeNode {
    id: string;
    nodeType: TreeNodeType;
    title: string;
    alias?: string;
    expanded: boolean;
    saved?: boolean;
    closed?: boolean;
    children: TreeNode[];
    createdAt?: number;
    updatedAt?: number;
}

export interface WindowNode extends BaseTreeNode {
    nodeType: 'window';
    browserWindowId?: number;
    windowType?: 'normal' | 'popup' | 'panel' | 'app' | 'devtools';
    incognito?: boolean;
    focused?: boolean;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    closed: boolean;
}

export interface TabGroupNode extends BaseTreeNode {
    nodeType: 'tabGroup';
    browserGroupId?: number;
    browserWindowId?: number;
    color: TabGroupColor;
    collapsed?: boolean;
    closed: boolean;
}

export interface TabNode extends BaseTreeNode {
    nodeType: 'tab';
    url: string;
    pendingUrl?: string;
    favIconUrl?: string;
    browserTabId?: number;
    browserWindowId?: number;
    browserGroupId?: number;
    openerTabId?: number;
    index: number;
    pinned?: boolean;
    active: boolean;
    closed: boolean;
    categoryHint?: CollectionCategory;
    description?: string;
    tags?: string[];
}

export interface NoteNode extends BaseTreeNode {
    nodeType: 'note';
}

export interface CollectionNode extends BaseTreeNode {
    nodeType: 'collection';
    color: TabGroupColor;
    category: CollectionCategory;
}

export type TreeNode = WindowNode | TabGroupNode | TabNode | NoteNode | CollectionNode;

export interface MatchRange {
    start: number;
    end: number;
}

export interface FlatVisibleNode {
    node: TreeNode;
    depth: number;
    parentId: string | null;
    ancestorIds: string[];
    hasChildren: boolean;
    matchRanges?: {
        title?: MatchRange[];
        alias?: MatchRange[];
    };
}

export type ThemeSetting = 'dark' | 'light' | 'auto';
export type OpenMode = 'sidepanel' | 'window';

export interface AppSettings {
    theme: ThemeSetting;
    offlineOnlyMode: boolean;
    openMode: OpenMode;
    autoScrollToActiveTab: boolean;
    createNewTabByLevel: boolean;
    syncNativeTabGroups: boolean;
    compactMode: boolean;
    showSiteDescriptions: boolean;
    shareBaseUrl: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
    theme: 'dark',
    offlineOnlyMode: true,
    openMode: 'sidepanel',
    autoScrollToActiveTab: false,
    createNewTabByLevel: false,
    syncNativeTabGroups: true,
    compactMode: false,
    showSiteDescriptions: true,
    shareBaseUrl: '',
};

export type ShareCardTheme = 'dark' | 'light' | 'aurora' | 'minimal';

export interface ShareItem {
    title: string;
    url: string;
    description?: string;
    category?: CollectionCategory;
}

export interface ShareBundle {
    title: string;
    description?: string;
    color?: TabGroupColor;
    items: ShareItem[];
}

export interface SiteMetaRecord {
    url: string;
    description: string;
    category?: CollectionCategory;
    source: 'manual' | 'ai';
    updatedAt: number;
}

export interface LinkMapExportV2 {
    schemaVersion: 2;
    version: string;
    exportedAt: string;
    nodes: TreeNode[];
    collections: CollectionNode[];
}

export interface LiveTabDTO {
    id: number;
    windowId: number;
    groupId: number;
    index: number;
    title: string;
    url: string;
    pendingUrl?: string;
    favIconUrl?: string;
    active: boolean;
    pinned: boolean;
    openerTabId?: number;
}

export interface LiveTabGroupDTO {
    id: number;
    windowId: number;
    title: string;
    color: TabGroupColor;
    collapsed: boolean;
}

export interface LiveWindowDTO {
    id: number;
    type: 'normal' | 'popup' | 'panel' | 'app' | 'devtools';
    incognito: boolean;
    focused: boolean;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    tabs: LiveTabDTO[];
}

export const TAB_GROUP_COLOR_HEX: Record<TabGroupColor, string> = {
    grey: '#8e9297',
    blue: '#4c8bf5',
    red: '#e5534b',
    yellow: '#e3b341',
    green: '#2da44e',
    pink: '#db61a2',
    purple: '#a371f7',
    cyan: '#39c5cf',
    orange: '#f0883e',
};
