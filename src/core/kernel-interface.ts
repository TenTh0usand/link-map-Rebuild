import type {
    DropPosition,
    FlatVisibleNode,
    LiveTabGroupDTO,
    LiveWindowDTO,
    TreeNode,
} from './types';

export interface ReconcileOptions {
    syncNativeTabGroups: boolean;
}

export interface MoveResult {
    nodes: TreeNode[];
    affectedWindowIds: string[];
    movedOpenTabIds: number[];
    targetBrowserWindowId?: number;
    targetBrowserGroupId?: number;
}

/**
 * Pure tree computation boundary.
 * Phase 1 provides the pure TypeScript implementation in src/core/tree-engine.ts.
 * Heavy operations (large-scale tree search, CRDT diff/merge) can be swapped
 * with a Rust/WASM implementation behind this contract later without touching React or Chrome APIs.
 */
export interface ITreeKernel {
    flattenVisible(nodes: TreeNode[]): FlatVisibleNode[];
    searchTree(nodes: TreeNode[], query: string): FlatVisibleNode[];
    moveNodes(
        nodes: TreeNode[],
        sourceIds: string[],
        targetId: string,
        position: DropPosition,
    ): MoveResult;
    reconcileSnapshotWithLive(
        snapshotNodes: TreeNode[],
        liveWindows: LiveWindowDTO[],
        liveGroups: LiveTabGroupDTO[],
        options: ReconcileOptions,
    ): TreeNode[];
    exportMarkdown(nodes: TreeNode[]): string;
    exportText(nodes: TreeNode[]): string;
}
