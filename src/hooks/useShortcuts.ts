import { useEffect, type RefObject } from 'react';
import { App as AntdApp } from 'antd';

import type { FlatVisibleNode } from '../core/types';
import { findParentNode } from '../core/tree-engine';
import { t, isMacOS } from '../services/i18n';
import { useWorkspaceStore } from '../store/workspace-store';

export interface ShortcutDocItem {
    section: 'basic' | 'navigation' | 'notes';
    label: string;
    keys: string;
}

export function getShortcutDocs(globalShortcut: string): ShortcutDocItem[] {
    const mod = isMacOS() ? '⌘' : 'Ctrl';
    return [
        { section: 'basic', label: t('commandTriggerLinkMap', 'Open Link Map'), keys: globalShortcut || (isMacOS() ? '⌘+Shift+L' : 'Ctrl+Shift+L') },
        { section: 'basic', label: t('activeOrOpen', 'Activate / Open'), keys: 'Enter / Double-Click' },
        { section: 'basic', label: t('save', 'Lock / Save'), keys: `${mod}+S` },
        { section: 'basic', label: t('ctxMenuEdit', 'Edit Alias'), keys: 'Space / Shift+Click' },
        { section: 'basic', label: t('ctxMenuClose', 'Close & Save'), keys: `${mod}+Backspace` },
        { section: 'basic', label: t('ctxMenuDelete', 'Delete'), keys: `Shift+${mod}+Backspace` },
        { section: 'basic', label: t('ctxMenuCopyLink', 'Copy Link'), keys: `${mod}+C` },
        { section: 'navigation', label: t('search', 'Search'), keys: `${mod}+K` },
        { section: 'navigation', label: t('goToPreviousNode', 'Previous Node'), keys: '↑' },
        { section: 'navigation', label: t('goToNextNode', 'Next Node'), keys: '↓' },
        { section: 'navigation', label: t('goToParentNode', 'Parent Node'), keys: 'Backspace' },
        { section: 'navigation', label: t('expand', 'Expand'), keys: '→' },
        { section: 'navigation', label: t('collapse', 'Collapse'), keys: '←' },
        { section: 'navigation', label: t('expandAll', 'Expand All'), keys: `Shift+${mod}+]` },
        { section: 'navigation', label: t('collapseAll', 'Collapse All'), keys: `Shift+${mod}+[` },
        { section: 'notes', label: t('ctxMenuNotesCreateAfter', 'Insert Note After'), keys: 'Enter (on Note)' },
        { section: 'notes', label: t('ctxMenuNotesCreateAsLastSubNode', 'Insert Child Note'), keys: `${mod}+Enter` },
        { section: 'notes', label: t('ctxMenuNotesCreateAsParent', 'Insert Parent Note'), keys: `Shift+${mod}+Enter` },
    ];
}

export function useWorkspaceShortcuts(
    searchInputRef: RefObject<HTMLInputElement | null>,
    visibleRows: FlatVisibleNode[],
) {
    const { message } = AntdApp.useApp();

    useEffect(() => {
        const isTypingTarget = (el: EventTarget | null) => {
            if (!(el instanceof HTMLElement)) return false;
            const tag = el.tagName.toLowerCase();
            return tag === 'input' || tag === 'textarea' || el.isContentEditable;
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            const state = useWorkspaceStore.getState();
            const mod = isMacOS() ? e.metaKey : e.ctrlKey;

            // Global search shortcut works even while browsing tree
            if (mod && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
                return;
            }

            if (state.settingsModalOpen || state.editingNodeId) return;
            if (isTypingTarget(e.target)) return;

            if (e.key === 'Escape') {
                if (state.selectedIds.length > 0) {
                    state.clearSelection();
                } else if (state.searchQuery) {
                    state.setSearchQuery('');
                }
                return;
            }

            if (state.activeView !== 'tree') return;

            if (mod && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                state.selectAllVisible(visibleRows);
                return;
            }

            if (mod && e.shiftKey && e.key === ']') {
                e.preventDefault();
                state.expandAll();
                return;
            }

            if (mod && e.shiftKey && e.key === '[') {
                e.preventDefault();
                state.collapseAll();
                return;
            }

            const currentIdx = visibleRows.findIndex((r) => r.node.id === state.focusedNodeId);
            const focusedRow = currentIdx >= 0 ? visibleRows[currentIdx] : undefined;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const next = visibleRows[Math.min(visibleRows.length - 1, currentIdx + 1)];
                if (next) state.setFocusedNodeId(next.node.id);
                return;
            }

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prev =
                    currentIdx === -1
                        ? visibleRows[0]
                        : visibleRows[Math.max(0, currentIdx - 1)];
                if (prev) state.setFocusedNodeId(prev.node.id);
                return;
            }

            if (!focusedRow) return;
            const node = focusedRow.node;

            if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (node.children.length > 0 && !node.expanded) {
                    state.toggleExpand(node.id);
                } else if (node.children.length > 0 && node.expanded) {
                    state.setFocusedNodeId(node.children[0]!.id);
                }
                return;
            }

            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (node.children.length > 0 && node.expanded) {
                    state.toggleExpand(node.id);
                } else if (focusedRow.parentId) {
                    state.setFocusedNodeId(focusedRow.parentId);
                }
                return;
            }

            if (e.key === 'Backspace' && !mod && !e.shiftKey) {
                e.preventDefault();
                const parent = findParentNode(state.nodes, node.id);
                if (parent) state.setFocusedNodeId(parent.id);
                return;
            }

            if (e.key === ' ' && !mod) {
                e.preventDefault();
                state.setEditingNodeId(node.id);
                return;
            }

            if (mod && e.key.toLowerCase() === 's') {
                e.preventDefault();
                const targets = state.selectedIds.length > 0 ? state.selectedIds : [node.id];
                state.toggleSaveAction(targets);
                return;
            }

            if (mod && e.shiftKey && e.key === 'Backspace') {
                e.preventDefault();
                const targets = state.selectedIds.length > 0 ? state.selectedIds : [node.id];
                const nextFocus =
                    visibleRows[currentIdx + 1]?.node.id ??
                    visibleRows[currentIdx - 1]?.node.id ??
                    null;
                void state.deleteNodeAction(targets, 'auto');
                state.setFocusedNodeId(nextFocus);
                return;
            }

            if (mod && !e.shiftKey && e.key === 'Backspace') {
                e.preventDefault();
                const targets = state.selectedIds.length > 0 ? state.selectedIds : [node.id];
                void state.closeNodeAction(targets, 'auto');
                return;
            }

            if (mod && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                if (state.selectedIds.length > 1) {
                    void state.copySubtreeMarkdown(state.selectedIds);
                } else {
                    void state.copyNodeLink(node.id);
                }
                void message.success('Copied', 1);
                return;
            }

            if (mod && e.shiftKey && e.key === 'Enter') {
                e.preventDefault();
                state.insertNoteAction(node.id, 'parent');
                return;
            }

            if (mod && e.key === 'Enter') {
                e.preventDefault();
                state.insertNoteAction(node.id, 'lastChild');
                return;
            }

            if (e.key === 'Enter' && !mod) {
                e.preventDefault();
                if (node.nodeType === 'note') {
                    state.insertNoteAction(node.id, 'after');
                } else {
                    void state.openOrActivateNode(node.id);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [message, searchInputRef, visibleRows]);
}
