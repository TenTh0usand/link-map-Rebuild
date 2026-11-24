import type {
    AiChatMessage,
    AiConfig,
    AiDuplicateHint,
    AiOrganizeProposal,
    AiProposedGroup,
    AiReadlistCuration,
    AiReadlistShelf,
    AiReadlistShelfItem,
    AiSanitizedTabItem,
    AiSiteDescriptionItem,
    AiWorkDigestRecord,
    AiWorkstream,
} from '../services/ai/types';
import { extractHostname, normalizeSiteUrl } from './categorizer';
import type {
    CollectionCategory,
    SiteMetaRecord,
    TabGroupColor,
    TabNode,
} from './types';

const VALID_CATEGORIES = new Set<CollectionCategory>([
    'workspace',
    'readlist',
    'repo',
    'media',
    'general',
]);

const VALID_COLORS = new Set<TabGroupColor>([
    'grey',
    'blue',
    'red',
    'yellow',
    'green',
    'pink',
    'purple',
    'cyan',
    'orange',
]);

export function isDomainExcluded(rawUrl: string, excludedDomains: string[]): boolean {
    if (!rawUrl || !rawUrl.trim()) return true;
    let parsed: URL;
    try {
        parsed = new URL(rawUrl.trim());
    } catch {
        return true;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return true;
    }

    const host = parsed.hostname.toLowerCase();
    const origin = parsed.origin.toLowerCase();

    for (const rawPattern of excludedDomains) {
        const pattern = rawPattern.trim().toLowerCase();
        if (!pattern) continue;
        if (pattern.endsWith('.')) {
            if (host.startsWith(pattern) || host.includes(`.${pattern}`)) {
                return true;
            }
            continue;
        }
        if (host === pattern || host.endsWith(`.${pattern}`) || host.includes(pattern)) {
            return true;
        }
        if (pattern.includes('://') && origin.includes(pattern)) {
            return true;
        }
    }

    return false;
}

export function sanitizeUrlForAi(rawUrl: string, stripQueryParams: boolean): string {
    try {
        const u = new URL(rawUrl.trim());
        u.username = '';
        u.password = '';
        u.hash = '';
        if (stripQueryParams) {
            u.search = '';
        }
        const path = u.pathname.length > 120 ? `${u.pathname.slice(0, 120)}...` : u.pathname;
        return `${u.origin}${path}${u.search}`;
    } catch {
        return rawUrl.slice(0, 140);
    }
}

export function prepareTabsForAi(
    tabs: TabNode[],
    config: Pick<AiConfig, 'excludedDomains' | 'stripQueryParams' | 'maxItemsPerRequest'>,
    siteMetaMap: Record<string, SiteMetaRecord> = {},
): {
    items: AiSanitizedTabItem[];
    skippedPrivacyCount: number;
    truncatedCount: number;
} {
    const items: AiSanitizedTabItem[] = [];
    let skippedPrivacyCount = 0;
    let truncatedCount = 0;
    const limit = Math.max(5, config.maxItemsPerRequest || 40);

    for (const tab of tabs) {
        const rawUrl = tab.url || tab.pendingUrl || '';
        if (isDomainExcluded(rawUrl, config.excludedDomains)) {
            skippedPrivacyCount += 1;
            continue;
        }
        if (items.length >= limit) {
            truncatedCount += 1;
            continue;
        }
        const meta = siteMetaMap[normalizeSiteUrl(rawUrl)];
        const currentDesc = meta?.description || tab.description;
        items.push({
            id: tab.id,
            title: (tab.alias || tab.title || extractHostname(rawUrl)).slice(0, 120),
            url: sanitizeUrlForAi(rawUrl, config.stripQueryParams),
            domain: extractHostname(rawUrl),
            closed: tab.closed,
            ...(currentDesc ? { currentDesc: currentDesc.slice(0, 100) } : {}),
        });
    }

    return { items, skippedPrivacyCount, truncatedCount };
}

