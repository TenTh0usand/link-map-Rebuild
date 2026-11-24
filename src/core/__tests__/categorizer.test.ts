import { describe, expect, it } from 'vitest';

import { extractHostname, inferUrlCategory, normalizeSiteUrl } from '../categorizer';

describe('categorizer', () => {
    it('extracts normalized hostnames and strips URL fragments', () => {
        expect(extractHostname('https://www.GitHub.com/TenTh0usand/link-map-Rebuild')).toBe(
            'github.com',
        );
        expect(extractHostname('chrome://extensions/')).toBe('chrome://extensions');
        expect(extractHostname('not a url')).toBe('');

        expect(normalizeSiteUrl('https://example.com/path?a=1#section')).toBe(
            'https://example.com/path?a=1',
        );
    });

    it('infers categories accurately for repo, media, readlist, workspace, and general', () => {
        expect(inferUrlCategory('https://github.com/facebook/react')).toBe('repo');
        expect(inferUrlCategory('https://huggingface.co/models')).toBe('repo');
        expect(inferUrlCategory('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('media');
        expect(inferUrlCategory('https://www.bilibili.com/video/BV1xx')).toBe('media');
        expect(inferUrlCategory('https://music.163.com/#/song?id=1')).toBe('media');
        expect(inferUrlCategory('https://zhuanlan.zhihu.com/p/123456')).toBe('readlist');
        expect(inferUrlCategory('https://news.ycombinator.com/item?id=1')).toBe('readlist');
        expect(inferUrlCategory('https://docs.python.org/3/')).toBe('readlist');
        expect(inferUrlCategory('https://www.notion.so/my-workspace')).toBe('workspace');
        expect(inferUrlCategory('http://localhost:3000/dashboard')).toBe('workspace');
        expect(inferUrlCategory('https://random-shop.example.org/item')).toBe('general');
    });
});
