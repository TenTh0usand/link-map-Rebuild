import React from 'react';
import { Checkbox, Popover, Segmented, Tooltip } from 'antd';
import {
    CheckSquare,
    ChevronsDownUp,
    ChevronsUpDown,
    Crosshair,
    FolderTree,
    Layers,
    MoreVertical,
    StickyNote,
} from 'lucide-react';

import type { OpenMode } from '../core/types';
import { t } from '../services/i18n';
import { useWorkspaceStore } from '../store/workspace-store';

export const OperationBar: React.FC<{ onScrollToNode?: (id: string) => void }> = ({
    onScrollToNode,
}) => {
    const activeView = useWorkspaceStore((s) => s.activeView);
    const setActiveView = useWorkspaceStore((s) => s.setActiveView);
    const multiSelectMode = useWorkspaceStore((s) => s.multiSelectMode);
    const setMultiSelectMode = useWorkspaceStore((s) => s.setMultiSelectMode);
    const settings = useWorkspaceStore((s) => s.settings);
    const updateSettings = useWorkspaceStore((s) => s.updateSettings);
    const expandAll = useWorkspaceStore((s) => s.expandAll);
    const collapseAll = useWorkspaceStore((s) => s.collapseAll);
    const locateActiveTab = useWorkspaceStore((s) => s.locateActiveTab);
    const focusedNodeId = useWorkspaceStore((s) => s.focusedNodeId);
    const insertNoteAction = useWorkspaceStore((s) => s.insertNoteAction);

    const handleLocate = async () => {
        const id = await locateActiveTab();
        if (id && onScrollToNode) {
            setTimeout(() => onScrollToNode(id), 40);
        }
    };

    const optionsContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 240 }}>
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    paddingBottom: 8,
                    borderBottom: '1px solid var(--lm-border)',
                }}
            >
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--lm-text-muted)' }}>
                    {t('defaultOpenMode')}
                </span>
                <Segmented
                    size="small"
                    block
                    value={settings.openMode}
                    onChange={(val) => void updateSettings({ openMode: val as OpenMode })}
                    options={[
                        { value: 'sidepanel', label: t('modeSidePanel') },
                        { value: 'window', label: t('modeWindow') },
                    ]}
                />
            </div>
            <Checkbox
                checked={settings.autoScrollToActiveTab}
                onChange={(e) => void updateSettings({ autoScrollToActiveTab: e.target.checked })}
            >
                <span style={{ fontSize: 12 }}>{t('autoScrollToActiveTab')}</span>
            </Checkbox>
            <Checkbox
                checked={settings.createNewTabByLevel}
                onChange={(e) => void updateSettings({ createNewTabByLevel: e.target.checked })}
            >
                <span style={{ fontSize: 12 }}>{t('createNewTabByLevel')}</span>
            </Checkbox>
            <Checkbox
                checked={settings.syncNativeTabGroups}
                onChange={(e) => void updateSettings({ syncNativeTabGroups: e.target.checked })}
            >
                <span style={{ fontSize: 12 }}>{t('syncNativeTabGroups')}</span>
            </Checkbox>
            <Checkbox
                checked={settings.compactMode}
                onChange={(e) => void updateSettings({ compactMode: e.target.checked })}
            >
                <span style={{ fontSize: 12 }}>{t('compactMode')}</span>
            </Checkbox>
        </div>
    );

    return (
        <div className="lm-opbar">
            <Segmented
                size="small"
                value={activeView}
                onChange={(val) => setActiveView(val as 'tree' | 'groups')}
                options={[
                    {
                        value: 'tree',
                        icon: <FolderTree size={12} style={{ verticalAlign: '-2px' }} />,
                        label: t('viewTree', 'Tree'),
                    },
                    {
                        value: 'groups',
                        icon: <Layers size={12} style={{ verticalAlign: '-2px' }} />,
                        label: t('viewGroups', 'Groups'),
                    },
                ]}
            />

            <div className="lm-opbar-actions">
                <Tooltip title={t('locate', 'Locate Active Tab')}>
                    <button
                        type="button"
                        className="lm-icon-btn"
                        onClick={() => void handleLocate()}
                    >
                        <Crosshair size={14} />
                    </button>
                </Tooltip>

                {activeView === 'tree' && (
                    <>
                        <Tooltip title={t('collapseAll', 'Collapse All')}>
                            <button type="button" className="lm-icon-btn" onClick={collapseAll}>
                                <ChevronsDownUp size={14} />
                            </button>
                        </Tooltip>

                        <Tooltip title={t('expandAll', 'Expand All')}>
                            <button type="button" className="lm-icon-btn" onClick={expandAll}>
                                <ChevronsUpDown size={14} />
                            </button>
                        </Tooltip>

                        <Tooltip title={t('newNote', 'New Note')}>
                            <button
                                type="button"
                                className="lm-icon-btn"
                                onClick={() =>
                                    insertNoteAction(
                                        focusedNodeId,
                                        focusedNodeId ? 'after' : 'root',
                                    )
                                }
                            >
                                <StickyNote size={14} />
                            </button>
                        </Tooltip>

                        <Tooltip title={t('multiSelect', 'Multi-Select')}>
                            <button
                                type="button"
                                className={`lm-icon-btn ${multiSelectMode ? 'is-active' : ''}`}
                                onClick={() => setMultiSelectMode(!multiSelectMode)}
                            >
                                <CheckSquare size={14} />
                            </button>
                        </Tooltip>
                    </>
                )}

                <Popover
                    content={optionsContent}
                    trigger="click"
                    placement="bottomRight"
                    arrow={false}
                >
                    <Tooltip title={t('options', 'Options')}>
                        <button type="button" className="lm-icon-btn">
                            <MoreVertical size={14} />
                        </button>
                    </Tooltip>
                </Popover>
            </div>
        </div>
    );
};
