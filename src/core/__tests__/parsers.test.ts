import { describe, expect, it } from 'vitest';

import { parseLinkMapJson } from '../parsers/link-map-v1';
import { isTabsOutlinerExport, parseTabsOutlinerData, type TabsOutlinerEntry } from '../parsers/tabs-outliner';

describe('parsers', () => {
    it('parses legacy Link Map v1 JSON export and unescapes entities', () => {
        const legacyPayload = {
            version: '1.0.11',
            exportTime: '2026-01-01 10_00_00',
            rawData: [
                {
                    key: '1',
                    title: 'Window',
                    expanded: true,
                    data: { nodeType: 'window', type: 'normal', save: true },
                    children: [
                        {
                            key: '100',
                            title: 'Cats &amp; Dogs &lt;Test&gt;',
                            expanded: true,
                            data: {
                                nodeType: 'tab',
                                url: 'https://example.com',
                                alias: 'Pet &quot;Guide&quot;',
                                closed: false,
                                save: true,
                            },
                            children: [],
                        },
                        {
                            key: 'note_1',
                            title: '',
                            expanded: true,
                            data: { nodeType: 'note', alias: 'Section Note' },
                            children: [],
                        },
                    ],
                },
            ],
        };

        const parsed = parseLinkMapJson(legacyPayload);
        expect(parsed.exportTime).toBe('2026-01-01 10_00_00');
        expect(parsed.nodes).toHaveLength(1);

        const win = parsed.nodes[0]!;
        expect(win.nodeType).toBe('window');
        expect(win.closed).toBe(true);
        expect(win.saved).toBe(true);

        const tab = win.children[0]!;
        expect(tab.nodeType).toBe('tab');
        expect(tab.title).toBe('Cats & Dogs <Test>');
        expect(tab.alias).toBe('Pet "Guide"');
        expect(tab.closed).toBe(true);

        const note = win.children[1]!;
        expect(note.nodeType).toBe('note');
        expect(note.title).toBe('Section Note');
    });

    it('round-trips Link Map v2 export payload with closed live state reset', () => {
        const v2Payload = {
            schemaVersion: 2,
            version: '2.0.0',
            exportedAt: '2026-11-24T10:00:00.000Z',
            nodes: [
                {
                    id: 'old_win',
                    nodeType: 'window',
                    title: 'Window',
                    browserWindowId: 99,
                    closed: false,
                    expanded: true,
                    children: [],
                },
            ],
            collections: [
                {
                    id: 'old_col',
                    nodeType: 'collection',
                    title: 'Readlist',
                    color: 'blue',
                    category: 'readlist',
                    expanded: true,
                    saved: true,
                    children: [],
                },
            ],
        };

        const parsed = parseLinkMapJson(v2Payload);
        expect(parsed.nodes[0]!.closed).toBe(true);
        expect(parsed.nodes[0]!.id).not.toBe('old_win');
        expect(parsed.collections).toHaveLength(1);
        expect(parsed.collections[0]!.title).toBe('Readlist');
    });

    it('parses Tabs Outliner .tree export structure', () => {
        const raw: TabsOutlinerEntry[] = [
            { type: 1, node: { type: 'session', data: { treeId: 1 } } },
            [10, { type: 'savedwin', marks: { customTitle: 'Work Win' }, data: { type: 'normal' } }, [0]],
            [11, { type: 'textnote', data: { note: 'Research' } }, [0, 0]],
            [12, { type: 'tab', data: { title: 'GitHub', url: 'https://github.com' } }, [0, 0, 0]],
            [13, { type: 'separatorline', data: {} }, [0, 1]],
            { type: 11111, time: 1700000000 },
        ];

        expect(isTabsOutlinerExport(raw)).toBe(true);
        const nodes = parseTabsOutlinerData(raw);
        expect(nodes).toHaveLength(1);
        expect(nodes[0]!.nodeType).toBe('window');
        expect(nodes[0]!.alias).toBe('Work Win');
        expect(nodes[0]!.children[0]!.nodeType).toBe('note');
        expect(nodes[0]!.children[0]!.children[0]!.nodeType).toBe('tab');
        expect(nodes[0]!.children[1]!.nodeType).toBe('note');
    });
});
