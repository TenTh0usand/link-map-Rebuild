import type { CollectionCategory, TabGroupColor } from '../../core/types';

export type AiPreset =
    | 'deepseek'
    | 'siliconflow'
    | 'zhipu'
    | 'openai'
    | 'ollama'
    | 'custom';

export interface AiConfig {
    enabled: boolean;
    preset: AiPreset;
    baseUrl: string;
    apiKey: string;
    model: string;
    language: 'zh' | 'en';
    stripQueryParams: boolean;
    excludedDomains: string[];
    maxItemsPerRequest: number;
}

export const DEFAULT_AI_EXCLUDED_DOMAINS: string[] = [
    'localhost',
    '127.0.0.1',
    '192.168.',
    '10.',
    'bank',
    'alipay.com',
    'paypal.com',
    'mail.',
    '1password',
    'bitwarden',
];

export const DEFAULT_AI_CONFIG: AiConfig = {
    enabled: false,
    preset: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    language: 'zh',
    stripQueryParams: true,
    excludedDomains: [...DEFAULT_AI_EXCLUDED_DOMAINS],
    maxItemsPerRequest: 40,
};

export interface AiSanitizedTabItem {
    id: string;
    title: string;
    url: string;
    domain: string;
    closed: boolean;
    currentDesc?: string;
}

export interface AiWorkstream {
    name: string;
    status: string;
    nextStep: string;
    tabIds: string[];
}

export interface AiWorkDigestRecord {
    id: string;
    createdAt: number;
    scopeTitle: string;
    headline: string;
    progressSummary: string;
    workstreams: AiWorkstream[];
    priorityTabIds: string[];
    model: string;
}

export interface AiProposedGroup {
    title: string;
    category: CollectionCategory;
    color: TabGroupColor;
    reason: string;
    tabIds: string[];
}

export interface AiDuplicateHint {
    tabId: string;
    reason: string;
}

export interface AiOrganizeProposal {
    summary: string;
    proposedGroups: AiProposedGroup[];
    duplicateTabs: AiDuplicateHint[];
}

export interface AiReadlistShelfItem {
    tabId: string;
    url: string;
    title: string;
    oneLineGuide: string;
    priority: 'high' | 'medium' | 'low';
}

export interface AiReadlistShelf {
    title: string;
    category: CollectionCategory;
    items: AiReadlistShelfItem[];
}

export interface AiReadlistCuration {
    summary: string;
    shelves: AiReadlistShelf[];
}

export interface AiSiteDescriptionItem {
    url: string;
    description: string;
    category?: CollectionCategory;
}

export interface AiChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
