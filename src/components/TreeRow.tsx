import React, { useEffect, useRef, useState } from 'react';
import { App as AntdApp, Checkbox, Dropdown, Input, Modal, Tooltip, type MenuProps } from 'antd';
import {
    ChevronDown,
    ChevronRight,
    Copy,
    FolderPlus,
    Layers,
    Lock,
    Pencil,
    Share2,
    Sparkles,
    StickyNote,
    Trash2,
    Ungroup,
    XCircle,
} from 'lucide-react';

import { normalizeSiteUrl } from '../core/categorizer';

import {
    TAB_GROUP_COLOR_HEX,
    type DropPosition,
    type FlatVisibleNode,
    type MatchRange,
    type TreeNode,
} from '../core/types';
import { getFaviconUrl } from '../services/browser-bridge';
import { t } from '../services/i18n';
import { useWorkspaceStore } from '../store/workspace-store';

function renderHighlightedText(text: string, ranges?: MatchRange[]): React.ReactNode {
    if (!ranges || ranges.length === 0) return text;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i]!;
        if (r.start > cursor) {
            parts.push(text.slice(cursor, r.start));
        }
        parts.push(
            <mark key={`${r.start}-${i}`} className="lm-mark">
                {text.slice(r.start, r.end)}
            </mark>,
        );
        cursor = r.end;
    }
    if (cursor < text.length) parts.push(text.slice(cursor));
    return parts;
}

export interface TreeRowProps {
    row: FlatVisibleNode;
    rowHeight: number;
    isFocused: boolean;
    isSelected: boolean;
    isEditing: boolean;
    multiSelectMode: boolean;
    dropPosition: DropPosition | null;
    onRowClick: (e: React.MouseEvent, node: TreeNode) => void;
    onDragStartNode: (e: React.DragEvent, node: TreeNode) => void;
    onDragOverNode: (e: React.DragEvent, node: TreeNode) => void;
    onDragLeaveNode: (node: TreeNode) => void;
    onDropOnNode: (e: React.DragEvent, node: TreeNode) => void;
}

