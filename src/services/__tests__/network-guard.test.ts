import { describe, expect, it, vi } from 'vitest';

import {
    guardedFetch,
    isOfflineOnlyMode,
    NetworkBlockedError,
    setOfflineOnlyMode,
} from '../network-guard';

describe('network-guard', () => {
    it('hard-blocks outbound fetch requests when Simple Offline Mode is enabled', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
        setOfflineOnlyMode(true);
        expect(isOfflineOnlyMode()).toBe(true);

        await expect(guardedFetch('https://example.com/api')).rejects.toThrow(NetworkBlockedError);
        expect(fetchSpy).not.toHaveBeenCalled();

        setOfflineOnlyMode(false);
        expect(isOfflineOnlyMode()).toBe(false);
        const resp = await guardedFetch('https://example.com/api');
        expect(resp.status).toBe(200);
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        // Restore default safe offline state
        setOfflineOnlyMode(true);
        fetchSpy.mockRestore();
    });
});