function findBalancedJsonSlice(text: string): string | null {
    const objIdx = text.indexOf('{');
    const arrIdx = text.indexOf('[');
    let startIdx = -1;
    if (objIdx >= 0 && arrIdx >= 0) {
        startIdx = Math.min(objIdx, arrIdx);
    } else {
        startIdx = Math.max(objIdx, arrIdx);
    }
    if (startIdx < 0) return null;

    const openChar = text[startIdx]!;
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIdx; i < text.length; i++) {
        const ch = text[i]!;
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === openChar) {
            depth += 1;
        } else if (ch === closeChar) {
            depth -= 1;
            if (depth === 0) {
                return text.slice(startIdx, i + 1);
            }
        }
    }

    return null;
}

export function extractJsonFromLlmOutput<T = unknown>(rawText: string): T {
    const withoutThink = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    const fenceMatch = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) {
        const candidate = fenceMatch[1].trim();
        try {
            return JSON.parse(candidate) as T;
        } catch {
            // Fall through to balanced slice extraction
        }
    }

    try {
        return JSON.parse(withoutThink) as T;
    } catch {
        const sliced = findBalancedJsonSlice(withoutThink);
        if (sliced) {
            return JSON.parse(sliced) as T;
        }
        throw new Error('AI response did not contain valid JSON.');
    }
}

function langInstruction(language: 'zh' | 'en'): string {
    return language === 'zh'
        ? 'All human-readable text MUST be concise Simplified Chinese.'
        : 'All human-readable text MUST be concise English.';
}

export function buildWorkDigestMessages(
    scopeTitle: string,
    items: AiSanitizedTabItem[],
    language: 'zh' | 'en',
): AiChatMessage[] {
    return [
        {
            role: 'system',
            content:
                `You are a browser workspace productivity assistant. Analyze the user's open/saved tabs and reconstruct what work they were doing, how far they got, and which tabs to reopen next. ${langInstruction(language)} Return ONLY strict JSON matching schema: {"headline": string, "progressSummary": string, "workstreams": [{"name": string, "status": string, "nextStep": string, "tabIds": string[]}], "priorityTabIds": string[]}. Only reference existing tab id values from the input.`,
        },
        {
            role: 'user',
            content: JSON.stringify({ scopeTitle, tabs: items }),
        },
    ];
}

export function buildOrganizeProposalMessages(
    items: AiSanitizedTabItem[],
    existingGroupNames: string[],
    language: 'zh' | 'en',
): AiChatMessage[] {
    return [
        {
            role: 'system',
            content:
                `You are a browser tab organization assistant. Group cluttered tabs into clear task spaces, assign a category from ["workspace","readlist","repo","media","general"] and color from ["grey","blue","red","yellow","green","pink","purple","cyan","orange"], and identify likely duplicate tabs. ${langInstruction(language)} Return ONLY strict JSON: {"summary": string, "proposedGroups": [{"title": string, "category": string, "color": string, "reason": string, "tabIds": string[]}], "duplicateTabs": [{"tabId": string, "reason": string}]}. Only use tab ids provided in input.`,
        },
        {
            role: 'user',
            content: JSON.stringify({ existingGroups: existingGroupNames, tabs: items }),
        },
    ];
}

export function buildReadlistCurationMessages(
    items: AiSanitizedTabItem[],
    language: 'zh' | 'en',
): AiChatMessage[] {
    return [
        {
            role: 'system',
            content:
                `You curate a user's Readlist, news, GitHub repos, tools, videos, and bookmarks into thematic shelves with concise reading guides and priorities ("high" | "medium" | "low"). ${langInstruction(language)} Categories must be from ["workspace","readlist","repo","media","general"]. Return ONLY strict JSON: {"summary": string, "shelves": [{"title": string, "category": string, "items": [{"tabId": string, "oneLineGuide": string, "priority": "high"|"medium"|"low"}]}]}. Only use provided tab ids.`,
        },
        {
            role: 'user',
            content: JSON.stringify({ tabs: items }),
        },
    ];
}

