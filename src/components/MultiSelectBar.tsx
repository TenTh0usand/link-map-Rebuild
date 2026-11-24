import React, { useState } from 'react';
import { App as AntdApp, Button, Dropdown, Input, Modal, Select, Tooltip } from 'antd';
import { Copy, FileText, FolderPlus, Layers, Share2, Trash2, X, XCircle } from 'lucide-react';

import { findNodeById } from '../core/tree-engine';
import { TAB_GROUP_COLOR_HEX, type TabGroupColor, type TreeNode } from '../core/types';
import { t } from '../services/i18n';
import { useWorkspaceStore } from '../store/workspace-store';

export const MultiSelectBar: React.FC = () => {
    const { message } = AntdApp.useApp();
    const nodes = useWorkspaceStore((s) => s.nodes);
    const selectedIds = useWorkspaceStore((s) => s.selectedIds);
    const collections = useWorkspaceStore((s) => s.collections);
    const closeNodeAction = useWorkspaceStore((s) => s.closeNodeAction);
    const deleteNodeAction = useWorkspaceStore((s) => s.deleteNodeAction);
    const copySubtreeMarkdown = useWorkspaceStore((s) => s.copySubtreeMarkdown);
    const copySubtreeText = useWorkspaceStore((s) => s.copySubtreeText);
    const groupNodesInChrome = useWorkspaceStore((s) => s.groupNodesInChrome);
    const addNodesToCollection = useWorkspaceStore((s) => s.addNodesToCollection);
    const createCollection = useWorkspaceStore((s) => s.createCollection);
    const clearSelection = useWorkspaceStore((s) => s.clearSelection);
    const setShareModalTarget = useWorkspaceStore((s) => s.setShareModalTarget);

    const [groupModalOpen, setGroupModalOpen] = useState(false);
    const [groupTitle, setGroupTitle] = useState('Work Group');
    const [groupColor, setGroupColor] = useState<TabGroupColor>('blue');

    if (selectedIds.length === 0) return null;

    const collectionMenuItems = [
        ...collections.map((c) => ({
            key: c.id,
            label: c.title,
            onClick: () => {
                addNodesToCollection(c.id, selectedIds);
                void message.success(`Added to ${c.title}`, 1.2);
                clearSelection();
            },
        })),
        { type: 'divider' as const },
        {
            key: '__new__',
            label: `+ ${t('newCollection', 'New Tab Group')}`,
            onClick: () => {
                createCollection(`Group ${collections.length + 1}`, 'blue', 'workspace');
                const created = useWorkspaceStore.getState().collections[0];
                if (created) {
                    addNodesToCollection(created.id, selectedIds);
                    void message.success(`Created & added to ${created.title}`, 1.2);
                }
                clearSelection();
            },
        },
    ];

    return (
        <>
            <div className="lm-multiselect-bar">
                <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {selectedIds.length} {t('selectedCount', 'selected')}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    <Tooltip title={t('batchCloseSave')}>
                        <Button
                            size="small"
                            icon={<XCircle size={12} />}
                            onClick={() => {
                                void closeNodeAction(selectedIds, 'subtree');
                                clearSelection();
                            }}
                        />
                    </Tooltip>

                    <Tooltip title={t('groupInChrome')}>
                        <Button
                            size="small"
                            icon={<Layers size={12} />}
                            onClick={() => setGroupModalOpen(true)}
                        />
                    </Tooltip>

                    <Dropdown menu={{ items: collectionMenuItems }} trigger={['click']}>
                        <Tooltip title={t('moveToCollection')}>
                            <Button size="small" icon={<FolderPlus size={12} />} />
                        </Tooltip>
                    </Dropdown>

                    <Tooltip title={t('share', 'Share')}>
                        <Button
                            size="small"
                            icon={<Share2 size={12} />}
                            onClick={() => {
                                const picked = selectedIds
                                    .map((id) => findNodeById(nodes, id))
                                    .filter((n): n is TreeNode => Boolean(n));
                                if (picked.length === 1 && picked[0]!.nodeType === 'tab') {
                                    setShareModalTarget({ mode: 'single', tab: picked[0]! });
                                } else if (picked.length > 0) {
                                    setShareModalTarget({
                                        mode: 'group',
                                        title: `Shared Selection (${picked.length})`,
                                        nodes: picked,
                                    });
                                }
                            }}
                        />
                    </Tooltip>

                    <Tooltip title={t('batchCopyMd')}>
                        <Button
                            size="small"
                            icon={<Copy size={12} />}
                            onClick={() => {
                                void copySubtreeMarkdown(selectedIds);
                                void message.success('Markdown copied', 1);
                            }}
                        />
                    </Tooltip>

                    <Tooltip title={t('batchCopyTxt')}>
                        <Button
                            size="small"
                            icon={<FileText size={12} />}
                            onClick={() => {
                                void copySubtreeText(selectedIds);
                                void message.success('TXT copied', 1);
                            }}
                        />
                    </Tooltip>

                    <Tooltip title={t('batchDelete')}>
                        <Button
                            size="small"
                            danger
                            icon={<Trash2 size={12} />}
                            onClick={() => {
                                void deleteNodeAction(selectedIds, 'subtree');
                            }}
                        />
                    </Tooltip>

                    <Tooltip title={t('clearSelection')}>
                        <Button size="small" type="text" icon={<X size={12} />} onClick={clearSelection} />
                    </Tooltip>
                </div>
            </div>

            <Modal
                title={t('groupInChrome', 'Group in Browser')}
                open={groupModalOpen}
                onCancel={() => setGroupModalOpen(false)}
                onOk={() => {
                    void groupNodesInChrome(selectedIds, groupTitle, groupColor);
                    setGroupModalOpen(false);
                    clearSelection();
                }}
                width={320}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Input
                        value={groupTitle}
                        onChange={(e) => setGroupTitle(e.target.value)}
                        placeholder="Group title"
                    />
                    <Select
                        value={groupColor}
                        onChange={(val) => setGroupColor(val)}
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
        </>
    );
};
