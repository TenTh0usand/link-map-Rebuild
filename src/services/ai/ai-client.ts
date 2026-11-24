import {
    buildOrganizeProposalMessages,
    buildReadlistCurationMessages,
    buildSiteDescriptionsMessages,
    buildWorkDigestMessages,
    extractJsonFromLlmOutput,
    isDomainExcluded,
    normalizeOrganizeProposalResponse,
    normalizeReadlistCurationResponse,
    normalizeSiteDescriptionsResponse,
    normalizeWorkDigestResponse,
    prepareTabsForAi,
    sanitizeUrlForAi,
} from '../../core/ai-prompts';
import { extractHostname, normalizeSiteUrl } from '../../core/categorizer';
import type { CollectionNode, SiteMetaRecord, TabNode } from '../../core/types';
import {
    ensureOriginPermissionForUrl,
    guardedFetch,
    isOfflineOnlyMode,
    NetworkBlockedError,
} from '../network-guard';
import type {
    AiChatMessage,
    AiConfig,
    AiOrganizeProposal,
    AiPreset,
    AiReadlistCuration,
    AiSanitizedTabItem,
    AiSiteDescriptionItem,
    AiWorkDigestRecord,
} from './types';

export interface AiPresetMeta {
    label: string;
    baseUrl: string;
    defaultModel: string;
    requiresKey: boolean;
}

export const AI_PRESETS: Record<AiPreset, AiPresetMeta> = {
    deepseek: {
        label: 'DeepSeek (推荐 · 极低成本)',
        baseUrl: 'https://api.deepseek.com/v1',
        defaultModel: 'deepseek-chat',
        requiresKey: true,
    },
    siliconflow: {
        label: '硅基流动 SiliconFlow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        defaultModel: 'deepseek-ai/DeepSeek-V3',
        requiresKey: true,
    },
    zhipu: {
        label: '智谱 GLM (glm-4-flash)',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        defaultModel: 'glm-4-flash',
        requiresKey: true,
    },
    openai: {
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o-mini',
        requiresKey: true,
    },
    ollama: {
        label: 'Ollama 本地模型',
        baseUrl: 'http://localhost:11434/v1',
        defaultModel: 'qwen2.5:7b',
        requiresKey: false,
    },
    custom: {
        label: '自定义 OpenAI 兼容接口',
        baseUrl: '',
        defaultModel: 'deepseek-chat',
        requiresKey: false,
    },
};

export function resolveChatCompletionsUrl(rawBaseUrl: string): string {
    const trimmed = rawBaseUrl.trim();
    if (!trimmed) {
        throw new Error('AI API Base URL is required.');
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error(`Invalid AI Base URL: ${rawBaseUrl}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Unsupported AI Base URL protocol: ${parsed.protocol}`);
    }
    const noTrailing = parsed.toString().replace(/\/+$/, '');
    return noTrailing.endsWith('/chat/completions')
        ? noTrailing
        : `${noTrailing}/chat/completions`;
}

function extractAssistantText(payload: unknown): string {
    const obj = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    const choices = Array.isArray(obj.choices) ? obj.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    const msg = (first?.message ?? {}) as Record<string, unknown>;
    const content = msg.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((part) =>
                part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string'
                    ? String((part as Record<string, unknown>).text)
                    : '',
            )
            .join('');
    }
    return '';
}

function formatHttpError(status: number, bodyText: string): string {
    if (status === 401 || status === 403) {
        return `AI authentication failed (${status}): verify your API Key.`;
    }
    if (status === 402) {
        return 'AI provider returned 402 Payment Required: check account balance.';
    }
    if (status === 404) {
        return 'AI endpoint or model not found (404): verify Base URL and Model name.';
    }
    if (status === 429) {
        return 'AI rate limit reached (429): please retry shortly.';
    }
    return `AI API request failed (${status}): ${bodyText.slice(0, 180) || 'Unknown error'}`;
}