export function buildSiteDescriptionsMessages(
    items: AiSanitizedTabItem[],
    language: 'zh' | 'en',
): AiChatMessage[] {
    return [
        {
            role: 'system',
            content:
                `You write ultra-concise one-line website guides for a browser navigation dashboard explaining what each link is for. ${langInstruction(language)} Keep each description <= 36 Chinese chars (or <= 95 English chars). Category must be from ["workspace","readlist","repo","media","general"]. Return ONLY strict JSON: {"items": [{"url": string, "description": string, "category": string}]}. Preserve exact url strings from input.`,
        },
        {
            role: 'user',
            content: JSON.stringify({
                sites: items.map((i) => ({ url: i.url, title: i.title, domain: i.domain })),
            }),
        },
    ];
}

function normalizeCategory(raw: unknown, fallback: CollectionCategory = 'general'): CollectionCategory {
    return typeof raw === 'string' && VALID_CATEGORIES.has(raw as CollectionCategory)
        ? (raw as CollectionCategory)
        : fallback;
}

function normalizeColor(raw: unknown, fallback: TabGroupColor = 'blue'): TabGroupColor {
    return typeof raw === 'string' && VALID_COLORS.has(raw as TabGroupColor)
        ? (raw as TabGroupColor)
        : fallback;
}

function filterValidIds(rawIds: unknown, validTabIds: Set<string>): string[] {
    if (!Array.isArray(rawIds)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of rawIds) {
        if (typeof id === 'string' && validTabIds.has(id) && !seen.has(id)) {
            seen.add(id);
            out.push(id);
        }
    }
    return out;
}

