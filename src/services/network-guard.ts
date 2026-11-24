export class NetworkBlockedError extends Error {
    constructor(message = 'Blocked outbound network request: Simple Offline Mode is active.') {
        super(message);
        this.name = 'NetworkBlockedError';
    }
}

let offlineOnlyEnabled = true;

export function setOfflineOnlyMode(enabled: boolean): void {
    offlineOnlyEnabled = enabled;
}

export function isOfflineOnlyMode(): boolean {
    return offlineOnlyEnabled;
}

/**
 * All future cloud sync (WebDAV, R2/S3, Google Drive) and AI calls MUST pass
 * through guardedFetch so Simple Offline Mode guarantees zero outbound requests.
 */
export async function guardedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<Response> {
    if (offlineOnlyEnabled) {
        throw new NetworkBlockedError();
    }
    return fetch(input, init);
}

export async function hasOptionalOriginPermission(originPattern: string): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.permissions) return false;
    return chrome.permissions.contains({ origins: [originPattern] });
}

export async function requestOptionalOriginPermission(originPattern: string): Promise<boolean> {
    if (offlineOnlyEnabled) {
        throw new NetworkBlockedError('Disable Simple Offline Mode before granting host access.');
    }
    if (typeof chrome === 'undefined' || !chrome.permissions) return false;
    return chrome.permissions.request({ origins: [originPattern] });
}

export function getOriginPatternFromUrl(rawUrl: string): string {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl.trim());
    } catch {
        throw new Error(`Invalid endpoint URL: ${rawUrl}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Unsupported URL protocol "${parsed.protocol}"; expected http: or https:`);
    }
    return `${parsed.origin}/*`;
}

export async function ensureOriginPermissionForUrl(rawUrl: string): Promise<boolean> {
    if (offlineOnlyEnabled) {
        throw new NetworkBlockedError('Disable Simple Offline Mode before accessing remote endpoints.');
    }
    const pattern = getOriginPatternFromUrl(rawUrl);
    if (typeof chrome === 'undefined' || !chrome.permissions) {
        return true;
    }
    const alreadyGranted = await hasOptionalOriginPermission(pattern);
    if (alreadyGranted) {
        return true;
    }
    return requestOptionalOriginPermission(pattern);
}