export async function requestChatCompletion(
    config: AiConfig,
    messages: AiChatMessage[],
    options: { jsonMode?: boolean; maxTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
    if (isOfflineOnlyMode()) {
        throw new NetworkBlockedError();
    }

    const endpoint = resolveChatCompletionsUrl(config.baseUrl);
    const presetMeta = AI_PRESETS[config.preset];
    if (presetMeta?.requiresKey && !config.apiKey.trim()) {
        throw new Error('AI API Key is required for this provider.');
    }

    const granted = await ensureOriginPermissionForUrl(endpoint);
    if (!granted) {
        throw new Error('Browser denied host permission for the AI API endpoint.');
    }

    const sendOnce = async (withJsonFormat: boolean): Promise<Response> => {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (config.apiKey.trim()) {
            headers.Authorization = `Bearer ${config.apiKey.trim()}`;
        }

        const body: Record<string, unknown> = {
            model: config.model.trim() || 'deepseek-chat',
            messages,
            temperature: 0.2,
            ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
            ...(withJsonFormat ? { response_format: { type: 'json_object' } } : {}),
        };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 45000);
        try {
            return await guardedFetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
    };

    let res = await sendOnce(Boolean(options.jsonMode));
    if (res.status === 400 && options.jsonMode) {
        const errText = await res.text().catch(() => '');
        if (/response_format|json_object/i.test(errText)) {
            res = await sendOnce(false);
        } else {
            throw new Error(formatHttpError(res.status, errText));
        }
    }

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(formatHttpError(res.status, errText));
    }

    const data = (await res.json()) as unknown;
    const content = extractAssistantText(data);
    if (!content.trim()) {
        throw new Error('AI provider returned an empty response.');
    }
    return content;
}

function assertAiReady(config: AiConfig): void {
    if (isOfflineOnlyMode()) {
        throw new NetworkBlockedError();
    }
    if (!config.enabled) {
        throw new Error('AI Assistant is currently disabled. Enable it in Settings -> AI Assistant.');
    }
}

export async function testAiConnection(
    config: AiConfig,
): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
    if (isOfflineOnlyMode()) {
        throw new NetworkBlockedError();
    }
    const start = Date.now();
    try {
        const reply = await requestChatCompletion(
            config,
            [{ role: 'user', content: 'Reply with OK only.' }],
            { jsonMode: false, maxTokens: 16, timeoutMs: 20000 },
        );
        return {
            ok: true,
            latencyMs: Date.now() - start,
            message: `Connected · ${config.model || 'model'} replied "${reply.trim().slice(0, 24)}"`,
        };
    } catch (err) {
        if (err instanceof NetworkBlockedError) throw err;
        return {
            ok: false,
            latencyMs: Date.now() - start,
            message: err instanceof Error ? err.message : String(err),
        };
    }
}

export async function generateWorkDigest(
    config: AiConfig,
    scopeTitle: string,
    tabs: TabNode[],
    siteMetaMap: Record<string, SiteMetaRecord> = {},
): Promise<{ digest: AiWorkDigestRecord; skippedPrivacyCount: number }> {
    assertAiReady(config);
    const { items, skippedPrivacyCount } = prepareTabsForAi(tabs, config, siteMetaMap);
    if (items.length === 0) {
        throw new Error(
            skippedPrivacyCount > 0
                ? 'All tabs in scope were filtered by your privacy blacklist or internal URL rules.'
                : 'No analyzeable tabs found in the selected scope.',
        );
    }

    const rawText = await requestChatCompletion(
        config,
        buildWorkDigestMessages(scopeTitle, items, config.language),
        { jsonMode: true, maxTokens: 1500 },
    );
    const parsed = extractJsonFromLlmOutput(rawText);
    const validIds = new Set(items.map((i) => i.id));
    const digest = normalizeWorkDigestResponse(parsed, validIds, {
        scopeTitle,
        model: config.model || 'deepseek-chat',
    });
    return { digest, skippedPrivacyCount };
}

export async function generateOrganizeProposal(
    config: AiConfig,
    tabs: TabNode[],
    existingCollections: CollectionNode[],
    siteMetaMap: Record<string, SiteMetaRecord> = {},
): Promise<{ proposal: AiOrganizeProposal; skippedPrivacyCount: number }> {
    assertAiReady(config);
    const { items, skippedPrivacyCount } = prepareTabsForAi(tabs, config, siteMetaMap);
    if (items.length === 0) {
        throw new Error('No analyzeable tabs found in the selected scope.');
    }

    const existingNames = existingCollections.map((c) => c.title);
    const rawText = await requestChatCompletion(
        config,
        buildOrganizeProposalMessages(items, existingNames, config.language),
        { jsonMode: true, maxTokens: 1600 },
    );
    const parsed = extractJsonFromLlmOutput(rawText);
    const validIds = new Set(items.map((i) => i.id));
    return {
        proposal: normalizeOrganizeProposalResponse(parsed, validIds),
        skippedPrivacyCount,
    };
}

