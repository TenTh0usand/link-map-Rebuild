import type { LiveTabDTO, LiveTabGroupDTO, LiveWindowDTO, OpenMode, TreeNode } from '../core/types';

export type BackgroundRelayEvent =
    | { type: 'TAB_CREATED'; tab: LiveTabDTO; group?: LiveTabGroupDTO }
    | { type: 'TAB_REMOVED'; tabId: number; windowId: number }
    | { type: 'TAB_UPDATED'; tab: LiveTabDTO; group?: LiveTabGroupDTO }
    | { type: 'TAB_MOVED'; tabId: number; windowId: number; fromIndex: number; toIndex: number }
    | { type: 'TAB_ACTIVATED'; tabId: number; windowId: number }
    | { type: 'TAB_ATTACHED'; tabId: number; windowId: number; newIndex: number }
    | { type: 'TAB_REPLACED'; addedTab: LiveTabDTO; removedTabId: number }
    | { type: 'WINDOW_CREATED'; window: LiveWindowDTO }
    | { type: 'WINDOW_REMOVED'; windowId: number }
    | { type: 'WINDOW_FOCUS'; windowId: number }
    | { type: 'GROUP_UPSERTED'; group: LiveTabGroupDTO }
    | { type: 'GROUP_REMOVED'; groupId: number };

export type BackgroundCommandMessage =
    | { action: 'OPEN_DETACHED_WINDOW' }
    | { action: 'OPEN_SIDE_PANEL'; windowId?: number }
    | { action: 'OPEN_IMPORT_WINDOW' }
    | { action: 'OPEN_DASHBOARD_TAB'; groupId?: string }
    | { action: 'OPEN_SHARE_VIEWER_TAB'; hash?: string }
    | { action: 'SET_OPEN_MODE'; openMode: OpenMode }
    | { action: 'GET_PREV_FOCUS_WINDOW' };

export type CrossViewBroadcastMessage =
    | { senderId: string; type: 'STATE_UPDATED' }
    | { senderId: string; type: 'SETTINGS_UPDATED' }
    | { senderId: string; type: 'SITE_META_UPDATED' }
    | { senderId: string; type: 'SYNC_STATE_UPDATED' }
    | { senderId: string; type: 'AI_STATE_UPDATED' }
    | {
          senderId: string;
          type: 'IMPORT_NODES_REQUEST';
          requestId: string;
          nodes: TreeNode[];
          asCollectionTitle?: string;
      }
    | { senderId: string; type: 'IMPORT_NODES_ACK'; requestId: string };

const CHANNEL_NAME = 'link-map-v2-sync';
export const VIEW_INSTANCE_ID = `view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
    if (typeof BroadcastChannel === 'undefined') return null;
    if (!channel) {
        channel = new BroadcastChannel(CHANNEL_NAME);
    }
    return channel;
}

export function broadcastStateUpdated(): void {
    getChannel()?.postMessage({
        senderId: VIEW_INSTANCE_ID,
        type: 'STATE_UPDATED',
    } satisfies CrossViewBroadcastMessage);
}

export function broadcastSettingsUpdated(): void {
    getChannel()?.postMessage({
        senderId: VIEW_INSTANCE_ID,
        type: 'SETTINGS_UPDATED',
    } satisfies CrossViewBroadcastMessage);
}

export function broadcastSiteMetaUpdated(): void {
    getChannel()?.postMessage({
        senderId: VIEW_INSTANCE_ID,
        type: 'SITE_META_UPDATED',
    } satisfies CrossViewBroadcastMessage);
}

export function broadcastSyncStateUpdated(): void {
    getChannel()?.postMessage({
        senderId: VIEW_INSTANCE_ID,
        type: 'SYNC_STATE_UPDATED',
    } satisfies CrossViewBroadcastMessage);
}

export function broadcastAiStateUpdated(): void {
    getChannel()?.postMessage({
        senderId: VIEW_INSTANCE_ID,
        type: 'AI_STATE_UPDATED',
    } satisfies CrossViewBroadcastMessage);
}

export function broadcastImportNodesRequest(
    nodes: TreeNode[],
    asCollectionTitle?: string,
): Promise<boolean> {
    const ch = getChannel();
    if (!ch) return Promise.resolve(false);
    const requestId = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                ch.removeEventListener('message', onAck);
                resolve(false);
            }
        }, 120);
        const onAck = (ev: MessageEvent<CrossViewBroadcastMessage>) => {
            if (ev.data?.type === 'IMPORT_NODES_ACK' && ev.data.requestId === requestId) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    ch.removeEventListener('message', onAck);
                    resolve(true);
                }
            }
        };
        ch.addEventListener('message', onAck);
        ch.postMessage({
            senderId: VIEW_INSTANCE_ID,
            type: 'IMPORT_NODES_REQUEST',
            requestId,
            nodes,
            asCollectionTitle,
        } satisfies CrossViewBroadcastMessage);
    });
}

export function broadcastImportNodesAck(requestId: string): void {
    getChannel()?.postMessage({
        senderId: VIEW_INSTANCE_ID,
        type: 'IMPORT_NODES_ACK',
        requestId,
    } satisfies CrossViewBroadcastMessage);
}

export function subscribeCrossViewBroadcast(
    handler: (msg: CrossViewBroadcastMessage) => void,
): () => void {
    const ch = getChannel();
    if (!ch) return () => {};
    const onMsg = (ev: MessageEvent<CrossViewBroadcastMessage>) => {
        if (!ev.data || ev.data.senderId === VIEW_INSTANCE_ID) return;
        handler(ev.data);
    };
    ch.addEventListener('message', onMsg);
    return () => ch.removeEventListener('message', onMsg);
}

export async function sendBackgroundCommand<T = unknown>(
    cmd: BackgroundCommandMessage,
): Promise<T | undefined> {
    try {
        return (await chrome.runtime.sendMessage(cmd)) as T;
    } catch {
        return undefined;
    }
}
