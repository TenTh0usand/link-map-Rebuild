import { describe, expect, it } from 'vitest';

import { exportNodesToMarkdown, exportNodesToText } from '../exporter';
import {
    createCollectionNode,
    createNoteNode,
    createTabGroupNodeFromLive,
    createTabNodeFromLive,
    createWindowNodeFromLive,
} from '../tree-engine';

describe('exporter', () => {
    it('exports mixed window, tabGroup, note, collection, and tab nodes cleanly without undefined', () => {
        const win = createWindowNodeFromLive({
            id: 1,
            type: 'normal',
            incognito: false,
            focused: true,
            tabs: [],
        });
        const grp = createTabGroupNodeFromLive({
            id: 2,
            windowId: 1,
            title: 'Docs',
            color: 'blue',
            collapsed: false,
        });
        const note = createNoteNode('Must Read');
        const tabA = createTabNodeFromLive({
            id: 10,
            windowId: 1,
            groupId: 2,
            index: 0,
            title: 'React Docs',
            url: 'https://react.dev',
            active: false,
            pinned: false,
        });
        tabA.alias = 'Core';
        const col = createCollectionNode('Readlist', 'green', 'readlist', [tabA]);

        grp.children.push(note);
        win.children.push(grp);

        const md = exportNodesToMarkdown([win, col]);
        expect(md).not.toContain('undefined');
        expect(md).toContain('- **Window**');
        expect(md).toContain('  - **Docs**');
        expect(md).toContain('    - Must Read');
        expect(md).toContain('- **Readlist**');
        expect(md).toContain('  - **Core** | [React Docs](https://react.dev)');

        const txt = exportNodesToText([win, col]);
        expect(txt).not.toContain('undefined');
        expect(txt).toContain('Window');
        expect(txt).toContain('    Docs');
        expect(txt).toContain('        Must Read');
        expect(txt).toContain('    Core | React Docs (https://react.dev)');
    });
});
