import React, { useCallback, useImperativeHandle, useRef, useState } from 'react';
import { Empty } from 'antd';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { DropPosition, FlatVisibleNode, TreeNode } from '../core/types';
import { useWorkspaceStore } from '../store/workspace-store';
import { TreeRow } from './TreeRow';

export const LINK_MAP_DRAG_MIME = 'application/x-linkmap-node';

export interface VirtualTreeHandle {
    scrollToNode: (nodeId: string) => void;
}

interface VirtualTreeProps {
    rows: FlatVisibleNode[];
}

interface DragIndicator {
    targetId: string;
    position: DropPosition;
}

export const VirtualTree = React.forwardRef<VirtualTreeHandle, VirtualTreeProps>(
    ({ rows }, ref) => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const [dragIndicator, setDragIndicator] = useState<DragIndicator | null>(null);

        const compactMode = useWorkspaceStore((s) => s.settings.compactMode);
        const focusedNodeId = useWorkspaceStore((s) => s.focusedNodeId);
        const selectedIds = useWorkspaceStore((s) => s.selectedIds);
        const editingNodeId = useWorkspaceStore((s) => s.editingNodeId);
        const multiSelectMode = useWorkspaceStore((s) => s.multiSelectMode);
        const setFocusedNodeId = useWorkspaceStore((s) => s.setFocusedNodeId);
        const setEditingNodeId = useWorkspaceStore((s) => s.setEditingNodeId);
        const toggleSelect = useWorkspaceStore((s) => s.toggleSelect);
        const selectRange = useWorkspaceStore((s) => s.selectRange);
        const moveNodesByDrop = useWorkspaceStore((s) => s.moveNodesByDrop);
        const importExternalNodes = useWorkspaceStore((s) => s.importExternalNodes);

        const rowHeight = compactMode ? 24 : 28;

        const virtualizer = useVirtualizer({
            count: rows.length,
            getScrollElement: () => scrollRef.current,
            estimateSize: () => rowHeight,
            overscan: 12,
        });

        useImperativeHandle(
            ref,
            () => ({
                scrollToNode: (nodeId: string) => {
                    const idx = rows.findIndex((r) => r.node.id === nodeId);
                    if (idx >= 0) {
                        virtualizer.scrollToIndex(idx, { align: 'center' });
                    }
                },
            }),
            [rows, virtualizer],
        );

        const handleRowClick = useCallback(
            (e: React.MouseEvent, node: TreeNode) => {
                if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    if (multiSelectMode || selectedIds.length > 0) {
                        selectRange(node.id, rows);
                    } else {
                        setFocusedNodeId(node.id);
                        setEditingNodeId(node.id);
                    }
                    return;
                }
                setFocusedNodeId(node.id);
                if (e.ctrlKey || e.metaKey) {
                    toggleSelect(node.id, true);
                } else if (multiSelectMode) {
                    toggleSelect(node.id, true);
                }
            },
            [
                multiSelectMode,
                rows,
                selectRange,
                selectedIds.length,
                setEditingNodeId,
                setFocusedNodeId,
                toggleSelect,
            ],
        );

        const handleDragStartNode = useCallback(
            (e: React.DragEvent, node: TreeNode) => {
                const dragIds = selectedIds.includes(node.id) ? selectedIds : [node.id];
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData(
                    LINK_MAP_DRAG_MIME,
                    JSON.stringify({ source: 'tree', ids: dragIds }),
                );
                e.dataTransfer.setData('text/plain', node.alias || node.title);
            },
            [selectedIds],
        );

        const computeDropPos = (e: React.DragEvent): DropPosition => {
            const rect = e.currentTarget.getBoundingClientRect();
            const offsetY = e.clientY - rect.top;
            const ratio = offsetY / Math.max(1, rect.height);
            if (ratio < 0.26) return 'before';
            if (ratio > 0.74) return 'after';
            return 'inside';
        };

        const handleDragOverNode = useCallback((e: React.DragEvent, node: TreeNode) => {
            if (!e.dataTransfer.types.includes(LINK_MAP_DRAG_MIME)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const pos = computeDropPos(e);
            setDragIndicator((prev) =>
                prev?.targetId === node.id && prev.position === pos
                    ? prev
                    : { targetId: node.id, position: pos },
            );
        }, []);

        const handleDragLeaveNode = useCallback((node: TreeNode) => {
            setDragIndicator((prev) => (prev?.targetId === node.id ? null : prev));
        }, []);

        const handleDropOnNode = useCallback(
            (e: React.DragEvent, targetNode: TreeNode) => {
                e.preventDefault();
                const raw = e.dataTransfer.getData(LINK_MAP_DRAG_MIME);
                const pos = dragIndicator?.targetId === targetNode.id
                    ? dragIndicator.position
                    : computeDropPos(e);
                setDragIndicator(null);
                if (!raw) return;

                try {
                    const payload = JSON.parse(raw) as
                        | { source: 'tree'; ids: string[] }
                        | { source: 'import'; nodes: TreeNode[] };
                    if (payload.source === 'tree') {
                        void moveNodesByDrop(payload.ids, targetNode.id, pos);
                    } else if (payload.source === 'import') {
                        void importExternalNodes(payload.nodes, targetNode.id, pos);
                    }
                } catch {
                    // Ignore malformed drag payload
                }
            },
            [dragIndicator, importExternalNodes, moveNodesByDrop],
        );

        if (rows.length === 0) {
            return (
                <div
                    style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No matching tabs" />
                </div>
            );
        }

        const selectedSet = new Set(selectedIds);

        return (
            <div
                ref={scrollRef}
                className="lm-scroll"
                style={{ flex: 1, padding: '6px 4px 56px 4px' }}
                onDragLeave={(e) => {
                    if (e.currentTarget === e.target) setDragIndicator(null);
                }}
            >
                <div
                    style={{
                        height: virtualizer.getTotalSize(),
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {virtualizer.getVirtualItems().map((vRow) => {
                        const row = rows[vRow.index]!;
                        const node = row.node;
                        return (
                            <div
                                key={node.id}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    transform: `translateY(${vRow.start}px)`,
                                }}
                            >
                                <TreeRow
                                    row={row}
                                    rowHeight={rowHeight}
                                    isFocused={focusedNodeId === node.id}
                                    isSelected={selectedSet.has(node.id)}
                                    isEditing={editingNodeId === node.id}
                                    multiSelectMode={multiSelectMode}
                                    dropPosition={
                                        dragIndicator?.targetId === node.id
                                            ? dragIndicator.position
                                            : null
                                    }
                                    onRowClick={handleRowClick}
                                    onDragStartNode={handleDragStartNode}
                                    onDragOverNode={handleDragOverNode}
                                    onDragLeaveNode={handleDragLeaveNode}
                                    onDropOnNode={handleDropOnNode}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    },
);

VirtualTree.displayName = 'VirtualTree';