export async function generateReadlistCuration(
    config: AiConfig,
    tabs: TabNode[],
    siteMetaMap: Record<string, SiteMetaRecord> = {},
): Promise<{ curation: AiReadlistCuration; skippedPrivacyCount: number }> {
    assertAiReady(config);
    const { items, skippedPrivacyCount } = prepareTabsForAi(tabs, config, siteMetaMap);
    if (items.length === 0) {
        throw new Error('No analyzeable tabs found in the selected scope.');
    }

    const rawText = await requestChatCompletion(
        config,
        buildReadlistCurationMessages(items, config.language),
        { jsonMode: true, maxTokens: 1600 },
    );
    const parsed = extractJsonFromLlmOutput(rawText);
    const tabById = new Map(tabs.map((t) => [t.id, t]));
    return {
        curation: normalizeReadlistCurationResponse(parsed, tabById),
        skippedPrivacyCount,
    };
}

export async function generateSiteDescriptions(
    config: AiConfig,
    tabs: TabNode[],
    siteMetaMap: Record<string, SiteMetaRecord> = {},
    options: {
        overwriteAi?: boolean;
        batchSize?: number;
        onProgress?: (done: number, total: number) => void;
    } = {},
): Promise<{
    results: AiSiteDescriptionItem[];
    skippedCachedCount: number;
    skippedPrivacyCount: number;
}> {
    assertAiReady(config);

    const candidates: AiSanitizedTabItem[] = [];
    const urlLookup = new Map<string, string>();
    const seenNorm = new Set<string>();
    let skippedCachedCount = 0;
    let skippedPrivacyCount = 0;

    for (const tab of tabs) {
        const rawUrl = tab.url || tab.pendingUrl || '';
        if (isDomainExcluded(rawUrl, config.excludedDomains)) {
            skippedPrivacyCount += 1;
            continue;
        }
        const normUrl = normalizeSiteUrl(rawUrl);
        if (seenNorm.has(normUrl)) continue;
        seenNorm.add(normUrl);

        const existing = siteMetaMap[normUrl];
        if (existing?.description) {
            if (existing.source === 'manual' || !options.overwriteAi) {
                skippedCachedCount += 1;
                continue;
            }
        }

        const sanitizedUrl = sanitizeUrlForAi(rawUrl, config.stripQueryParams);
        urlLookup.set(sanitizedUrl, normUrl);
        urlLookup.set(normalizeSiteUrl(sanitizedUrl), normUrl);
        urlLookup.set(normUrl, normUrl);

        candidates.push({
            id: tab.id,
            title: (tab.alias || tab.title || extractHostname(rawUrl)).slice(0, 120),
            url: sanitizedUrl,
            domain: extractHostname(rawUrl),
            closed: tab.closed,
        });
    }

    if (candidates.length === 0) {
        return { results: [], skippedCachedCount, skippedPrivacyCount };
    }

    const batchSize = Math.max(5, Math.min(30, options.batchSize ?? 20));
    const allResults: AiSiteDescriptionItem[] = [];
    options.onProgress?.(0, candidates.length);

    for (let i = 0; i < candidates.length; i += batchSize) {
        const batch = candidates.slice(i, i + batchSize);
        const rawText = await requestChatCompletion(
            config,
            buildSiteDescriptionsMessages(batch, config.language),
            { jsonMode: true, maxTokens: 1600 },
        );
        const parsed = extractJsonFromLlmOutput(rawText);
        const normalized = normalizeSiteDescriptionsResponse(parsed, urlLookup);
        allResults.push(...normalized);
        options.onProgress?.(Math.min(candidates.length, i + batch.length), candidates.length);
    }

    return { results: allResults, skippedCachedCount, skippedPrivacyCount };
}
