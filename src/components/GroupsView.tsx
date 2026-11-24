import React, { useMemo, useState } from 'react';
import { App as AntdApp, Button, Empty, Input, Modal, Select, Tag, Tooltip } from 'antd';
import {
    Copy,
    ExternalLink,
    FolderPlus,
    LayoutGrid,
    Plus,
    Share2,
    Trash2,
    Ungroup,
    XCircle,
} from 'lucide-react';

import { collectSubtreeTabs } from '../core/tree-engine';
import {
    TAB_GROUP_COLOR_HEX,
    type CollectionCategory,
    type TabGroupColor,
    type TabGroupNode,
    type TreeNode,
} from '../core/types';
import { getFaviconUrl } from '../services/browser-bridge';
import { t } from '../services/i18n';
import { sendBackgroundCommand } from '../services/sync-channel';
import { useWorkspaceStore } from '../store/workspace-store';

function collectTabGroups(nodes: TreeNode[]): TabGroupNode[] {
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

const CATEGORY_LABELS: Record<CollectionCategory, string> = {
    workspace: 'Workspace',
    readlist: 'Readlist',
    repo: 'Repos',
    media: 'Media',
    general: 'General',
};

export const GroupsView: React.FC = () => {
    const { message } = AntdApp.useApp();
    const nodes = useWorkspaceStore((s) => s.nodes);
    const collections = useWorkspaceStore((s) => s.collections);
    const searchQuery = useWorkspaceStore((s) => s.searchQuery);
    const openOrActivateNode = useWorkspaceStore((s) => s.openOrActivateNode);
    const closeNodeAction = useWorkspaceStore((s) => s.closeNodeAction);
    const ungroupTabGroup = useWorkspaceStore((s) => s.ungroupTabGroup);
    const copySubtreeMarkdown = useWorkspaceStore((s) => s.copySubtreeMarkdown);
    const createCollection = useWorkspaceStore((s) => s.createCollection);
    const deleteCollection = useWorkspaceStore((s) => s.deleteCollection);
    const openCollectionAction = useWorkspaceStore((s) => s.openCollectionAction);
    const addNodesToCollection = useWorkspaceStore((s) => s.addNodesToCollection);
    const removeChildFromCollection = useWorkspaceStore((s) => s.removeChildFromCollection);
    const setShareModalTarget = useWorkspaceStore((s) => s.setShareModalTarget);

    const [modalOpen, setModalOpen] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newColor, setNewColor] = useState<TabGroupColor>('blue');
    const [newCategory, setNewCategory] = useState<CollectionCategory>('workspace');

    const q = searchQuery.trim().toLowerCase();

    const nativeGroups = useMemo(() => {
        const all = collectTabGroups(nodes);
        if (!q) return all;
        return all.filter(
            (g) =>
                g.title.toLowerCase().includes(q) ||
                collectSubtreeTabs(g).some(
                    (tab) =>
                        tab.title.toLowerCase().includes(q) ||
                        tab.url.toLowerCase().includes(q),
                ),
        );
    }, [nodes, q]);

    const filteredCollections = useMemo(() => {
        if (!q) return collections;
        return collections.filter(
            (c) =>
                c.title.toLowerCase().includes(q) ||
                collectSubtreeTabs(c).some(
                    (tab) =>
                        tab.title.toLowerCase().includes(q) ||
                        tab.url.toLowerCase().includes(q),
                ),
        );
    }, [collections, q]);

    const handleCreate = () => {
        createCollection(newTitle || `Group ${collections.length + 1}`, newColor, newCategory);
        setNewTitle('');
        setModalOpen(false);
    };

    const renderPreviewTabs = (node: TreeNode, collectionId?: string) => {
        const tabs = collectSubtreeTabs(node);
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                {tabs.slice(0, 6).map((tab) => (
                    <div
                        key={tab.id}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 11,
                            color: tab.closed ? 'var(--lm-text-closed)' : 'var(--lm-text)',
                        }}
                    >
                        <img
                            src={tab.favIconUrl || getFaviconUrl(tab.url)}
                            alt=""
                            style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0 }}
                        />
                        <span
                            style={{
                                flex: 1,
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                cursor: 'pointer',
                            }}
                            onClick={() => void openOrActivateNode(tab.id)}
                        >
                            {tab.alias || tab.title}
                        </span>
                        {collectionId && (
                            <button
                                type="button"
                                className="lm-row-action-btn is-danger"
                                onClick={() => removeChildFromCollection(collectionId, tab.id)}
                            >
                                <Trash2 size={11} />
                            </button>
                        )}
                    </div>
                ))}
                {tabs.length > 6 && (
                    <span style={{ fontSize: 11, color: 'var(--lm-text-muted)' }}>
                        +{tabs.length - 6} more tabs
                    </span>
                )}
            </div>
        );
    };

    return (
        <div className="lm-scroll" style={{ flex: 1, padding: '10px 10px 56px 10px' }}>
            {/* Native Chrome Tab Groups */}
            <div style={{ marginBottom: 16 }}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 8,
                    }}
                >
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--lm-text-muted)' }}>
                        CHROME TAB GROUPS ({nativeGroups.length})
                    </span>
                </div>

                {nativeGroups.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="No Chrome Tab Groups synced yet"
                        style={{ margin: '12px 0' }}
                    />
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {nativeGroups.map((grp) => {
                            const tabCount = collectSubtreeTabs(grp).length;
                            return (
                                <div
                                    key={grp.id}
                                    style={{
                                        padding: 10,
                                        borderRadius: 8,
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
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                minWidth: 0,
                                            }}
                                        >
                                            <span
                                                className="lm-group-dot"
                                                style={{
                                                    margin: 0,
                                                    backgroundColor: TAB_GROUP_COLOR_HEX[grp.color],
                                                }}
                                            />
                                            <span style={{ fontWeight: 600, fontSize: 12 }}>
                                                {grp.title || 'Unnamed Group'}
                                            </span>
                                            <Tag style={{ margin: 0, fontSize: 10 }}>
                                                {tabCount}
                                            </Tag>
                                            {grp.closed && (
                                                <Tag style={{ margin: 0, fontSize: 10 }}>Saved</Tag>
                                            )}
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                            <Tooltip title={t('openAllTabs')}>
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<ExternalLink size={12} />}
                                                    onClick={() => void openOrActivateNode(grp.id)}
                                                />
                                            </Tooltip>
                                            <Tooltip title={t('openInDashboard')}>
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<LayoutGrid size={12} />}
                                                    onClick={() =>
                                                        void sendBackgroundCommand({
                                                            action: 'OPEN_DASHBOARD_TAB',
                                                            groupId: grp.id,
                                                        })
                                                    }
                                                />
                                            </Tooltip>
                                            <Tooltip title={t('shareGroup')}>
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<Share2 size={12} />}
                                                    onClick={() =>
                                                        setShareModalTarget({
                                                            mode: 'group',
                                                            title: grp.title || 'Chrome Tab Group',
                                                            color: grp.color,
                                                            nodes: [grp],
                                                        })
                                                    }
                                                />
                                            </Tooltip>
                                            <Tooltip title={t('moveToCollection')}>
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<FolderPlus size={12} />}
                                                    onClick={() => {
                                                        createCollection(
                                                            grp.title || 'Saved Group',
                                                            grp.color,
                                                            'workspace',
                                                        );
                                                        const newest =
                                                            useWorkspaceStore.getState()
                                                                .collections[0];
                                                        if (newest) {
                                                            addNodesToCollection(newest.id, [
                                                                grp.id,
                                                            ]);
                                                            void message.success(
                                                                'Saved as permanent collection',
                                                                1.2,
                                                            );
                                                        }
                                                    }}
                                                />
                                            </Tooltip>
                                            <Tooltip title={t('batchCopyMd')}>
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<Copy size={12} />}
                                                    onClick={() => {
                                                        void copySubtreeMarkdown([grp.id]);
                                                        void message.success('Markdown copied', 1);
                                                    }}
                                                />
                                            </Tooltip>
                                            {!grp.closed && (
                                                <>
                                                    <Tooltip title={t('closeAndSaveAll')}>
                                                        <Button
                                                            size="small"
                                                            type="text"
                                                            icon={<XCircle size={12} />}
                                                            onClick={() =>
                                                                void closeNodeAction(
                                                                    [grp.id],
                                                                    'subtree',
                                                                )
                                                            }
                                                        />
                                                    </Tooltip>
                                                    <Tooltip title={t('ungroupInChrome')}>
                                                        <Button
                                                            size="small"
                                                            type="text"
                                                            icon={<Ungroup size={12} />}
                                                            onClick={() =>
                                                                void ungroupTabGroup(grp.id)
                                                            }
                                                        />
                                                    </Tooltip>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    {renderPreviewTabs(grp)}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Custom Persistent Collections / Spaces */}
            <div>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 8,
                    }}
                >
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--lm-text-muted)' }}>
                        CUSTOM COLLECTIONS ({filteredCollections.length})
                    </span>
                    <Button
                        size="small"
                        type="primary"
                        icon={<Plus size={12} />}
                        onClick={() => setModalOpen(true)}
                    >
                        {t('newCollection', 'New Tab Group')}
                    </Button>
                </div>

                {filteredCollections.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="Create workspaces, readlists, or repo collections"
                        style={{ margin: '12px 0' }}
                    />
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {filteredCollections.map((col) => {
                            const tabCount = collectSubtreeTabs(col).length;
                            return (
                                <div
                                    key={col.id}
                                    style={{
                                        padding: 10,
                                        borderRadius: 8,
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
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                minWidth: 0,
                                            }}
                                        >
                                            <span
                                                className="lm-group-dot"
                                                style={{
                                                    margin: 0,
                                                    backgroundColor: TAB_GROUP_COLOR_HEX[col.color],
                                                }}
                                            />
                                            <span style={{ fontWeight: 600, fontSize: 12 }}>
                                                {col.title}
                                            </span>
                                            <Tag style={{ margin: 0, fontSize: 10 }}>
                                                {CATEGORY_LABELS[col.category]} · {tabCount}
                                            </Tag>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                            <Tooltip title={t('openAllTabs')}>
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<ExternalLink size={12} />}
                                                    onClick={() => void openCollectionAction(col.id)}
                                                />
                                            </Tooltip>
                                            <Tooltip title={t('openInDashboard')}>
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<LayoutGrid size={12} />}
                                                    onClick={() =>
                                                        void sendBackgroundCommand({
                                                            action: 'OPEN_DASHBOARD_TAB',
                                                            groupId: col.id,
                                                        })
                                                    }
                                                />
                                            </Tooltip>
                                            <Tooltip title={t('shareGroup')}>
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<Share2 size={12} />}
                                                    onClick={() =>
                                                        setShareModalTarget({
                                                            mode: 'group',
                                                            title: col.title,
                                                            color: col.color,
                                                            nodes: [col],
                                                        })
                                                    }
                                                />
                                            </Tooltip>
                                            <Tooltip title={t('batchCopyMd')}>
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<Copy size={12} />}
                                                    onClick={() => {
                                                        void copySubtreeMarkdown([col.id]);
                                                        void message.success('Markdown copied', 1);
                                                    }}
                                                />
                                            </Tooltip>
                                            <Tooltip title={t('ctxMenuDelete')}>
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    danger
                                                    icon={<Trash2 size={12} />}
                                                    onClick={() => deleteCollection(col.id)}
                                                />
                                            </Tooltip>
                                        </div>
                                    </div>
                                    {renderPreviewTabs(col, col.id)}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <Modal
                title={t('newCollection', 'New Tab Group')}
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                onOk={handleCreate}
                width={320}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Input
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        placeholder="Collection name (e.g. AI Research / Readlist)"
                        onPressEnter={handleCreate}
                    />
                    <Select
                        value={newCategory}
                        onChange={(val) => setNewCategory(val)}
                        options={(Object.keys(CATEGORY_LABELS) as CollectionCategory[]).map(
                            (cat) => ({
                                value: cat,
                                label: CATEGORY_LABELS[cat],
                            }),
                        )}
                    />
                    <Select
                        value={newColor}
                        onChange={(val) => setNewColor(val)}
                        options={(Object.keys(TAB_GROUP_COLOR_HEX) as TabGroupColor[]).map((c) => ({
                            value: c,
                            label: (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <span
                                        style={{
                                            width: 10,
                                            height: 10,
                                            borderRadius: 3,
                                            backgroundColor: TAB_GROUP_COLOR_HEX[c],
                                        }}
                                    />
                                    {c}
                                </span>
                            ),
                        }))}
                    />
                </div>
            </Modal>
        </div>
    );
};
