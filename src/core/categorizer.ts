import type { CollectionCategory } from './types';

export function extractHostname(rawUrl: string): string {
    if (!rawUrl) return '';
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'chrome:' || parsed.protocol === 'edge:' || parsed.protocol === 'about:') {
            return `${parsed.protocol}//${parsed.hostname || parsed.pathname}`;
        }
        return parsed.hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
        return '';
    }
}

export function normalizeSiteUrl(rawUrl: string): string {
    if (!rawUrl) return '';
    try {
        const parsed = new URL(rawUrl);
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return rawUrl.trim();
    }
}

const REPO_HOSTS = new Set([
    'github.com',
    'gist.github.com',
    'gitlab.com',
    'gitee.com',
    'bitbucket.org',
    'codeberg.org',
    'huggingface.co',
    'npmjs.com',
    'crates.io',
    'pypi.org',
]);

const MEDIA_HOSTS = new Set([
    'youtube.com',
    'youtu.be',
    'music.youtube.com',
    'bilibili.com',
    'b23.tv',
    'vimeo.com',
    'twitch.tv',
    'spotify.com',
    'open.spotify.com',
    'music.163.com',
    'y.qq.com',
    'soundcloud.com',
    'xiaoyuzhoufm.com',
    'douyin.com',
    'podcasts.apple.com',
]);

const READLIST_HOSTS = new Set([
    'medium.com',
    'substack.com',
    'dev.to',
    'juejin.cn',
    'zhihu.com',
    'zhuanlan.zhihu.com',
    'mp.weixin.qq.com',
    'news.ycombinator.com',
    'v2ex.com',
    'nodeseek.com',
    'linux.do',
    'sspai.com',
    'arxiv.org',
    'ruanyifeng.com',
    'infoq.cn',
]);

const WORKSPACE_HOSTS = new Set([
    'notion.so',
    'notion.site',
    'linear.app',
    'figma.com',
    'feishu.cn',
    'docs.qq.com',
    'docs.google.com',
    'sheets.google.com',
    'drive.google.com',
    'trello.com',
    'atlassian.net',
    'localhost',
    '127.0.0.1',
]);

function hostMatchesSet(host: string, set: Set<string>): boolean {
    if (set.has(host)) return true;
    for (const candidate of set) {
        if (host.endsWith(`.${candidate}`)) return true;
    }
    return false;
}

export function inferUrlCategory(rawUrl: string, title = ''): CollectionCategory {
    const host = extractHostname(rawUrl);
    if (!host) return 'general';

    if (hostMatchesSet(host, REPO_HOSTS)) return 'repo';
    if (hostMatchesSet(host, MEDIA_HOSTS)) return 'media';
    if (
        hostMatchesSet(host, WORKSPACE_HOSTS) ||
        host.endsWith('.feishu.cn') ||
        host.endsWith('.larksuite.com')
    ) {
        return 'workspace';
    }
    if (
        hostMatchesSet(host, READLIST_HOSTS) ||
        host.startsWith('docs.') ||
        host.startsWith('blog.') ||
        host.endsWith('.readthedocs.io') ||
        host.endsWith('wikipedia.org') ||
        /\/(blog|article|post|posts|docs|guide)\b/i.test(rawUrl)
    ) {
        return 'readlist';
    }

    if (/github|repo|git/i.test(title)) return 'repo';
    return 'general';
}