export const TreeRow: React.FC<TreeRowProps> = React.memo(
    ({
        row,
        rowHeight,
        isFocused,
        isSelected,
        isEditing,
        multiSelectMode,
        dropPosition,
        onRowClick,
        onDragStartNode,
        onDragOverNode,
        onDragLeaveNode,
        onDropOnNode,
    }) => {
        const { message } = AntdApp.useApp();
        const { node, depth, hasChildren, matchRanges } = row;
        const collections = useWorkspaceStore((s) => s.collections);
        const toggleExpand = useWorkspaceStore((s) => s.toggleExpand);
        const toggleSelect = useWorkspaceStore((s) => s.toggleSelect);
        const openOrActivateNode = useWorkspaceStore((s) => s.openOrActivateNode);
        const closeNodeAction = useWorkspaceStore((s) => s.closeNodeAction);
        const deleteNodeAction = useWorkspaceStore((s) => s.deleteNodeAction);
        const toggleSaveAction = useWorkspaceStore((s) => s.toggleSaveAction);
        const renameAliasAction = useWorkspaceStore((s) => s.renameAliasAction);
        const setEditingNodeId = useWorkspaceStore((s) => s.setEditingNodeId);
        const insertNoteAction = useWorkspaceStore((s) => s.insertNoteAction);
        const copyNodeLink = useWorkspaceStore((s) => s.copyNodeLink);
        const copyNodeMarkdown = useWorkspaceStore((s) => s.copyNodeMarkdown);
        const copySubtreeText = useWorkspaceStore((s) => s.copySubtreeText);
        const copySubtreeMarkdown = useWorkspaceStore((s) => s.copySubtreeMarkdown);
        const groupNodesInChrome = useWorkspaceStore((s) => s.groupNodesInChrome);
        const ungroupTabGroup = useWorkspaceStore((s) => s.ungroupTabGroup);
        const addNodesToCollection = useWorkspaceStore((s) => s.addNodesToCollection);
        const createCollection = useWorkspaceStore((s) => s.createCollection);
        const setShareModalTarget = useWorkspaceStore((s) => s.setShareModalTarget);
        const saveSiteDescription = useWorkspaceStore((s) => s.saveSiteDescription);
        const siteMetaMap = useWorkspaceStore((s) => s.siteMetaMap);

        const initialEditVal =
            node.nodeType === 'note' ? node.alias || node.title : node.alias || '';
        const [draftAlias, setDraftAlias] = useState(initialEditVal);
        const [iconFailed, setIconFailed] = useState(false);
        const [descModalOpen, setDescModalOpen] = useState(false);
        const [draftDesc, setDraftDesc] = useState('');
        const editInputRef = useRef<HTMLInputElement | null>(null);

        useEffect(() => {
            if (isEditing) {
                setDraftAlias(node.nodeType === 'note' ? node.alias || node.title : node.alias || '');
                setTimeout(() => {
                    editInputRef.current?.focus();
                    editInputRef.current?.select();
                }, 10);
            }
        }, [isEditing, node.alias, node.nodeType, node.title]);

        const commitEdit = () => {
            renameAliasAction(node.id, draftAlias);
        };

        const cancelEdit = () => {
            setEditingNodeId(null);
        };

        const savedSiteDesc =
            node.nodeType === 'tab'
                ? siteMetaMap[normalizeSiteUrl(node.url || node.pendingUrl || '')]?.description ||
                  node.description ||
                  ''
                : '';

        const tabTooltip =
            node.nodeType === 'tab'
                ? `${node.title}${savedSiteDesc ? `\n${savedSiteDesc}` : ''}\n${node.url || node.pendingUrl || ''}`
                : node.title;

        const isTabActive = node.nodeType === 'tab' && node.active && !node.closed;
        const isClosed = Boolean(node.closed);

        const triggerShare = () => {
            if (node.nodeType === 'tab') {
                setShareModalTarget({ mode: 'single', tab: node });
            } else {
                setShareModalTarget({
                    mode: 'group',
                    title: node.alias || node.title || 'Shared Group',
                    color: 'color' in node ? node.color : undefined,
                    nodes: [node],
                });
            }
        };

        const contextMenuItems: MenuProps['items'] = [
            {
                key: 'share',
                label: node.nodeType === 'tab' ? t('shareSingleCard') : t('shareGroup'),
                icon: <Share2 size={13} />,
                onClick: triggerShare,
            },
            ...(node.nodeType === 'tab'
                ? [
                      {
                          key: 'edit-desc',
                          label: t('editDescription'),
                          icon: <Sparkles size={13} />,
                          onClick: () => {
                              const existing =
                                  siteMetaMap[normalizeSiteUrl(node.url || node.pendingUrl || '')]
                                      ?.description ||
                                  node.description ||
                                  '';
                              setDraftDesc(existing);
                              setDescModalOpen(true);
                          },
                      },
                  ]
                : []),
            {
                key: 'save',
                label: node.saved ? 'Unlock / Unsave' : t('save', 'Lock / Save'),
                icon: <Lock size={13} />,
                onClick: () => toggleSaveAction([node.id]),
            },
            {
                key: 'edit',
                label: t('ctxMenuEdit', 'Edit Alias'),
                icon: <Pencil size={13} />,
                onClick: () => setEditingNodeId(node.id),
            },
            {
                key: 'close-sub',
                label: t('ctxMenuClose', 'Close & Save'),
                icon: <XCircle size={13} />,
                children: [
                    {
                        key: 'close-item',
                        label: t('closeNode', 'Close & Save Node'),
                        onClick: () => void closeNodeAction([node.id], 'item'),
                    },
                    {
                        key: 'close-tree',
                        label: t('closeSubtree', 'Close & Save Subtree'),
                        onClick: () => void closeNodeAction([node.id], 'subtree'),
                    },
                ],
            },
            {
                key: 'delete-sub',
                label: t('ctxMenuDelete', 'Delete'),
                icon: <Trash2 size={13} />,
                danger: true,
                children: [
                    {
                        key: 'delete-item',
                        label: t('deleteNode', 'Delete Node Only'),
                        onClick: () => void deleteNodeAction([node.id], 'item'),
                    },
                    {
                        key: 'delete-tree',
                        label: t('deleteSubtree', 'Delete Subtree'),
                        danger: true,
                        onClick: () => void deleteNodeAction([node.id], 'subtree'),
                    },
                ],
            },
            { type: 'divider' },
            ...(node.nodeType === 'tabGroup'
                ? [
                      {
                          key: 'ungroup',
                          label: t('ungroupInChrome', 'Ungroup'),
                          icon: <Ungroup size={13} />,
                          onClick: () => void ungroupTabGroup(node.id),
                      },
                  ]
                : [
                      {
                          key: 'group-chrome',
                          label: t('groupInChrome', 'Group in Browser'),
                          icon: <Layers size={13} />,
                          onClick: () =>
                              void groupNodesInChrome(
                                  [node.id],
                                  node.alias || node.title || 'Group',
                                  'blue',
                              ),
                      },
                  ]),
            {
                key: 'add-collection',
                label: t('moveToCollection', 'Add to Tab Group'),
                icon: <FolderPlus size={13} />,
                children: [
                    ...collections.map((c) => ({
                        key: `col-${c.id}`,
                        label: c.title,
                        onClick: () => {
                            addNodesToCollection(c.id, [node.id]);
                            void message.success(`Added to ${c.title}`, 1.2);
                        },
                    })),
                    ...(collections.length > 0 ? [{ type: 'divider' as const }] : []),
                    {
                        key: 'col-new',
                        label: `+ ${t('newCollection', 'New Tab Group')}`,
                        onClick: () => {
                            const name = node.alias || node.title || `Group ${collections.length + 1}`;
                            createCollection(name, 'blue', 'workspace');
                            const latest = useWorkspaceStore.getState().collections[0];
                            if (latest) {
                                addNodesToCollection(latest.id, [node.id]);
                                void message.success(`Added to ${latest.title}`, 1.2);
                            }
                        },
                    },
                ],
            },
            {
                key: 'notes-sub',
                label: t('ctxMenuNotes', 'Notes'),
                icon: <StickyNote size={13} />,
                children: [
                    {
                        key: 'note-parent',
                        label: t('ctxMenuNotesCreateAsParent'),
                        onClick: () => insertNoteAction(node.id, 'parent'),
                    },
                    {
                        key: 'note-first',
                        label: t('ctxMenuNotesCreateAsFirstSubNode'),
                        onClick: () => insertNoteAction(node.id, 'firstChild'),
                    },
                    {
                        key: 'note-last',
                        label: t('ctxMenuNotesCreateAsLastSubNode'),
                        onClick: () => insertNoteAction(node.id, 'lastChild'),
                    },
                ],
            },
            {
                key: 'copy-sub',
                label: t('ctxMenuCopy', 'Copy'),
                icon: <Copy size={13} />,
                children: [
                    ...(node.nodeType === 'tab'
                        ? [
                              {
                                  key: 'copy-url',
                                  label: t('ctxMenuCopyLink'),
                                  onClick: () => {
                                      void copyNodeLink(node.id);
                                      void message.success('Link copied', 1);
                                  },
                              },
                              {
                                  key: 'copy-md',
                                  label: t('ctxMenuCopyMarkDownLink'),
                                  onClick: () => {
                                      void copyNodeMarkdown(node.id);
                                      void message.success('Markdown copied', 1);
                                  },
                              },
                          ]
                        : []),
                    {
                        key: 'copy-subtree-txt',
                        label: t('copySubtreeAsText'),
                        onClick: () => {
                            void copySubtreeText([node.id]);
                            void message.success('Subtree TXT copied', 1);
                        },
                    },
                    {
                        key: 'copy-subtree-md',
                        label: t('copySubtreeAsMarkdown'),
                        onClick: () => {
                            void copySubtreeMarkdown([node.id]);
                            void message.success('Subtree Markdown copied', 1);
                        },
                    },
                ],
            },
        ];

        const renderIcon = () => {
            if (node.nodeType === 'note') {
                return <span className="lm-note-dot" />;
            }
            if (node.nodeType === 'tabGroup') {
                return (
                    <span
                        className="lm-group-dot"
                        style={{ backgroundColor: TAB_GROUP_COLOR_HEX[node.color] }}
                    />
                );
            }
            if (node.nodeType === 'collection') {
                return (
                    <span
                        className="lm-group-dot"
                        style={{ backgroundColor: TAB_GROUP_COLOR_HEX[node.color] }}
                    />
                );
            }
            if (node.nodeType === 'window') {
                return (
                    <span className="lm-favicon-wrap">
                        <img src="/icons/chrome_icon.svg" alt="" />
                    </span>
                );
            }
            const rawIcon = iconFailed
                ? '/icons/chrome_icon.svg'
                : node.favIconUrl || getFaviconUrl(node.url || node.pendingUrl || '');
            return (
                <span className="lm-favicon-wrap">
                    <img
                        src={rawIcon}
                        alt=""
                        loading="lazy"
                        onError={() => setIconFailed(true)}
                    />
                </span>
            );
        };

        const dropClass = dropPosition ? `drop-${dropPosition}` : '';

        return (
            <>
                <Dropdown menu={{ items: contextMenuItems }} trigger={['contextMenu']}>
                <div
                    className={`lm-tree-row ${isClosed ? 'is-closed' : ''} ${isFocused ? 'is-focused' : ''} ${isSelected ? 'is-selected' : ''} ${dropClass}`}
                    style={{ height: rowHeight, paddingLeft: 6 }}
                    draggable={!isEditing}
                    onClick={(e) => onRowClick(e, node)}
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (!isEditing) void openOrActivateNode(node.id);
                    }}
                    onDragStart={(e) => onDragStartNode(e, node)}
                    onDragOver={(e) => onDragOverNode(e, node)}
                    onDragLeave={() => onDragLeaveNode(node)}
                    onDrop={(e) => onDropOnNode(e, node)}
                >
                    {Array.from({ length: depth }).map((_, idx) => (
                        <span key={idx} className="lm-indent-guide" style={{ width: 16 }} />
                    ))}

                    <span
                        className="lm-expander"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (hasChildren) toggleExpand(node.id);
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

                    {multiSelectMode && (
                        <Checkbox
                            checked={isSelected}
                            style={{ marginRight: 5 }}
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleSelect(node.id, true);
                            }}
                        />
                    )}

                    {renderIcon()}

                    {isEditing ? (
                        <input
                            ref={editInputRef}
                            value={draftAlias}
                            onChange={(e) => setDraftAlias(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter') commitEdit();
                                if (e.key === 'Escape') cancelEdit();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                flex: 1,
                                minWidth: 80,
                                height: 20,
                                padding: '0 6px',
                                fontSize: 12,
                                borderRadius: 4,
                                border: '1px solid var(--lm-primary)',
                                backgroundColor: 'var(--lm-bg-elevated)',
                                color: 'var(--lm-text)',
                                outline: 'none',
                            }}
                        />
                    ) : (
                        <Tooltip title={tabTooltip} mouseEnterDelay={0.8} placement="left">
                            <div
                                className={`lm-row-label ${isClosed ? 'is-closed' : ''} ${isTabActive ? 'is-tab-active' : ''}`}
                            >
                                {node.nodeType === 'note' ? (
                                    <span className="lm-row-alias">
                                        {renderHighlightedText(
                                            node.alias || node.title,
                                            matchRanges?.alias ?? matchRanges?.title,
                                        )}
                                    </span>
                                ) : (
                                    <>
                                        {node.alias && (
                                            <>
                                                <span className="lm-row-alias">
                                                    {renderHighlightedText(
                                                        node.alias,
                                                        matchRanges?.alias,
                                                    )}
                                                </span>
                                                <span className="lm-row-splitter">|</span>
                                            </>
                                        )}
                                        <span
                                            className={
                                                node.alias ? 'lm-row-title-muted' : undefined
                                            }
                                        >
                                            {renderHighlightedText(node.title, matchRanges?.title)}
                                            {node.nodeType === 'window' && node.closed
                                                ? ' (closed)'
                                                : ''}
                                        </span>
                                    </>
                                )}
                            </div>
                        </Tooltip>
                    )}

                    {node.saved && (
                        <Lock
                            size={11}
                            style={{
                                color: 'var(--lm-primary)',
                                flexShrink: 0,
                                marginLeft: 4,
                            }}
                        />
                    )}

                    {(node.nodeType === 'window' || node.nodeType === 'tabGroup') &&
                        node.children.length > 0 && (
                            <span className="lm-row-badge">{node.children.length}</span>
                        )}

                    {!isEditing && (
                        <div className="lm-row-actions" onClick={(e) => e.stopPropagation()}>
                            <button
                                type="button"
                                className="lm-row-action-btn"
                                title={t('share', 'Share')}
                                onClick={triggerShare}
                            >
                                <Share2 size={12} />
                            </button>
                            <button
                                type="button"
                                className="lm-row-action-btn"
                                title={t('ctxMenuEdit')}
                                onClick={() => setEditingNodeId(node.id)}
                            >
                                <Pencil size={12} />
                            </button>
                            <button
                                type="button"
                                className="lm-row-action-btn"
                                title={t('ctxMenuClose')}
                                onClick={() => void closeNodeAction([node.id], 'auto')}
                            >
                                <XCircle size={12} />
                            </button>
                            <button
                                type="button"
                                className="lm-row-action-btn is-danger"
                                title={t('ctxMenuDelete')}
                                onClick={() => void deleteNodeAction([node.id], 'auto')}
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                    )}
                </div>
            </Dropdown>
            {descModalOpen && node.nodeType === 'tab' && (
                <Modal
                    title={t('editDescription')}
                    open
                    onCancel={() => setDescModalOpen(false)}
                    onOk={() => {
                        void saveSiteDescription(
                            node.url || node.pendingUrl || '',
                            draftDesc,
                        );
                        setDescModalOpen(false);
                        void message.success('Saved', 1);
                    }}
                    width={380}
                >
                    <Input.TextArea
                        rows={3}
                        value={draftDesc}
                        onChange={(e) => setDraftDesc(e.target.value)}
                        placeholder={t('descriptionPlaceholder')}
                    />
                </Modal>
            )}
            </>
        );
    },
);

TreeRow.displayName = 'TreeRow';
