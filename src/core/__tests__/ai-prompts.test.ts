import { describe, expect, it } from 'vitest';

import {
    extractJsonFromLlmOutput,
    isDomainExcluded,
    normalizeOrganizeProposalResponse,
    normalizeReadlistCurationResponse,
    normalizeSiteDescriptionsResponse,
    normalizeWorkDigestResponse,
    prepareTabsForAi,
    sanitizeUrlForAi,
} from '../ai-prompts';
import type { TabNode } from '../types';

function makeTab(id: string, title: string, url: string): TabNode {
    return {
        id,
        nodeType: 'tab',
        title,
        url,
        index: 0,
        active: false,
        closed: false,
        expanded: true,
        children: [],
    };
}

describe('ai-prompts', () => {
    it('filters internal URLs and privacy-blacklisted domains correctly', () => {
        const blacklist = ['localhost', '192.168.', 'bank', 'alipay.com', 'mail.'];
        expect(isDomainExcluded('chrome://extensions', blacklist)).toBe(true);
        expect(isDomainExcluded('http://localhost:3000/admin', blacklist)).toBe(true);
        expect(isDomainExcluded('http://192.168.1.20/login', blacklist)).toBe(true);
        expect(isDomainExcluded('https://mail.google.com/mail/u/0/', blacklist)).toBe(true);
        expect(isDomainExcluded('https://auth.alipay.com/login', blacklist)).toBe(true);
        expect(isDomainExcluded('https://github.com/deepseek-ai/DeepSeek-V3', blacklist)).toBe(false);
        expect(isDomainExcluded('https://vite.dev/guide/', blacklist)).toBe(false);
    });

    it('sanitizes query params, fragments, and credentials from URLs', () => {
        expect(
            sanitizeUrlForAi('https://user:pass@example.com/docs/intro?token=secret#sec1', true),
        ).toBe('https://example.com/docs/intro');

        expect(
            sanitizeUrlForAi('https://example.com/search?q=linkmap#top', false),
        ).toBe('https://example.com/search?q=linkmap');
    });

    it('caps prepared tabs and reports privacy and truncation counts', () => {
        const tabs = [
            makeTab('t1', 'Chrome', 'chrome://settings'),
            makeTab('t2', 'Local', 'http://localhost:5173'),
            makeTab('t3', 'Repo 1', 'https://github.com/a?tab=readme'),
            makeTab('t4', 'Repo 2', 'https://github.com/b'),
            makeTab('t5', 'Repo 3', 'https://github.com/c'),
            makeTab('t6', 'Repo 4', 'https://github.com/d'),
            makeTab('t7', 'Repo 5', 'https://github.com/e'),
            makeTab('t8', 'Repo 6', 'https://github.com/f'),
        ];

        const prepared = prepareTabsForAi(tabs, {
            excludedDomains: ['localhost'],
            stripQueryParams: true,
            maxItemsPerRequest: 5,
        });

        expect(prepared.skippedPrivacyCount).toBe(2);
        expect(prepared.items).toHaveLength(5);
        expect(prepared.truncatedCount).toBe(1);
        expect(prepared.items[0]?.url).toBe('https://github.com/a');
    });

    it('extracts JSON from plain output, markdown fences, and DeepSeek think blocks', () => {
        expect(extractJsonFromLlmOutput<{ ok: boolean }>('{"ok": true}')).toEqual({ ok: true });

        const fenced = '<think>\nLet me reason...\n</think>\n```json\n{"headline":"Refactor"}\n```';
        expect(extractJsonFromLlmOutput<{ headline: string }>(fenced)).toEqual({
            headline: 'Refactor',
        });

        const wrapped = 'Sure! Here is your JSON: {"count": 2, "note": "a {braced} text"} Hope that helps.';
        expect(extractJsonFromLlmOutput<{ count: number; note: string }>(wrapped)).toEqual({
            count: 2,
            note: 'a {braced} text',
        });
    });

    it('defensively normalizes work digest, organize, readlist, and site description outputs', () => {
        const validIds = new Set(['t1', 't2']);
        const digest = normalizeWorkDigestResponse(
            {
                headline: 'Building Cloud Sync',
                progressSummary: 'Finished SigV4 signing',
                priorityTabIds: ['t1', 'hallucinated_id'],
                workstreams: [
                    { name: 'R2', status: 'Active', nextStep: 'Deploy Worker', tabIds: ['t1', 'fake'] },
                    { name: 'Empty', status: 'Done', nextStep: 'None', tabIds: ['fake2'] },
                ],
            },
            validIds,
            { scopeTitle: 'Open', model: 'deepseek-chat' },
        );
        expect(digest.priorityTabIds).toEqual(['t1']);
        expect(digest.workstreams).toHaveLength(1);
        expect(digest.workstreams[0]?.tabIds).toEqual(['t1']);

        const org = normalizeOrganizeProposalResponse(
            {
                summary: 'Grouped by project',
                proposedGroups: [
                    {
                        title: 'Dev',
                        category: 'invalid_cat',
                        color: 'not_a_color',
                        reason: 'Coding',
                        tabIds: ['t1', 't2', 't999'],
                    },
                ],
                duplicateTabs: [{ tabId: 't2', reason: 'Same URL' }, { tabId: 't999', reason: 'Bad' }],
            },
            validIds,
        );
        expect(org.proposedGroups[0]?.category).toBe('workspace');
        expect(org.proposedGroups[0]?.color).toBe('blue');
        expect(org.proposedGroups[0]?.tabIds).toEqual(['t1', 't2']);
        expect(org.duplicateTabs).toHaveLength(1);

        const tabMap = new Map<string, TabNode>([['t1', makeTab('t1', 'Docs', 'https://vite.dev')]]);
        const readlist = normalizeReadlistCurationResponse(
            {
                summary: 'Top reads',
                shelves: [
                    {
                        title: 'Frontend',
                        category: 'repo',
                        items: [
                            { tabId: 't1', oneLineGuide: 'Vite build docs', priority: 'high' },
                            { tabId: 'bad', oneLineGuide: 'Skip', priority: 'low' },
                        ],
                    },
                ],
            },
            tabMap,
        );
        expect(readlist.shelves[0]?.items).toHaveLength(1);
        expect(readlist.shelves[0]?.items[0]?.url).toBe('https://vite.dev');

        const urlLookup = new Map<string, string>([
            ['https://vite.dev/guide/', 'https://vite.dev/guide/'],
        ]);
        const descs = normalizeSiteDescriptionsResponse(
            {
                items: [
                    { url: 'https://vite.dev/guide/', description: '下一代前端构建工具文档', category: 'repo' },
                    { url: 'https://evil.invalid/', description: 'Should ignore' },
                ],
            },
            urlLookup,
        );
        expect(descs).toHaveLength(1);
        expect(descs[0]?.description).toBe('下一代前端构建工具文档');
    });
});
