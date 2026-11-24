import type { CollectionNode, LinkMapExportV2, TreeNode } from './types';

function formatTabText(node: Extract<TreeNode, { nodeType: 'tab' }>): string {
    const label = node.alias ? `${node.alias} | ${node.title}` : node.title;
    const url = node.url || node.pendingUrl || '';
    return url ? `${label} (${url})` : label;
}

function formatTabMarkdown(node: Extract<TreeNode, { nodeType: 'tab' }>): string {
    const url = node.url || node.pendingUrl || '';
    const safeTitle = (node.title || url || 'Untitled').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    const link = url ? `[${safeTitle}](${url})` : safeTitle;
    return node.alias ? `**${node.alias}** | ${link}` : link;
}

export function exportNodesToText(nodes: TreeNode[], level = 0): string {
    const lines: string[] = [];
    const indent = '    '.repeat(level);

    for (const node of nodes) {
        if (node.nodeType === 'tab') {
            lines.push(`${indent}${formatTabText(node)}`);
        } else if (node.nodeType === 'note') {
            lines.push(`${indent}${node.alias || node.title}`);
        } else {
            const label = node.alias ? `${node.alias} | ${node.title}` : node.title;
            lines.push(`${indent}${label}`);
        }

        if (node.children.length > 0) {
            lines.push(exportNodesToText(node.children, level + 1));
        }
    }

    return lines.filter(Boolean).join('\n');
}

export function exportNodesToMarkdown(nodes: TreeNode[], level = 0): string {
    const lines: string[] = [];
    const indent = '  '.repeat(level);

    for (const node of nodes) {
        if (node.nodeType === 'tab') {
            lines.push(`${indent}- ${formatTabMarkdown(node)}`);
        } else if (node.nodeType === 'note') {
            lines.push(`${indent}- ${node.alias || node.title}`);
        } else {
            const label = node.alias ? `${node.alias} | ${node.title}` : node.title;
            lines.push(`${indent}- **${label}**`);
        }

        if (node.children.length > 0) {
            lines.push(exportNodesToMarkdown(node.children, level + 1));
        }
    }

    return lines.filter(Boolean).join('\n');
}

export function buildExportV2Payload(
    nodes: TreeNode[],
    collections: CollectionNode[],
    version = '2.0.0',
): LinkMapExportV2 {
    return {
        schemaVersion: 2,
        version,
        exportedAt: new Date().toISOString(),
        nodes,
        collections,
    };
}
