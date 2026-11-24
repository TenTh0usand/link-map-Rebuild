import type { FlatVisibleNode, MatchRange, TreeNode } from './types';

function findMatchRanges(text: string, query: string): MatchRange[] | undefined {
    if (!text) return undefined;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // Exact substring match first
    const idx = lowerText.indexOf(lowerQuery);
    if (idx !== -1) {
        return [{ start: idx, end: idx + lowerQuery.length }];
    }

    // Ordered character fuzzy fallback (e.g. "gh" -> "GitHub")
    const ranges: MatchRange[] = [];
    let qIdx = 0;
    for (let i = 0; i < lowerText.length && qIdx < lowerQuery.length; i++) {
        if (lowerText[i] === lowerQuery[qIdx]) {
            const last = ranges[ranges.length - 1];
            if (last && last.end === i) {
                last.end = i + 1;
            } else {
                ranges.push({ start: i, end: i + 1 });
            }
            qIdx++;
        }
    }
    return qIdx === lowerQuery.length ? ranges : undefined;
}

/**
 * Filters a tree by query, keeping matched nodes AND their ancestor chain visible
 * so search results retain window/group context.
 */
export function filterTree(nodes: TreeNode[], rawQuery: string): FlatVisibleNode[] {
    const query = rawQuery.trim();
    if (!query) return [];

    const out: FlatVisibleNode[] = [];

    const visit = (
        list: TreeNode[],
        depth: number,
        parentId: string | null,
        ancestorIds: string[],
    ): FlatVisibleNode[] => {
        const matchedAtThisLevel: FlatVisibleNode[] = [];

        for (const node of list) {
            const titleRanges = findMatchRanges(node.title, query);
            const aliasRanges = node.alias ? findMatchRanges(node.alias, query) : undefined;
            const urlMatch =
                node.nodeType === 'tab' &&
                node.url.toLowerCase().includes(query.toLowerCase());

            const selfMatched = Boolean(titleRanges || aliasRanges || urlMatch);
            const matchedDescendants = visit(node.children, depth + 1, node.id, [
                ...ancestorIds,
                node.id,
            ]);

            if (selfMatched || matchedDescendants.length > 0) {
                matchedAtThisLevel.push({
                    node,
                    depth,
                    parentId,
                    ancestorIds,
                    hasChildren: node.children.length > 0,
                    matchRanges:
                        titleRanges || aliasRanges
                            ? { title: titleRanges, alias: aliasRanges }
                            : undefined,
                });
                matchedAtThisLevel.push(...matchedDescendants);
            }
        }
        return matchedAtThisLevel;
    };

    out.push(...visit(nodes, 0, null, []));
    return out;
}
