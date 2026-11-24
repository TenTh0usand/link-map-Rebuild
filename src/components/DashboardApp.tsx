import React, { useEffect, useMemo, useState } from 'react';
import {
    App as AntdApp,
    Button,
    ConfigProvider,
    Empty,
    Input,
    Modal,
    Select,
    Spin,
    Switch,
    Tag,
    Tooltip,
    theme as antdTheme,
} from 'antd';
import {
    BookOpen,
    Code2,
    Copy,
    ExternalLink,
    Film,
    Globe,
    Layers,
    Monitor,
    Pencil,
    Plus,
    QrCode,
    Search,
    Settings,
    Share2,
    ShieldCheck,
    Sparkles,
} from 'lucide-react';

import { extractHostname, inferUrlCategory, normalizeSiteUrl } from '../core/categorizer';
import { exportNodesToMarkdown } from '../core/exporter';
import { collectSubtreeTabs, findNodeById } from '../core/tree-engine';
import {
    TAB_GROUP_COLOR_HEX,
    type CollectionCategory,
    type TabGroupColor,
    type TabGroupNode,
    type TabNode,
    type TreeNode,
    type WindowNode,
} from '../core/types';
import { getFaviconUrl, openTabsAsChromeGroup } from '../services/browser-bridge';
import { t } from '../services/i18n';
import { useWorkspaceStore } from '../store/workspace-store';
import { AiAssistantModal } from './AiAssistantModal';
import { SettingsModal } from './SettingsModal';
import { ShareModal } from './ShareModal';

import '../styles/workspace.css';

type FilterScope =
    | { kind: 'all' }
    | { kind: 'category'; category: CollectionCategory }
    | { kind: 'node'; nodeId: string };

const CATEGORY_META: Record<
    CollectionCategory,
    { labelKey: string; fallback: string; icon: React.ReactNode }
> = {
    workspace: { labelKey: 'catWorkspace', fallback: 'Workspace', icon: <Monitor size={13} /> },
    readlist: { labelKey: 'catReadlist', fallback: 'Readlist', icon: <BookOpen size={13} /> },
    repo: { labelKey: 'catRepo', fallback: 'Repos', icon: <Code2 size={13} /> },
    media: { labelKey: 'catMedia', fallback: 'Media', icon: <Film size={13} /> },
    general: { labelKey: 'catGeneral', fallback: 'General', icon: <Globe size={13} /> },
};

function collectAllTabGroups(nodes: TreeNode[]): TabGroupNode[] {
    const out: TabGroupNode[] = [];
    const walk = (list: TreeNode[]) => {
        for (const n of list) {
            if (n.nodeType === 'tabGroup') out.push(n);
            walk(n.children);
        }
    };
    walk(nodes);
    return out;
}

function parseGroupHash(): string | null {
    const h = window.location.hash;
    if (!h.startsWith('#group=')) return null;
    return decodeURIComponent(h.slice('#group='.length));
}

