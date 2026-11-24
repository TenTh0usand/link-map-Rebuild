import { describe, expect, it } from 'vitest';

import { filterTree } from '../search';
import {
    createNoteNode,
    createTabNodeFromLive,
    createWindowNodeFromLive,
} from '../tree-engine';

describe('search', () => {
    it('retains ancestor context and provides highlight match ranges for title and alias', () => {
        const win = createWindowNodeFromLive({
            id: 1,
            type: 'normal',
            incognito: false,
            focused: true,
            tabs: [],
        });
        const note = createNoteNode('Backend');
        const tabMatch = createTabNodeFromLive({
            id: 10,
            windowId: 1,
            groupId: -1,
            index: 0,
            title: 'Cloudflare R2 Documentation',
            url: 'https://developers.cloudflare.com/r2/',
            active: false,
            pinned: false,
        });
        tabMatch.alias = 'Storage';

        const tabOther = createTabNodeFromLive({
            id: 11,
            windowId: 1,
            groupId: -1,
            index: 1,
            title: 'Random Page',
            url: 'https://example.com',
            active: false,
            pinned: false,
        });

        note.children.push(tabMatch, tabOther);
        win.children.push(note);

        const rows = filterTree([win], 'cloudflare');
        expect(rows.map((r) => r.node.id)).toEqual([win.id, note.id, tabMatch.id]);
        expect(rows[2]!.matchRanges?.title).toEqual([{ start: 0, end: 10 }]);

        const aliasRows = filterTree([win], 'stor');
        expect(aliasRows.map((r) => r.node.id)).toEqual([win.id, note.id, tabMatch.id]);
        expect(aliasRows[2]!.matchRanges?.alias).toEqual([{ start: 0, end: 4 }]);
    });
});