export function normalizeWorkDigestResponse(
    raw: unknown,
    validTabIds: Set<string>,
    meta: { scopeTitle: string; model: string },
): AiWorkDigestRecord {
    const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const rawStreams = Array.isArray(obj.workstreams) ? obj.workstreams : [];
    const workstreams: AiWorkstream[] = [];

    for (const entry of rawStreams) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const tabIds = filterValidIds(e.tabIds, validTabIds);
        if (tabIds.length === 0) continue;
        workstreams.push({
            name: typeof e.name === 'string' && e.name.trim() ? e.name.trim() : 'Workstream',
            status: typeof e.status === 'string' && e.status.trim() ? e.status.trim() : 'In progress',
            nextStep: typeof e.nextStep === 'string' && e.nextStep.trim() ? e.nextStep.trim() : 'Review open tabs',
            tabIds,
        });
    }

    const priorityTabIds = filterValidIds(obj.priorityTabIds, validTabIds).slice(0, 6);

    return {
        id: `aid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Date.now(),
        scopeTitle: meta.scopeTitle,
        headline:
            typeof obj.headline === 'string' && obj.headline.trim()
                ? obj.headline.trim()
                : `${meta.scopeTitle} Digest`,
        progressSummary:
            typeof obj.progressSummary === 'string' && obj.progressSummary.trim()
                ? obj.progressSummary.trim()
                : 'Workspace summary generated.',
        workstreams,
        priorityTabIds,
        model: meta.model,
    };
}

export function normalizeOrganizeProposalResponse(
    raw: unknown,
    validTabIds: Set<string>,
): AiOrganizeProposal {
    const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const rawGroups = Array.isArray(obj.proposedGroups) ? obj.proposedGroups : [];
    const proposedGroups: AiProposedGroup[] = [];

    for (const entry of rawGroups) {
        if (!entry || typeof entry !== 'object') continue;
        const g = entry as Record<string, unknown>;
        const tabIds = filterValidIds(g.tabIds, validTabIds);
        if (tabIds.length === 0) continue;
        proposedGroups.push({
            title: typeof g.title === 'string' && g.title.trim() ? g.title.trim() : 'Untitled Group',
            category: normalizeCategory(g.category, 'workspace'),
            color: normalizeColor(g.color, 'blue'),
            reason: typeof g.reason === 'string' ? g.reason.trim() : '',
            tabIds,
        });
    }

    const rawDups = Array.isArray(obj.duplicateTabs) ? obj.duplicateTabs : [];
    const duplicateTabs: AiDuplicateHint[] = [];
    const seenDups = new Set<string>();
    for (const d of rawDups) {
        if (!d || typeof d !== 'object') continue;
        const entry = d as Record<string, unknown>;
        if (
            typeof entry.tabId === 'string' &&
            validTabIds.has(entry.tabId) &&
            !seenDups.has(entry.tabId)
        ) {
            seenDups.add(entry.tabId);
            duplicateTabs.push({
                tabId: entry.tabId,
                reason:
                    typeof entry.reason === 'string' && entry.reason.trim()
                        ? entry.reason.trim()
                        : 'Duplicate link',
            });
        }
    }

    return {
        summary:
            typeof obj.summary === 'string' && obj.summary.trim()
                ? obj.summary.trim()
                : 'Suggested workspace groups',
        proposedGroups,
        duplicateTabs,
    };
}

export function normalizeReadlistCurationResponse(
    raw: unknown,
    tabById: Map<string, TabNode>,
): AiReadlistCuration {
    const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const rawShelves = Array.isArray(obj.shelves) ? obj.shelves : [];
    const shelves: AiReadlistShelf[] = [];

    for (const entry of rawShelves) {
        if (!entry || typeof entry !== 'object') continue;
        const s = entry as Record<string, unknown>;
        const rawItems = Array.isArray(s.items) ? s.items : [];
        const items: AiReadlistShelfItem[] = [];
        const seen = new Set<string>();
        for (const item of rawItems) {
            if (!item || typeof item !== 'object') continue;
            const it = item as Record<string, unknown>;
            if (typeof it.tabId !== 'string') continue;
            const tab = tabById.get(it.tabId);
            if (!tab || seen.has(tab.id)) continue;
            seen.add(tab.id);
            const rawPrio = it.priority;
            const priority: 'high' | 'medium' | 'low' =
                rawPrio === 'high' || rawPrio === 'low' ? rawPrio : 'medium';
            items.push({
                tabId: tab.id,
                url: tab.url || tab.pendingUrl || '',
                title: tab.alias || tab.title,
                oneLineGuide:
                    typeof it.oneLineGuide === 'string' && it.oneLineGuide.trim()
                        ? it.oneLineGuide.trim()
                        : tab.title,
                priority,
            });
        }
        if (items.length === 0) continue;
        shelves.push({
            title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : 'Curated Shelf',
            category: normalizeCategory(s.category, 'readlist'),
            items,
        });
    }

    return {
        summary:
            typeof obj.summary === 'string' && obj.summary.trim()
                ? obj.summary.trim()
                : 'Readlist & Goodies Curation',
        shelves,
    };
}

export function normalizeSiteDescriptionsResponse(
    raw: unknown,
    urlLookup: Map<string, string>,
): AiSiteDescriptionItem[] {
    const list = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).items)
          ? ((raw as Record<string, unknown>).items as unknown[])
          : [];

    const out: AiSiteDescriptionItem[] = [];
    const seen = new Set<string>();

    for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        const item = entry as Record<string, unknown>;
        if (typeof item.url !== 'string' || typeof item.description !== 'string') continue;
        const resolvedUrl =
            urlLookup.get(item.url.trim()) ?? urlLookup.get(normalizeSiteUrl(item.url.trim()));
        if (!resolvedUrl || seen.has(resolvedUrl)) continue;
        const desc = item.description.trim().slice(0, 140);
        if (!desc) continue;
        seen.add(resolvedUrl);
        out.push({
            url: resolvedUrl,
            description: desc,
            ...(item.category ? { category: normalizeCategory(item.category, 'general') } : {}),
        });
    }

    return out;
}