const DashboardInner: React.FC = () => {
    const { message } = AntdApp.useApp();
    const init = useWorkspaceStore((s) => s.init);
    const initialized = useWorkspaceStore((s) => s.initialized);
    const nodes = useWorkspaceStore((s) => s.nodes);
    const collections = useWorkspaceStore((s) => s.collections);
    const settings = useWorkspaceStore((s) => s.settings);
    const siteMetaMap = useWorkspaceStore((s) => s.siteMetaMap);
    const aiConfig = useWorkspaceStore((s) => s.aiConfig);
    const aiBusy = useWorkspaceStore((s) => s.aiBusy);
    const updateSettings = useWorkspaceStore((s) => s.updateSettings);
    const saveSiteDescription = useWorkspaceStore((s) => s.saveSiteDescription);
    const openOrActivateNode = useWorkspaceStore((s) => s.openOrActivateNode);
    const setShareModalTarget = useWorkspaceStore((s) => s.setShareModalTarget);
    const setSettingsModalOpen = useWorkspaceStore((s) => s.setSettingsModalOpen);
    const setAiModalOpen = useWorkspaceStore((s) => s.setAiModalOpen);
    const runAiSiteDescriptions = useWorkspaceStore((s) => s.runAiSiteDescriptions);
    const createCollection = useWorkspaceStore((s) => s.createCollection);

    const [scope, setScope] = useState<FilterScope>(() => {
        const gid = parseGroupHash();
        return gid ? { kind: 'node', nodeId: gid } : { kind: 'all' };
    });
    const [query, setQuery] = useState('');
    const [editTarget, setEditTarget] = useState<{
        tab: TabNode;
        desc: string;
        category: CollectionCategory;
    } | null>(null);
    const [newColOpen, setNewColOpen] = useState(false);
    const [newColName, setNewColName] = useState('');
    const [newColCat, setNewColCat] = useState<CollectionCategory>('readlist');
    const [newColColor, setNewColColor] = useState<TabGroupColor>('blue');

    useEffect(() => {
        let cleanup: (() => void) | undefined;
        void init().then((fn) => {
            cleanup = fn;
        });
        const onHash = () => {
            const gid = parseGroupHash();
            if (gid) setScope({ kind: 'node', nodeId: gid });
        };
        window.addEventListener('hashchange', onHash);
        return () => {
            cleanup?.();
            window.removeEventListener('hashchange', onHash);
        };
    }, [init]);

    const nativeGroups = useMemo(() => collectAllTabGroups(nodes), [nodes]);
    const topWindows = useMemo(
        () => nodes.filter((n): n is WindowNode => n.nodeType === 'window'),
        [nodes],
    );

    const allDedupedTabs = useMemo(() => {
        const seen = new Set<string>();
        const tabs: TabNode[] = [
            ...nodes.flatMap((n) => collectSubtreeTabs(n)),
            ...collections.flatMap((c) => collectSubtreeTabs(c)),
        ];
        const out: TabNode[] = [];
        for (const tab of tabs) {
            const url = tab.url || tab.pendingUrl;
            if (!url || seen.has(url)) continue;
            seen.add(url);
            out.push(tab);
        }
        return out;
    }, [nodes, collections]);

    const getEffectiveCategory = (tab: TabNode): CollectionCategory => {
        const meta = siteMetaMap[normalizeSiteUrl(tab.url || tab.pendingUrl || '')];
        return meta?.category ?? tab.categoryHint ?? inferUrlCategory(tab.url || '', tab.title);
    };

    const getEffectiveDescription = (tab: TabNode): string => {
        const meta = siteMetaMap[normalizeSiteUrl(tab.url || tab.pendingUrl || '')];
        return meta?.description || tab.description || '';
    };

    const categoryCounts = useMemo(() => {
        const counts: Record<CollectionCategory, number> = {
            workspace: 0,
            readlist: 0,
            repo: 0,
            media: 0,
            general: 0,
        };
        for (const tab of allDedupedTabs) {
            counts[getEffectiveCategory(tab)]++;
        }
        return counts;
    }, [allDedupedTabs, siteMetaMap]);

    const activeScopeNode = useMemo(() => {
        if (scope.kind !== 'node') return null;
        return findNodeById(nodes, scope.nodeId) ?? findNodeById(collections, scope.nodeId);
    }, [scope, nodes, collections]);

    const scopedTitle = useMemo(() => {
        if (scope.kind === 'all') return t('allItems', 'All Sites');
        if (scope.kind === 'category') {
            const m = CATEGORY_META[scope.category];
            return t(m.labelKey, m.fallback);
        }
        return activeScopeNode?.alias || activeScopeNode?.title || 'Group';
    }, [scope, activeScopeNode]);

    const visibleTabs = useMemo(() => {
        let baseTabs: TabNode[];
        if (scope.kind === 'all') {
            baseTabs = allDedupedTabs;
        } else if (scope.kind === 'category') {
            baseTabs = allDedupedTabs.filter((tab) => getEffectiveCategory(tab) === scope.category);
        } else {
            baseTabs = activeScopeNode ? collectSubtreeTabs(activeScopeNode) : [];
        }

        const q = query.trim().toLowerCase();
        if (!q) return baseTabs;
        return baseTabs.filter((tab) => {
            const desc = getEffectiveDescription(tab).toLowerCase();
            return (
                tab.title.toLowerCase().includes(q) ||
                (tab.alias ?? '').toLowerCase().includes(q) ||
                tab.url.toLowerCase().includes(q) ||
                desc.includes(q)
            );
        });
    }, [scope, allDedupedTabs, activeScopeNode, query, siteMetaMap]);

    if (!initialized) {
        return (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Spin size="large" />
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', height: '100%', backgroundColor: 'var(--lm-bg)' }}>
            {/* Sidebar Navigation */}
            <aside
                className="lm-scroll"
                style={{
                    width: 240,
                    flexShrink: 0,
                    borderRight: '1px solid var(--lm-border)',
                    backgroundColor: 'var(--lm-bg-elevated)',
                    padding: '14px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px' }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>Link Map</span>
                    <Tag color={settings.offlineOnlyMode ? 'green' : 'default'} style={{ margin: 0, fontSize: 10 }}>
                        <ShieldCheck size={10} style={{ verticalAlign: '-1px', marginRight: 3 }} />
                        {settings.offlineOnlyMode ? t('offlineModeBadge') : 'Online'}
                    </Tag>
                </div>

                <div>
                    <button
                        type="button"
                        className={`lm-tree-row ${scope.kind === 'all' ? 'is-selected' : ''}`}
                        style={{
                            border: 'none',
                            background: scope.kind === 'all' ? 'var(--lm-primary-soft)' : 'transparent',
                            color: 'var(--lm-text)',
                            padding: '6px 10px',
                            justifyContent: 'space-between',
                            cursor: 'pointer',
                        }}
                        onClick={() => setScope({ kind: 'all' })}
                    >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 500 }}>
                            <Layers size={13} />
                            {t('allItems')}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--lm-text-muted)' }}>
                            {allDedupedTabs.length}
                        </span>
                    </button>
                </div>

                <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--lm-text-muted)', padding: '0 8px 6px' }}>
                        CATEGORIES
                    </div>
                    {(Object.keys(CATEGORY_META) as CollectionCategory[]).map((cat) => {
                        const meta = CATEGORY_META[cat];
                        const active = scope.kind === 'category' && scope.category === cat;
                        return (
                            <button
                                key={cat}
                                type="button"
                                className="lm-tree-row"
                                style={{
                                    border: 'none',
                                    background: active ? 'var(--lm-primary-soft)' : 'transparent',
                                    color: 'var(--lm-text)',
                                    padding: '6px 10px',
                                    justifyContent: 'space-between',
                                    cursor: 'pointer',
                                }}
                                onClick={() => setScope({ kind: 'category', category: cat })}
                            >
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                                    {meta.icon}
                                    {t(meta.labelKey, meta.fallback)}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--lm-text-muted)' }}>
                                    {categoryCounts[cat]}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0 8px 6px',
                        }}
                    >
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--lm-text-muted)' }}>
                            CUSTOM GROUPS ({collections.length})
                        </span>
                        <button
                            type="button"
                            className="lm-icon-btn"
                            style={{ width: 20, height: 20 }}
                            onClick={() => setNewColOpen(true)}
                        >
                            <Plus size={12} />
                        </button>
                    </div>
                    {collections.map((col) => {
                        const active = scope.kind === 'node' && scope.nodeId === col.id;
                        return (
                            <button
                                key={col.id}
                                type="button"
                                className="lm-tree-row"
                                style={{
                                    border: 'none',
                                    background: active ? 'var(--lm-primary-soft)' : 'transparent',
                                    color: 'var(--lm-text)',
                                    padding: '6px 10px',
                                    justifyContent: 'space-between',
                                    cursor: 'pointer',
                                }}
                                onClick={() => setScope({ kind: 'node', nodeId: col.id })}
                            >
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                                    <span
                                        className="lm-group-dot"
                                        style={{ margin: 0, backgroundColor: TAB_GROUP_COLOR_HEX[col.color] }}
                                    />
                                    <span className="lm-row-label">{col.title}</span>
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--lm-text-muted)' }}>
                                    {collectSubtreeTabs(col).length}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {nativeGroups.length > 0 && (
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--lm-text-muted)', padding: '0 8px 6px' }}>
                            CHROME GROUPS ({nativeGroups.length})
                        </div>
                        {nativeGroups.map((grp) => {
                            const active = scope.kind === 'node' && scope.nodeId === grp.id;
                            return (
                                <button
                                    key={grp.id}
                                    type="button"
                                    className="lm-tree-row"
                                    style={{
                                        border: 'none',
                                        background: active ? 'var(--lm-primary-soft)' : 'transparent',
                                        color: 'var(--lm-text)',
                                        padding: '6px 10px',
                                        justifyContent: 'space-between',
                                        cursor: 'pointer',
                                    }}
                                    onClick={() => setScope({ kind: 'node', nodeId: grp.id })}
                                >
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                                        <span
                                            className="lm-group-dot"
                                            style={{ margin: 0, backgroundColor: TAB_GROUP_COLOR_HEX[grp.color] }}
                                        />
                                        <span className="lm-row-label">{grp.title || 'Tab Group'}</span>
                                    </span>
                                    <span style={{ fontSize: 11, color: 'var(--lm-text-muted)' }}>
                                        {collectSubtreeTabs(grp).length}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}

                <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--lm-text-muted)', padding: '0 8px 6px' }}>
                        WINDOWS ({topWindows.length})
                    </div>
                    {topWindows.map((win) => {
                        const active = scope.kind === 'node' && scope.nodeId === win.id;
                        return (
                            <button
                                key={win.id}
                                type="button"
                                className="lm-tree-row"
                                style={{
                                    border: 'none',
                                    background: active ? 'var(--lm-primary-soft)' : 'transparent',
                                    color: 'var(--lm-text)',
                                    padding: '6px 10px',
                                    justifyContent: 'space-between',
                                    cursor: 'pointer',
                                }}
                                onClick={() => setScope({ kind: 'node', nodeId: win.id })}
                            >
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                                    <img src="/icons/chrome_icon.svg" alt="" style={{ width: 13, height: 13 }} />
                                    <span className="lm-row-label">{win.alias || win.title}</span>
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--lm-text-muted)' }}>
                                    {collectSubtreeTabs(win).length}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </aside>

            {/* Main Navigation Card Grid */}
            <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '12px 20px',
                        borderBottom: '1px solid var(--lm-border)',
                        flexWrap: 'wrap',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{scopedTitle}</h2>
                        <Tag style={{ margin: 0 }}>{visibleTabs.length}</Tag>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <Input
                            size="small"
                            allowClear
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            prefix={<Search size={13} style={{ color: 'var(--lm-text-muted)' }} />}
                            placeholder={t('search')}
                            style={{ width: 220 }}
                        />

                        <Tooltip title={t('showSiteDescriptionsDesc')}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                <Sparkles size={13} style={{ color: 'var(--lm-primary)' }} />
                                {t('showSiteDescriptions')}
                                <Switch
                                    size="small"
                                    checked={settings.showSiteDescriptions}
                                    onChange={(checked) =>
                                        void updateSettings({ showSiteDescriptions: checked })
                                    }
                                />
                            </span>
                        </Tooltip>

                        {!settings.offlineOnlyMode && (
                            <Button
                                size="small"
                                icon={<Sparkles size={13} />}
                                loading={aiBusy}
                                disabled={visibleTabs.length === 0}
                                onClick={() => {
                                    if (!aiConfig.enabled) {
                                        setSettingsModalOpen(true, 'ai');
                                        return;
                                    }
                                    void runAiSiteDescriptions(visibleTabs)
                                        .then((res) => {
                                            void message.success(
                                                `AI generated ${res.updatedCount} descriptions (skipped ${res.skippedCachedCount} cached)`,
                                                1.8,
                                            );
                                        })
                                        .catch((err) => {
                                            void message.error(
                                                err instanceof Error ? err.message : String(err),
                                            );
                                        });
                                }}
                            >
                                {t('dashboardAiGuideBtn')}
                            </Button>
                        )}

                        {!settings.offlineOnlyMode && (
                            <Button
                                size="small"
                                onClick={() => {
                                    if (!aiConfig.enabled) {
                                        setSettingsModalOpen(true, 'ai');
                                    } else {
                                        setAiModalOpen(true, 'digest');
                                    }
                                }}
                            >
                                {t('openAiAssistant')}
                            </Button>
                        )}

                        <Button
                            size="small"
                            icon={<ExternalLink size={13} />}
                            disabled={visibleTabs.length === 0}
                            onClick={() =>
                                void openTabsAsChromeGroup(visibleTabs, {
                                    title: scopedTitle,
                                    color: 'blue',
                                })
                            }
                        >
                            {t('openAllTabs')}
                        </Button>

                        <Button
                            size="small"
                            type="primary"
                            icon={<Share2 size={13} />}
                            disabled={visibleTabs.length === 0}
                            onClick={() =>
                                setShareModalTarget({
                                    mode: 'group',
                                    title: scopedTitle,
                                    nodes: visibleTabs,
                                })
                            }
                        >
                            {t('share')}
                        </Button>

                        <Button
                            size="small"
                            icon={<Copy size={13} />}
                            disabled={visibleTabs.length === 0}
                            onClick={() => {
                                void navigator.clipboard.writeText(exportNodesToMarkdown(visibleTabs));
                                void message.success('Markdown copied', 1);
                            }}
                        >
                            Markdown
                        </Button>

                        <Button
                            size="small"
                            icon={<Settings size={13} />}
                            onClick={() => setSettingsModalOpen(true, 'general')}
                        />
                    </div>
                </div>

                <div className="lm-scroll" style={{ flex: 1, padding: 20 }}>
                    {visibleTabs.length === 0 ? (
                        <Empty description="No websites in this view" style={{ marginTop: 60 }} />
                    ) : (
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(265px, 1fr))',
                                gap: 12,
                            }}
                        >
                            {visibleTabs.map((tab) => {
                                const url = tab.url || tab.pendingUrl || '';
                                const host = extractHostname(url) || 'link';
                                const cat = getEffectiveCategory(tab);
                                const metaRecord = siteMetaMap[normalizeSiteUrl(url)];
                                const desc = getEffectiveDescription(tab);
                                const catMeta = CATEGORY_META[cat];

                                return (
                                    <div
                                        key={tab.id}
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 8,
                                            padding: 14,
                                            borderRadius: 10,
                                            backgroundColor: 'var(--lm-bg-elevated)',
                                            border: '1px solid var(--lm-border)',
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                gap: 6,
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                                                <span className="lm-favicon-wrap" style={{ margin: 0 }}>
                                                    <img
                                                        src={tab.favIconUrl || getFaviconUrl(url)}
                                                        alt=""
                                                    />
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: 11,
                                                        color: 'var(--lm-text-muted)',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {host}
                                                </span>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                {!tab.closed && (
                                                    <span
                                                        title="Currently open"
                                                        style={{
                                                            width: 7,
                                                            height: 7,
                                                            borderRadius: '50%',
                                                            backgroundColor: '#22be6b',
                                                        }}
                                                    />
                                                )}
                                                <Tag style={{ margin: 0, fontSize: 10 }}>
                                                    {t(catMeta.labelKey, catMeta.fallback)}
                                                </Tag>
                                            </div>
                                        </div>

                                        <div
                                            onClick={() => void openOrActivateNode(tab.id)}
                                            style={{
                                                fontSize: 13,
                                                fontWeight: 600,
                                                lineHeight: 1.4,
                                                cursor: 'pointer',
                                                color: 'var(--lm-text)',
                                                display: '-webkit-box',
                                                WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical',
                                                overflow: 'hidden',
                                            }}
                                        >
                                            {tab.alias || tab.title}
                                        </div>

                                        {settings.showSiteDescriptions && (
                                            <div
                                                onClick={() =>
                                                    setEditTarget({
                                                        tab,
                                                        desc,
                                                        category: cat,
                                                    })
                                                }
                                                style={{
                                                    fontSize: 12,
                                                    lineHeight: 1.45,
                                                    color: desc
                                                        ? 'var(--lm-text-muted)'
                                                        : 'var(--lm-text-closed)',
                                                    cursor: 'pointer',
                                                    fontStyle: desc ? 'normal' : 'italic',
                                                }}
                                            >
                                                {desc && metaRecord?.source === 'ai' && (
                                                    <Tag
                                                        color="gold"
                                                        style={{
                                                            fontSize: 9,
                                                            lineHeight: '14px',
                                                            padding: '0 4px',
                                                            margin: '0 5px 0 0',
                                                        }}
                                                    >
                                                        AI
                                                    </Tag>
                                                )}
                                                {desc || `+ ${t('addDescription')}`}
                                            </div>
                                        )}

                                        <div
                                            style={{
                                                marginTop: 'auto',
                                                paddingTop: 6,
                                                borderTop: '1px solid var(--lm-border)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                            }}
                                        >
                                            <Button
                                                size="small"
                                                type="link"
                                                style={{ padding: 0, fontSize: 11 }}
                                                onClick={() => void openOrActivateNode(tab.id)}
                                            >
                                                {tab.closed ? 'Open' : 'Focus'}
                                            </Button>

                                            <div style={{ display: 'flex', gap: 2 }}>
                                                <Tooltip title={t('editDescription')}>
                                                    <Button
                                                        size="small"
                                                        type="text"
                                                        icon={<Pencil size={12} />}
                                                        onClick={() =>
                                                            setEditTarget({
                                                                tab,
                                                                desc,
                                                                category: cat,
                                                            })
                                                        }
                                                    />
                                                </Tooltip>
                                                <Tooltip title={t('ctxMenuCopyLink')}>
                                                    <Button
                                                        size="small"
                                                        type="text"
                                                        icon={<Copy size={12} />}
                                                        onClick={() => {
                                                            void navigator.clipboard.writeText(url);
                                                            void message.success('Link copied', 1);
                                                        }}
                                                    />
                                                </Tooltip>
                                                <Tooltip title={t('shareSingleCard')}>
                                                    <Button
                                                        size="small"
                                                        type="text"
                                                        icon={<QrCode size={12} />}
                                                        onClick={() =>
                                                            setShareModalTarget({
                                                                mode: 'single',
                                                                tab,
                                                            })
                                                        }
                                                    />
                                                </Tooltip>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </main>

            {/* Edit Site Description & Category Modal */}
            <Modal
                title={t('editDescription')}
                open={Boolean(editTarget)}
                onCancel={() => setEditTarget(null)}
                onOk={() => {
                    if (!editTarget) return;
                    void saveSiteDescription(
                        editTarget.tab.url || editTarget.tab.pendingUrl || '',
                        editTarget.desc,
                        editTarget.category,
                    );
                    setEditTarget(null);
                    void message.success('Saved', 1);
                }}
                width={400}
            >
                {editTarget && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>
                            {editTarget.tab.alias || editTarget.tab.title}
                        </div>
                        <Input.TextArea
                            rows={3}
                            value={editTarget.desc}
                            onChange={(e) =>
                                setEditTarget({ ...editTarget, desc: e.target.value })
                            }
                            placeholder={t('descriptionPlaceholder')}
                        />
                        <Select
                            value={editTarget.category}
                            onChange={(val) =>
                                setEditTarget({
                                    ...editTarget,
                                    category: val as CollectionCategory,
                                })
                            }
                            options={(Object.keys(CATEGORY_META) as CollectionCategory[]).map(
                                (c) => ({
                                    value: c,
                                    label: t(CATEGORY_META[c].labelKey, CATEGORY_META[c].fallback),
                                }),
                            )}
                        />
                    </div>
                )}
            </Modal>

            {/* Create Collection Modal */}
            <Modal
                title={t('newCollection')}
                open={newColOpen}
                onCancel={() => setNewColOpen(false)}
                onOk={() => {
                    createCollection(
                        newColName || `Group ${collections.length + 1}`,
                        newColColor,
                        newColCat,
                    );
                    setNewColName('');
                    setNewColOpen(false);
                }}
                width={340}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Input
                        value={newColName}
                        onChange={(e) => setNewColName(e.target.value)}
                        placeholder="Collection name"
                    />
                    <Select
                        value={newColCat}
                        onChange={(val) => setNewColCat(val as CollectionCategory)}
                        options={(Object.keys(CATEGORY_META) as CollectionCategory[]).map((c) => ({
                            value: c,
                            label: t(CATEGORY_META[c].labelKey, CATEGORY_META[c].fallback),
                        }))}
                    />
                    <Select
                        value={newColColor}
                        onChange={(val) => setNewColColor(val as TabGroupColor)}
                        options={(Object.keys(TAB_GROUP_COLOR_HEX) as TabGroupColor[]).map((c) => ({
                            value: c,
                            label: c,
                        }))}
                    />
                </div>
            </Modal>

            <ShareModal />
            <SettingsModal />
            <AiAssistantModal />
        </div>
    );
};

export const DashboardApp: React.FC = () => {
    const themeSetting = useWorkspaceStore((s) => s.settings.theme);
    const [systemDark, setSystemDark] = useState(() =>
        typeof window !== 'undefined'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
            : true,
    );

    useEffect(() => {
        if (themeSetting !== 'auto') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
        setSystemDark(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, [themeSetting]);

    const isDark = themeSetting === 'auto' ? systemDark : themeSetting === 'dark';

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }, [isDark]);

    return (
        <ConfigProvider
            theme={{
                algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
                token: {
                    colorPrimary: '#d2a400',
                    borderRadius: 6,
                    fontSize: 12,
                },
            }}
        >
            <AntdApp style={{ height: '100%' }}>
                <DashboardInner />
            </AntdApp>
        </ConfigProvider>
    );
};
