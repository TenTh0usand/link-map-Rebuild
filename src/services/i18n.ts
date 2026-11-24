export function t(key: string, fallback?: string): string {
    try {
        const msg = chrome?.i18n?.getMessage?.(key);
        if (msg) return msg;
    } catch {
        // Fallback outside extension runtime
    }
    return fallback ?? key;
}

export function isMacOS(): boolean {
    return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
}
