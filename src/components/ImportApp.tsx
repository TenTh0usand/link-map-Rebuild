import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    App as AntdApp,
    Button,
    Checkbox,
    ConfigProvider,
    Empty,
    Input,
    Spin,
    Tag,
    theme as antdTheme,
} from 'antd';
import { ChevronDown, ChevronRight, FolderInput, Layers, Search, Upload } from 'lucide-react';

import { parseLinkMapJson } from '../core/parsers/link-map-v1';
import { isTabsOutlinerExport, parseTabsOutlinerData } from '../core/parsers/tabs-outliner';
import {
    createCollectionNode,
    flattenVisibleTree,
    insertExternalNodes,
    toggleNodeExpanded,
} from '../core/tree-engine';
import { filterTree } from '../core/search';
import type { TreeNode } from '../core/types';
import { getFaviconUrl } from '../services/browser-bridge';
import { db } from '../services/db';
import { t } from '../services/i18n';
import { broadcastImportNodesRequest, broadcastStateUpdated } from '../services/sync-channel';
import { LINK_MAP_DRAG_MIME } from './VirtualTree';

import '../styles/workspace.css';

function collectTopSelectedNodes(nodes: TreeNode[], selectedSet: Set<string>): TreeNode[] {
    const out: TreeNode[] = [];
    const walk = (list: TreeNode[], ancestorPicked: boolean) => {
        for (const n of list) {
            const picked = selectedSet.has(n.id);
            if (picked && !ancestorPicked) {
                out.push(n);
            }
            walk(n.children, ancestorPicked || picked);
        }
    };
    walk(nodes, false);
    return out;
}

