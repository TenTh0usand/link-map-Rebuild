import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SiteMetaRecord, TabNode } from '../../core/types';
import {
    generateSiteDescriptions,
    generateWorkDigest,
    testAiConnection,
} from '../ai/ai-client';
import { DEFAULT_AI_CONFIG, type AiConfig } from '../ai/types';
import { NetworkBlockedError, setOfflineOnlyMode } from '../network-guard';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    setOfflineOnlyMode(true);
});

const enabledConfig: AiConfig = {
    ...DEFAULT_AI_CONFIG,
    enabled: true,
    apiKey: 'sk-test-key',
};

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

describe('ai-client', () => {
    it('hard-blocks AI requests when Simple Offline Mode is active', async () => {
        setOfflineOnlyMode(true);
        const tabs = [makeTab('t1', 'GitHub', 'https://github.com')];
        await expect(testAiConnection(enabledConfig)).rejects.toBeInstanceOf(NetworkBlockedError);
        await expect(generateWorkDigest(enabledConfig, 'Open', tabs)).rejects.toBeInstanceOf(
            NetworkBlockedError,
        );
    });

    it('sends privacy-filtered tabs and parses structured work digest JSON', async () => {
        setOfflineOnlyMode(false);
        let capturedBody = '';
        globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
            capturedBody = String(init?.body ?? '');
            return new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    headline: 'DeepSeek Integration',
                                    progressSummary: 'Reviewing API docs',
                                    workstreams: [
                                        {
                                            name: 'API Setup',
                                            status: 'In Progress',
                                            nextStep: 'Test chat completions',
                                            tabIds: ['t2'],
                                        },
                                    ],
                                    priorityTabIds: ['t2'],
                                }),
                            },
                        },
                    ],
                }),
                { status: 200 },
            );
        }) as unknown as typeof fetch;

        const tabs = [
            makeTab('t1', 'My Bank', 'https://online.bank.example.com/account?token=999'),
            makeTab('t2', 'DeepSeek API', 'https://platform.deepseek.com/api-docs?secret=123'),
        ];

        const { digest, skippedPrivacyCount } = await generateWorkDigest(
            enabledConfig,
            'Workspace',
            tabs,
        );

        expect(skippedPrivacyCount).toBe(1);
        expect(capturedBody).not.toContain('bank.example.com');
        expect(capturedBody).not.toContain('secret=123');
        expect(digest.headline).toBe('DeepSeek Integration');
        expect(digest.priorityTabIds).toEqual(['t2']);
    });

    it('retries without response_format when provider rejects JSON mode on HTTP 400', async () => {
        setOfflineOnlyMode(false);
        let attempt = 0;
        globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
            attempt += 1;
            const parsedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
            if (attempt === 1) {
                expect(parsedBody.response_format).toEqual({ type: 'json_object' });
                return new Response('Unsupported parameter: response_format', { status: 400 });
            }
            expect(parsedBody.response_format).toBeUndefined();
            return new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: '{"headline":"Recovered","progressSummary":"OK","workstreams":[],"priorityTabIds":[]}',
                            },
                        },
                    ],
                }),
                { status: 200 },
            );
        }) as unknown as typeof fetch;

        const res = await generateWorkDigest(enabledConfig, 'Test', [
            makeTab('t1', 'Docs', 'https://example.org/docs'),
        ]);
        expect(attempt).toBe(2);
        expect(res.digest.headline).toBe('Recovered');
    });

    it('skips cached manual/ai descriptions when batch-generating site descriptions', async () => {
        setOfflineOnlyMode(false);
        let requestedUrls: string[] = [];
        globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
            const payload = JSON.parse(String(init?.body ?? '{}')) as {
                messages: Array<{ content: string }>;
            };
            const userMsg = JSON.parse(payload.messages[1]!.content) as {
                sites: Array<{ url: string }>;
            };
            requestedUrls = userMsg.sites.map((s) => s.url);

            return new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    items: [
                                        {
                                            url: 'https://react.dev/learn',
                                            description: 'React 官方交互式教程与文档',
                                            category: 'repo',
                                        },
                                    ],
                                }),
                            },
                        },
                    ],
                }),
                { status: 200 },
            );
        }) as unknown as typeof fetch;

        const tabs = [
            makeTab('t1', 'GitHub', 'https://github.com/'),
            makeTab('t2', 'React Docs', 'https://react.dev/learn?ref=nav'),
        ];
        const existingMeta: Record<string, SiteMetaRecord> = {
            'https://github.com/': {
                url: 'https://github.com/',
                description: 'My manual note',
                source: 'manual',
                updatedAt: 100,
            },
        };

        const out = await generateSiteDescriptions(enabledConfig, tabs, existingMeta, {
            overwriteAi: false,
        });

        expect(out.skippedCachedCount).toBe(1);
        expect(requestedUrls).toEqual(['https://react.dev/learn']);
        expect(out.results).toHaveLength(1);
        expect(out.results[0]?.url).toBe('https://react.dev/learn?ref=nav');
        expect(out.results[0]?.description).toBe('React 官方交互式教程与文档');
    });
});
