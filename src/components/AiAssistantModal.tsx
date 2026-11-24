import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    App as AntdApp,
    Button,
    Checkbox,
    Empty,
    List,
    Modal,
    Progress,
    Select,
    Switch,
    Tabs,
    Tag,
} from 'antd';
import {
    BookOpen,
    ExternalLink,
    FolderPlus,
    Layers,
    LayoutGrid,
    Sparkles,
    Trash2,
} from 'lucide-react';

import {
    cloneWithFreshIdsAndClosed,
    collectSubtreeTabs,
    findNodeById,
} from '../core/tree-engine';
import {
    TAB_GROUP_COLOR_HEX,
    type CollectionCategory,
    type TabGroupNode,
    type TabNode,
    type TreeNode,
    type WindowNode,
} from '../core/types';
import type {
    AiOrganizeProposal,
    AiReadlistCuration,
    AiWorkDigestRecord,
} from '../services/ai/types';
import { openTabsAsChromeGroup } from '../services/browser-bridge';
import { db } from '../services/db';
import { t } from '../services/i18n';
import { broadcastSiteMetaUpdated, sendBackgroundCommand } from '../services/sync-channel';
import { useWorkspaceStore, type AiAssistantTabKey } from '../store/workspace-store';

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

export const AiAssistantModal: React.FC = () => {
    const { message } = AntdApp.useApp();
    const open = useWorkspaceStore((s) => s.aiModalOpen);
    const activeTab = useWorkspaceStore((s) => s.aiModalTab);
    const setAiModalOpen = useWorkspaceStore((s) => s.setAiModalOpen);
    const setSettingsModalOpen = useWorkspaceStore((s) => s.setSettingsModalOpen);

    const nodes = useWorkspaceStore((s) => s.nodes);
    const collections = useWorkspaceStore((s) => s.collections);
    const settings = useWorkspaceStore((s) => s.settings);
    const aiConfig = useWorkspaceStore((s) => s.aiConfig);
    const aiDigests = useWorkspaceStore((s) => s.aiDigests);
    const aiBusy = useWorkspaceStore((s) => s.aiBusy);

    const runAiWorkDigest = useWorkspaceStore((s) => s.runAiWorkDigest);
    const deleteAiDigest = useWorkspaceStore((s) => s.deleteAiDigest);
    const runAiOrganizeProposal = useWorkspaceStore((s) => s.runAiOrganizeProposal);
    const applyAiProposedGroups = useWorkspaceStore((s) => s.applyAiProposedGroups);
    const runAiReadlistCuration = useWorkspaceStore((s) => s.runAiReadlistCuration);
    const runAiSiteDescriptions = useWorkspaceStore((s) => s.runAiSiteDescriptions);
    const createCollection = useWorkspaceStore((s) => s.createCollection);
    const closeNodeAction = useWorkspaceStore((s) => s.closeNodeAction);
    const openOrActivateNode = useWorkspaceStore((s) => s.openOrActivateNode);

    const [scopeKey, setScopeKey] = useState<string>('open');
    const [activeDigest, setActiveDigest] = useState<AiWorkDigestRecord | null>(null);
    const [proposal, setProposal] = useState<AiOrganizeProposal | null>(null);
    const [selectedGroupIndices, setSelectedGroupIndices] = useState<number[]>([]);
    const [curation, setCuration] = useState<AiReadlistCuration | null>(null);
    const [skipExistingDesc, setSkipExistingDesc] = useState(true);
    const [descProgress, setDescProgress] = useState<{ done: number; total: number } | null>(null);
    const [descSummary, setDescSummary] = useState<{
        updatedCount: number;
        skippedCachedCount: number;
        skippedPrivacyCount: number;
    } | null>(null);

    const tabById = useMemo(() => {
        const map = new Map<string, TabNode>();
        for (const tab of nodes.flatMap((n) => collectSubtreeTabs(n))) {
            map.set(tab.id, tab);
        }
        for (const tab of collections.flatMap((c) => collectSubtreeTabs(c))) {
            if (!map.has(tab.id)) map.set(tab.id, tab);
        }
        return map;
    }, [nodes, collections]);

    const openTabs = useMemo(
        () => nodes.flatMap((n) => collectSubtreeTabs(n, { onlyOpened: true })),
        [nodes],
    );

    useEffect(() => {
        if (!open) return;
        setActiveDigest((prev) => prev ?? aiDigests[0] ?? null);
        if (openTabs.length === 0 && scopeKey === 'open') {
            setScopeKey('all');
        }
    }, [open, aiDigests, openTabs.length, scopeKey]);

    const nativeGroups = useMemo(() => collectTabGroups(nodes), [nodes]);
    const windows = useMemo(
        () => nodes.filter((n): n is WindowNode => n.nodeType === 'window'),
        [nodes],
    );

    const scopeOptions = useMemo(() => {
        const opts: Array<{ value: string; label: string }> = [
            { value: 'open', label: `${t('aiScopeOpen')} (${openTabs.length})` },
            { value: 'all', label: `${t('aiScopeAll')} (${tabById.size})` },
        ];
        windows.forEach((w, idx) => {
            opts.push({
                value: `node:${w.id}`,
                label: `Window #${idx + 1}: ${w.alias || w.title} (${collectSubtreeTabs(w).length})`,
            });
        });
        nativeGroups.forEach((g) => {
            opts.push({
                value: `node:${g.id}`,
                label: `Group: ${g.title || 'Unnamed'} (${collectSubtreeTabs(g).length})`,
            });
        });
        collections.forEach((c) => {
            opts.push({
                value: `node:${c.id}`,
                label: `Collection: ${c.title} (${collectSubtreeTabs(c).length})`,
            });
        });
        return opts;
    }, [openTabs.length, tabById.size, windows, nativeGroups, collections]);

    const { scopedTabs, scopedTitle } = useMemo(() => {
        if (scopeKey === 'open') {
            return { scopedTabs: openTabs, scopedTitle: t('aiScopeOpen') };
        }
        if (scopeKey === 'all') {
            return { scopedTabs: Array.from(tabById.values()), scopedTitle: t('aiScopeAll') };
        }
        if (scopeKey.startsWith('node:')) {
            const id = scopeKey.slice('node:'.length);
            const node = findNodeById(nodes, id) ?? findNodeById(collections, id);
            if (node) {
                return {
                    scopedTabs: collectSubtreeTabs(node),
                    scopedTitle: node.alias || node.title || 'Group',
                };
            }
        }
        return { scopedTabs: openTabs, scopedTitle: t('aiScopeOpen') };
    }, [scopeKey, openTabs, tabById, nodes, collections]);

    const aiReady = !settings.offlineOnlyMode && aiConfig.enabled;

    const handleGenerateDigest = async () => {
        try {
            const res = await runAiWorkDigest(scopedTitle, scopedTabs);
            setActiveDigest(res.digest);
            void message.success(
                res.skippedPrivacyCount > 0
                    ? `Summary ready (${res.skippedPrivacyCount} private URLs excluded)`
                    : 'Work summary generated',
                1.8,
            );
        } catch (err) {
            void message.error(err instanceof Error ? err.message : String(err));
        }
    };

    const handleReopenTabIds = async (ids: string[], groupTitle: string) => {
        const targetTabs = ids
            .map((id) => tabById.get(id))
            .filter((tNode): tNode is TabNode => Boolean(tNode));
        if (targetTabs.length === 0) {
            void message.warning('No matching tabs found in current workspace');
            return;
        }
        await openTabsAsChromeGroup(targetTabs, { title: groupTitle, color: 'blue' });
        void message.success(`Opened ${targetTabs.length} tabs in browser group`, 1.4);
    };

    const handleSaveTabIdsAsCollection = (
        title: string,
        category: CollectionCategory,
        ids: string[],
    ) => {
        const targetTabs = ids
            .map((id) => tabById.get(id))
            .filter((tNode): tNode is TabNode => Boolean(tNode));
        if (targetTabs.length === 0) return;
        createCollection(title, 'purple', category, cloneWithFreshIdsAndClosed(targetTabs));
        void message.success(`Saved collection "${title}"`, 1.4);
    };

    const handleGenerateOrganize = async () => {
        try {
            const res = await runAiOrganizeProposal(scopedTabs);
            setProposal(res.proposal);
            setSelectedGroupIndices(res.proposal.proposedGroups.map((_, i) => i));
        } catch (err) {
            void message.error(err instanceof Error ? err.message : String(err));
        }
    };

    const handleApplyProposed = async (mode: 'collection' | 'chromeGroup') => {
        if (!proposal) return;
        const picked = proposal.proposedGroups.filter((_, idx) =>
            selectedGroupIndices.includes(idx),
        );
        if (picked.length === 0) {
            void message.warning('Select at least one proposed group');
            return;
        }
        const count = await applyAiProposedGroups(picked, mode);
        void message.success(
            mode === 'collection'
                ? `Created ${count} custom collections`
                : `Opened ${count} Chrome tab groups`,
            1.6,
        );
    };

    const handleGenerateReadlist = async () => {
        try {
            const res = await runAiReadlistCuration(scopedTabs);
            setCuration(res.curation);
        } catch (err) {
            void message.error(err instanceof Error ? err.message : String(err));
        }
    };

    const handleWriteCurationGuidesToDashboard = async () => {
        if (!curation) return;
        const items: Array<{
            url: string;
            description: string;
            category: CollectionCategory;
            source: 'ai';
        }> = [];
        for (const shelf of curation.shelves) {
            for (const item of shelf.items) {
                items.push({
                    url: item.url,
                    description: item.oneLineGuide,
                    category: shelf.category,
                    source: 'ai',
                });
            }
        }
        if (items.length === 0) return;
        const updatedMap = await db.bulkUpsertSiteMeta(items, { overwriteManual: false });
        useWorkspaceStore.setState({ siteMetaMap: updatedMap });
        broadcastSiteMetaUpdated();
        void message.success(`Saved ${items.length} guides to Navigation Dashboard`, 1.5);
    };

    const handleGenerateDescriptions = async () => {
        setDescSummary(null);
        setDescProgress({ done: 0, total: scopedTabs.length });
        try {
            const res = await runAiSiteDescriptions(scopedTabs, {
                overwriteAi: !skipExistingDesc,
                onProgress: (done, total) => setDescProgress({ done, total }),
            });
            setDescSummary(res);
            void message.success(`Updated ${res.updatedCount} site descriptions`, 1.5);
        } catch (err) {
            void message.error(err instanceof Error ? err.message : String(err));
        } finally {
            setDescProgress(null);
        }
    };

    return (
        <Modal
            title={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Sparkles size={16} style={{ color: 'var(--lm-primary)' }} />
                    {t('aiAssistantTitle')}
                </span>
            }
            open={open}
            onCancel={() => setAiModalOpen(false)}
            footer={null}
            width="min(580px, 95vw)"
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {!aiReady && (
                    <Alert
                        type={settings.offlineOnlyMode ? 'warning' : 'info'}
                        showIcon
                        message={
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 8,
                                    flexWrap: 'wrap',
                                }}
                            >
                                <span style={{ fontSize: 12 }}>
                                    {settings.offlineOnlyMode
                                        ? t('aiOfflineBannerTitle')
                                        : t('aiNotConfiguredBanner')}
                                </span>
                                <Button
                                    size="small"
                                    type="primary"
                                    onClick={() => {
                                        setAiModalOpen(false);
                                        setSettingsModalOpen(true, 'ai');
                                    }}
                                >
                                    {t('aiConfigureBtn')}
                                </Button>
                            </div>
                        }
                    />
                )}

                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                    }}
                >
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{t('aiScopeLabel')}:</span>
                    <Select
                        size="small"
                        value={scopeKey}
                        onChange={setScopeKey}
                        options={scopeOptions}
                        style={{ flex: 1, minWidth: 200 }}
                    />
                    <Tag style={{ margin: 0 }}>{scopedTabs.length} tabs</Tag>
                </div>

                <Tabs
                    size="small"
                    activeKey={activeTab}
                    onChange={(k) => setAiModalOpen(true, k as AiAssistantTabKey)}
                    items={[
                        {
                            key: 'digest',
                            label: t('aiTabDigest'),
                            children: (
                                <div
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 10,
                                        maxHeight: '54vh',
                                        overflowY: 'auto',
                                    }}
                                >
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <Button
                                            type="primary"
                                            size="small"
                                            icon={<Sparkles size={13} />}
                                            disabled={!aiReady || scopedTabs.length === 0}
                                            loading={aiBusy}
                                            onClick={() => void handleGenerateDigest()}
                                        >
                                            {t('aiRunDigest')}
                                        </Button>
                                        <span style={{ fontSize: 11, color: 'var(--lm-text-muted)' }}>
                                            {t('aiDigestHint')}
                                        </span>
                                    </div>

                                    {activeDigest && (
                                        <div
                                            style={{
                                                padding: 12,
                                                borderRadius: 8,
                                                backgroundColor: 'var(--lm-bg-elevated)',
                                                border: '1px solid var(--lm-border)',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 8,
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
                                                <span style={{ fontWeight: 700, fontSize: 13 }}>
                                                    {activeDigest.headline}
                                                </span>
                                                <Tag style={{ margin: 0, fontSize: 10 }}>
                                                    {activeDigest.model}
                                                </Tag>
                                            </div>
                                            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                                                {activeDigest.progressSummary}
                                            </div>

                                            {activeDigest.priorityTabIds.length > 0 && (
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 6,
                                                        flexWrap: 'wrap',
                                                    }}
                                                >
                                                    <Button
                                                        size="small"
                                                        type="primary"
                                                        icon={<ExternalLink size={12} />}
                                                        onClick={() =>
                                                            void handleReopenTabIds(
                                                                activeDigest.priorityTabIds,
                                                                activeDigest.headline,
                                                            )
                                                        }
                                                    >
                                                        {t('aiResumePriority')} (
                                                        {activeDigest.priorityTabIds.length})
                                                    </Button>
                                                </div>
                                            )}

                                            {activeDigest.workstreams.map((ws, idx) => (
                                                <div
                                                    key={idx}
                                                    style={{
                                                        padding: 8,
                                                        borderRadius: 6,
                                                        border: '1px solid var(--lm-border)',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: 4,
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
                                                        <span style={{ fontWeight: 600, fontSize: 12 }}>
                                                            {ws.name}
                                                        </span>
                                                        <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>
                                                            {ws.status}
                                                        </Tag>
                                                    </div>
                                                    <div style={{ fontSize: 11, color: 'var(--lm-text-muted)' }}>
                                                        Next: {ws.nextStep}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                                                        <Button
                                                            size="small"
                                                            icon={<ExternalLink size={11} />}
                                                            onClick={() =>
                                                                void handleReopenTabIds(
                                                                    ws.tabIds,
                                                                    ws.name,
                                                                )
                                                            }
                                                        >
                                                            {t('aiOpenStreamTabs')} ({ws.tabIds.length})
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            icon={<FolderPlus size={11} />}
                                                            onClick={() =>
                                                                handleSaveTabIdsAsCollection(
                                                                    ws.name,
                                                                    'workspace',
                                                                    ws.tabIds,
                                                                )
                                                            }
                                                        >
                                                            {t('aiSaveAsCollection')}
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {aiDigests.length > 0 && (
                                        <div>
                                            <div
                                                style={{
                                                    fontSize: 11,
                                                    fontWeight: 600,
                                                    color: 'var(--lm-text-muted)',
                                                    marginBottom: 4,
                                                }}
                                            >
                                                {t('aiDigestHistory')} ({aiDigests.length})
                                            </div>
                                            <List
                                                size="small"
                                                dataSource={aiDigests}
                                                renderItem={(item) => (
                                                    <List.Item
                                                        style={{ cursor: 'pointer', padding: '4px 6px' }}
                                                        onClick={() => setActiveDigest(item)}
                                                        actions={[
                                                            <Button
                                                                key="del"
                                                                size="small"
                                                                type="text"
                                                                danger
                                                                icon={<Trash2 size={11} />}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    void deleteAiDigest(item.id);
                                                                    if (activeDigest?.id === item.id) {
                                                                        setActiveDigest(null);
                                                                    }
                                                                }}
                                                            />,
                                                        ]}
                                                    >
                                                        <span style={{ fontSize: 11 }}>
                                                            <strong>{item.headline}</strong> ·{' '}
                                                            <span style={{ color: 'var(--lm-text-muted)' }}>
                                                                {new Date(item.createdAt).toLocaleString()}
                                                            </span>
                                                        </span>
                                                    </List.Item>
                                                )}
                                            />
                                        </div>
                                    )}
                                </div>
                            ),
                        },
                        {
                            key: 'organize',
                            label: t('aiTabOrganize'),
                            children: (
                                <div
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 10,
                                        maxHeight: '54vh',
                                        overflowY: 'auto',
                                    }}
                                >
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <Button
                                            type="primary"
                                            size="small"
                                            icon={<Layers size={13} />}
                                            disabled={!aiReady || scopedTabs.length === 0}
                                            loading={aiBusy}
                                            onClick={() => void handleGenerateOrganize()}
                                        >
                                            {t('aiRunOrganize')}
                                        </Button>
                                    </div>

                                    {!proposal ? (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description={t('aiOrganizeEmpty')}
                                        />
                                    ) : (
                                        <>
                                            <Alert type="info" showIcon message={proposal.summary} />

                                            {proposal.proposedGroups.map((grp, idx) => (
                                                <div
                                                    key={idx}
                                                    style={{
                                                        padding: 10,
                                                        borderRadius: 8,
                                                        backgroundColor: 'var(--lm-bg-elevated)',
                                                        border: '1px solid var(--lm-border)',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: 5,
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
                                                        <Checkbox
                                                            checked={selectedGroupIndices.includes(idx)}
                                                            onChange={(e) =>
                                                                setSelectedGroupIndices((prev) =>
                                                                    e.target.checked
                                                                        ? [...prev, idx]
                                                                        : prev.filter((i) => i !== idx),
                                                                )
                                                            }
                                                        >
                                                            <span
                                                                style={{
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    gap: 6,
                                                                    fontWeight: 600,
                                                                }}
                                                            >
                                                                <span
                                                                    className="lm-group-dot"
                                                                    style={{
                                                                        margin: 0,
                                                                        backgroundColor:
                                                                            TAB_GROUP_COLOR_HEX[grp.color],
                                                                    }}
                                                                />
                                                                {grp.title}
                                                            </span>
                                                        </Checkbox>
                                                        <Tag style={{ margin: 0, fontSize: 10 }}>
                                                            {CATEGORY_LABELS[grp.category]} · {grp.tabIds.length}
                                                        </Tag>
                                                    </div>
                                                    {grp.reason && (
                                                        <div style={{ fontSize: 11, color: 'var(--lm-text-muted)' }}>
                                                            {grp.reason}
                                                        </div>
                                                    )}
                                                    <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                        {grp.tabIds.map((tid) => {
                                                            const tab = tabById.get(tid);
                                                            if (!tab) return null;
                                                            return (
                                                                <div
                                                                    key={tid}
                                                                    style={{
                                                                        overflow: 'hidden',
                                                                        textOverflow: 'ellipsis',
                                                                        whiteSpace: 'nowrap',
                                                                    }}
                                                                >
                                                                    • {tab.alias || tab.title}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}

                                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                <Button
                                                    type="primary"
                                                    size="small"
                                                    icon={<FolderPlus size={12} />}
                                                    onClick={() => void handleApplyProposed('collection')}
                                                >
                                                    {t('aiApplyAsCollections')}
                                                </Button>
                                                <Button
                                                    size="small"
                                                    icon={<Layers size={12} />}
                                                    onClick={() => void handleApplyProposed('chromeGroup')}
                                                >
                                                    {t('aiApplyAsChromeGroups')}
                                                </Button>
                                            </div>

                                            {proposal.duplicateTabs.length > 0 && (
                                                <Alert
                                                    type="warning"
                                                    showIcon
                                                    message={`${t('aiDuplicatesFound')} (${proposal.duplicateTabs.length})`}
                                                    description={
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                                                            {proposal.duplicateTabs.map((d) => {
                                                                const tab = tabById.get(d.tabId);
                                                                return (
                                                                    <div key={d.tabId}>
                                                                        • {tab?.title || d.tabId} — {d.reason}
                                                                    </div>
                                                                );
                                                            })}
                                                            <div>
                                                                <Button
                                                                    size="small"
                                                                    danger
                                                                    onClick={() => {
                                                                        void closeNodeAction(
                                                                            proposal.duplicateTabs.map((d) => d.tabId),
                                                                            'item',
                                                                        );
                                                                        void message.success(
                                                                            'Closed & saved duplicate tabs',
                                                                        );
                                                                    }}
                                                                >
                                                                    {t('aiCloseDuplicates')}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    }
                                                />
                                            )}
                                        </>
                                    )}
                                </div>
                            ),
                        },
                        {
                            key: 'readlist',
                            label: t('aiTabReadlist'),
                            children: (
                                <div
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 10,
                                        maxHeight: '54vh',
                                        overflowY: 'auto',
                                    }}
                                >
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        <Button
                                            type="primary"
                                            size="small"
                                            icon={<BookOpen size={13} />}
                                            disabled={!aiReady || scopedTabs.length === 0}
                                            loading={aiBusy}
                                            onClick={() => void handleGenerateReadlist()}
                                        >
                                            {t('aiRunReadlist')}
                                        </Button>
                                        {curation && (
                                            <Button
                                                size="small"
                                                icon={<Sparkles size={12} />}
                                                onClick={() => void handleWriteCurationGuidesToDashboard()}
                                            >
                                                {t('aiSaveGuidesToDashboard')}
                                            </Button>
                                        )}
                                    </div>

                                    {!curation ? (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description={t('aiReadlistEmpty')}
                                        />
                                    ) : (
                                        <>
                                            <Alert type="info" showIcon message={curation.summary} />
                                            {curation.shelves.map((shelf, idx) => (
                                                <div
                                                    key={idx}
                                                    style={{
                                                        padding: 10,
                                                        borderRadius: 8,
                                                        backgroundColor: 'var(--lm-bg-elevated)',
                                                        border: '1px solid var(--lm-border)',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: 6,
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
                                                        <span style={{ fontWeight: 700, fontSize: 12 }}>
                                                            {shelf.title}{' '}
                                                            <Tag style={{ marginLeft: 4, fontSize: 10 }}>
                                                                {CATEGORY_LABELS[shelf.category]}
                                                            </Tag>
                                                        </span>
                                                        <Button
                                                            size="small"
                                                            icon={<FolderPlus size={11} />}
                                                            onClick={() =>
                                                                handleSaveTabIdsAsCollection(
                                                                    shelf.title,
                                                                    shelf.category,
                                                                    shelf.items.map((i) => i.tabId),
                                                                )
                                                            }
                                                        >
                                                            {t('aiSaveAsCollection')}
                                                        </Button>
                                                    </div>

                                                    {shelf.items.map((item) => (
                                                        <div
                                                            key={item.tabId}
                                                            style={{
                                                                padding: '4px 6px',
                                                                borderRadius: 5,
                                                                backgroundColor: 'var(--lm-bg)',
                                                                fontSize: 11,
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                gap: 2,
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
                                                                <a
                                                                    onClick={() =>
                                                                        void openOrActivateNode(item.tabId)
                                                                    }
                                                                    style={{
                                                                        fontWeight: 600,
                                                                        cursor: 'pointer',
                                                                        color: 'var(--lm-text)',
                                                                    }}
                                                                >
                                                                    {item.title}
                                                                </a>
                                                                <Tag
                                                                    color={
                                                                        item.priority === 'high'
                                                                            ? 'gold'
                                                                            : item.priority === 'low'
                                                                              ? 'default'
                                                                              : 'blue'
                                                                    }
                                                                    style={{ margin: 0, fontSize: 10 }}
                                                                >
                                                                    {item.priority}
                                                                </Tag>
                                                            </div>
                                                            <div style={{ color: 'var(--lm-text-muted)' }}>
                                                                {item.oneLineGuide}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ))}
                                        </>
                                    )}
                                </div>
                            ),
                        },
                        {
                            key: 'descriptions',
                            label: t('aiTabDescriptions'),
                            children: (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    <Alert
                                        type="info"
                                        showIcon
                                        message={t('aiDescriptionsIntro')}
                                    />

                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Switch
                                            size="small"
                                            checked={skipExistingDesc}
                                            onChange={setSkipExistingDesc}
                                        />
                                        <span style={{ fontSize: 12 }}>{t('aiSkipCachedDesc')}</span>
                                    </div>

                                    {descProgress && (
                                        <Progress
                                            percent={
                                                descProgress.total > 0
                                                    ? Math.round(
                                                          (descProgress.done / descProgress.total) * 100,
                                                      )
                                                    : 0
                                            }
                                            size="small"
                                        />
                                    )}

                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        <Button
                                            type="primary"
                                            size="small"
                                            icon={<Sparkles size={13} />}
                                            disabled={!aiReady || scopedTabs.length === 0}
                                            loading={aiBusy}
                                            onClick={() => void handleGenerateDescriptions()}
                                        >
                                            {t('aiRunDescriptions')}
                                        </Button>
                                        <Button
                                            size="small"
                                            icon={<LayoutGrid size={12} />}
                                            onClick={() =>
                                                void sendBackgroundCommand({
                                                    action: 'OPEN_DASHBOARD_TAB',
                                                })
                                            }
                                        >
                                            {t('openInDashboard')}
                                        </Button>
                                    </div>

                                    {descSummary && (
                                        <Alert
                                            type="success"
                                            showIcon
                                            message={`Updated ${descSummary.updatedCount} site descriptions (cached skipped: ${descSummary.skippedCachedCount}, privacy skipped: ${descSummary.skippedPrivacyCount})`}
                                        />
                                    )}
                                </div>
                            ),
                        },
                    ]}
                />
            </div>
        </Modal>
    );
};