const ImportInner: React.FC<{ onThemeResolved?: (isDark: boolean) => void }> = ({
    onThemeResolved,
}) => {
    const { message } = AntdApp.useApp();
    const [loading, setLoading] = useState(true);
    const [nodes, setNodes] = useState<TreeNode[]>([]);
    const [exportTime, setExportTime] = useState<string | undefined>();
    const [sourceType, setSourceType] = useState<string>('linkMap');
    const [query, setQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        void (async () => {
            const settings = await db.getSettings();
            const isDark =
                settings.theme === 'auto'
                    ? window.matchMedia('(prefers-color-scheme: dark)').matches
                    : settings.theme === 'dark';
            onThemeResolved?.(isDark);

            const staged = await db.getStagedImportData();
            if (staged) {
                const combined = [...staged.nodes, ...staged.collections];
                setNodes(combined);
                setExportTime(staged.exportTime);
                setSourceType(staged.sourceType);
            }
            setLoading(false);
        })();
    }, [onThemeResolved]);

    const visibleRows = useMemo(
        () => (query.trim() ? filterTree(nodes, query) : flattenVisibleTree(nodes)),
        [nodes, query],
    );

    const handleLocalFile = async (file: File) => {
        try {
            const raw = JSON.parse(await file.text()) as unknown;
            if (isTabsOutlinerExport(raw)) {
                const parsed = parseTabsOutlinerData(raw);
                setNodes(parsed);
                setSourceType('tabsOutliner');
                setExportTime(undefined);
            } else {
                const parsed = parseLinkMapJson(raw);
                setNodes([...parsed.nodes, ...parsed.collections]);
                setSourceType('linkMap');
                setExportTime(parsed.exportTime);
            }
            setSelectedIds([]);
            void message.success('Loaded file', 1);
        } catch {
            void message.error('Unsupported or invalid backup file');
        }
    };

    const persistAndBroadcastImport = async (
        toImport: TreeNode[],
        asCollectionTitle?: string,
    ) => {
        if (toImport.length === 0) return;
        const handledByOpenView = await broadcastImportNodesRequest(toImport, asCollectionTitle);
        if (!handledByOpenView) {
            const snap = await db.getSnapshot();
            const existingNodes = snap?.nodes ?? [];
            const existingCols = snap?.collections ?? [];
            if (existingNodes.length > 0) {
                await db.createRollingBackup(
                    existingNodes,
                    existingCols,
                    'pre-import',
                    'Before Import',
                );
            }

            if (asCollectionTitle) {
                const newCol = createCollectionNode(asCollectionTitle, 'blue', 'workspace', toImport);
                await db.saveSnapshot(existingNodes, [newCol, ...existingCols]);
            } else {
                const merged = insertExternalNodes(existingNodes, toImport, null, 'after');
                await db.saveSnapshot(merged, existingCols);
            }
            broadcastStateUpdated();
        }
        void message.success(t('importSuccess', 'Imported successfully'), 1.5);
    };

    const selectedSet = new Set(selectedIds);

    return (
        <div
            className="lm-shell"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void handleLocalFile(file);
            }}
        >
            <input
                ref={fileInputRef}
                type="file"
                accept=".json,.tree"
                style={{ display: 'none' }}
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void handleLocalFile(f);
                }}
            />

            <div className="lm-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {t('importPageInfo')}
                    </span>
                    <Button
                        size="small"
                        icon={<Upload size={12} />}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        File
                    </Button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Input
                        size="small"
                        allowClear
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        prefix={<Search size={12} style={{ color: 'var(--lm-text-muted)' }} />}
                        placeholder={t('search', 'Search')}
                        style={{ flex: 1 }}
                    />
                    <Tag style={{ margin: 0, fontSize: 10 }}>{sourceType}</Tag>
                    {exportTime && (
                        <Tag style={{ margin: 0, fontSize: 10 }}>
                            {exportTime.slice(0, 10)}
                        </Tag>
                    )}
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button
                        size="small"
                        type="primary"
                        disabled={selectedIds.length === 0}
                        icon={<FolderInput size={12} />}
                        onClick={() => {
                            const picked = collectTopSelectedNodes(nodes, selectedSet);
                            void persistAndBroadcastImport(picked);
                        }}
                    >
                        {t('importSelected')} ({selectedIds.length})
                    </Button>
                    <Button
                        size="small"
                        disabled={nodes.length === 0}
                        onClick={() => void persistAndBroadcastImport(nodes)}
                    >
                        {t('importAllToTree')}
                    </Button>
                    <Button
                        size="small"
                        disabled={nodes.length === 0}
                        icon={<Layers size={12} />}
                        onClick={() =>
                            void persistAndBroadcastImport(
                                selectedIds.length > 0
                                    ? collectTopSelectedNodes(nodes, selectedSet)
                                    : nodes,
                                `Imported ${new Date().toLocaleDateString()}`,
                            )
                        }
                    >
                        {t('importAllAsCollection')}
                    </Button>
                </div>
            </div>

            {loading ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Spin />
                </div>
            ) : visibleRows.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                    <Empty description={t('dragOrClickImport')} />
                </div>
            ) : (
                <div className="lm-scroll" style={{ flex: 1, padding: '6px 6px 24px 6px' }}>
                    {visibleRows.map((row) => {
                        const { node, depth, hasChildren } = row;
                        const checked = selectedSet.has(node.id);
                        return (
                            <div
                                key={node.id}
                                className={`lm-tree-row ${checked ? 'is-selected' : ''}`}
                                style={{ height: 26, paddingLeft: 6 }}
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.effectAllowed = 'copyMove';
                                    e.dataTransfer.setData(
                                        LINK_MAP_DRAG_MIME,
                                        JSON.stringify({ source: 'import', nodes: [node] }),
                                    );
                                }}
                                onClick={() => {
                                    setSelectedIds((prev) =>
                                        prev.includes(node.id)
                                            ? prev.filter((id) => id !== node.id)
                                            : [...prev, node.id],
                                    );
                                }}
                            >
                                {Array.from({ length: depth }).map((_, i) => (
                                    <span key={i} className="lm-indent-guide" style={{ width: 16 }} />
                                ))}
                                <span
                                    className="lm-expander"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (hasChildren) {
                                            setNodes((prev) => toggleNodeExpanded(prev, node.id));
                                        }
                                    }}
                                >
                                    {hasChildren ? (
                                        node.expanded ? (
                                            <ChevronDown size={13} />
                                        ) : (
                                            <ChevronRight size={13} />
                                        )
                                    ) : null}
                                </span>
                                <Checkbox
                                    checked={checked}
                                    style={{ marginRight: 6 }}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={() => {
                                        setSelectedIds((prev) =>
                                            prev.includes(node.id)
                                                ? prev.filter((id) => id !== node.id)
                                                : [...prev, node.id],
                                        );
                                    }}
                                />
                                {node.nodeType === 'note' ? (
                                    <span className="lm-note-dot" />
                                ) : (
                                    <span className="lm-favicon-wrap">
                                        <img
                                            src={
                                                node.nodeType === 'tab'
                                                    ? node.favIconUrl || getFaviconUrl(node.url)
                                                    : '/icons/chrome_icon.svg'
                                            }
                                            alt=""
                                        />
                                    </span>
                                )}
                                <span className="lm-row-label">
                                    {node.alias ? `${node.alias} | ${node.title}` : node.title}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export const ImportApp: React.FC = () => {
    const [isDark, setIsDark] = useState(true);

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
                <ImportInner onThemeResolved={setIsDark} />
            </AntdApp>
        </ConfigProvider>
    );
};
