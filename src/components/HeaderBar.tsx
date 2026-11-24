import React from 'react';
import { App as AntdApp, Input, Tooltip } from 'antd';
import {
    AlertTriangle,
    Cloud,
    LayoutGrid,
    PanelRight,
    PictureInPicture2,
    RefreshCw,
    Search,
    Settings,
    ShieldCheck,
    ShieldOff,
    Sparkles,
} from 'lucide-react';

import type { OpenMode } from '../core/types';
import { isMacOS, t } from '../services/i18n';
import { sendBackgroundCommand } from '../services/sync-channel';
import { useWorkspaceStore } from '../store/workspace-store';

interface HeaderBarProps {
    hostMode: OpenMode;
    searchInputRef: React.MutableRefObject<HTMLInputElement | null>;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({ hostMode, searchInputRef }) => {
    const { message } = AntdApp.useApp();
    const searchQuery = useWorkspaceStore((s) => s.searchQuery);
    const setSearchQuery = useWorkspaceStore((s) => s.setSearchQuery);
    const offlineOnlyMode = useWorkspaceStore((s) => s.settings.offlineOnlyMode);
    const setSettingsModalOpen = useWorkspaceStore((s) => s.setSettingsModalOpen);
    const setAiModalOpen = useWorkspaceStore((s) => s.setAiModalOpen);
    const aiConfig = useWorkspaceStore((s) => s.aiConfig);
    const syncConfig = useWorkspaceStore((s) => s.syncConfig);
    const syncMeta = useWorkspaceStore((s) => s.syncMeta);
    const syncing = useWorkspaceStore((s) => s.syncing);
    const syncConflict = useWorkspaceStore((s) => s.syncConflict);
    const runCloudSync = useWorkspaceStore((s) => s.runCloudSync);

    const shortcutLabel = isMacOS() ? '⌘K' : 'Ctrl+K';
    const showCloudButton =
        !offlineOnlyMode &&
        syncConfig.provider !== 'none' &&
        syncConfig.provider !== 'google-drive';
    const hasSyncAlert = Boolean(syncConflict || syncMeta.lastSyncStatus === 'error');

    const handleCloudButtonClick = async () => {
        if (hasSyncAlert) {
            setSettingsModalOpen(true, 'sync');
            return;
        }
        const res = await runCloudSync('smart');
        if (res.status === 'pushed' || res.status === 'pulled') {
            void message.success(res.message ?? 'Synced', 1.4);
        } else if (res.status === 'noop') {
            void message.info(res.message ?? 'Up to date', 1.2);
        } else if (res.status === 'conflict') {
            setSettingsModalOpen(true, 'sync');
            void message.warning(res.message ?? 'Sync conflict');
        } else {
            void message.error(res.message ?? 'Sync failed');
        }
    };

    const cloudTooltip = hasSyncAlert
        ? syncConflict
            ? t('syncConflictTitle')
            : syncMeta.lastSyncMessage || 'Cloud Sync Error'
        : `${syncConfig.provider.toUpperCase()} · ${
              syncMeta.lastSyncedAt
                  ? new Date(syncMeta.lastSyncedAt).toLocaleTimeString()
                  : t('syncNow')
          }`;

    const handleSwitchWindowMode = async () => {
        if (hostMode === 'sidepanel') {
            await sendBackgroundCommand({ action: 'OPEN_DETACHED_WINDOW' });
        } else {
            await sendBackgroundCommand({ action: 'OPEN_SIDE_PANEL' });
            window.close();
        }
    };

    return (
        <div className="lm-header">
            <Input
                ref={(inst) => {
                    searchInputRef.current = inst?.input ?? null;
                }}
                size="small"
                allowClear
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                        setSearchQuery('');
                        searchInputRef.current?.blur();
                    }
                }}
                prefix={<Search size={13} style={{ color: 'var(--lm-text-muted)' }} />}
                suffix={
                    searchQuery ? null : (
                        <span style={{ fontSize: 10, color: 'var(--lm-text-muted)' }}>
                            {shortcutLabel}
                        </span>
                    )
                }
                placeholder={t('search', 'Search')}
                style={{ flex: 1, minWidth: 0 }}
            />

            <Tooltip title={t('offlineModeDesc')}>
                <button
                    type="button"
                    className={`lm-offline-pill ${offlineOnlyMode ? '' : 'is-online'}`}
                    onClick={() => setSettingsModalOpen(true, 'general')}
                >
                    {offlineOnlyMode ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
                    <span>{offlineOnlyMode ? t('offlineModeBadge', 'Local') : 'Online'}</span>
                </button>
            </Tooltip>

            {showCloudButton && (
                <Tooltip title={cloudTooltip}>
                    <button
                        type="button"
                        className="lm-icon-btn"
                        disabled={syncing}
                        onClick={() => void handleCloudButtonClick()}
                        style={
                            hasSyncAlert
                                ? { color: '#ef4444' }
                                : syncMeta.lastSyncStatus === 'pushed' ||
                                    syncMeta.lastSyncStatus === 'pulled'
                                  ? { color: '#22be6b' }
                                  : undefined
                        }
                    >
                        {syncing ? (
                            <RefreshCw size={14} className="lm-spin" />
                        ) : hasSyncAlert ? (
                            <AlertTriangle size={14} />
                        ) : (
                            <Cloud size={15} />
                        )}
                    </button>
                </Tooltip>
            )}

            {!offlineOnlyMode && (
                <Tooltip title={t('aiAssistantTitle', 'AI Workspace Assistant')}>
                    <button
                        type="button"
                        className="lm-icon-btn"
                        style={aiConfig.enabled ? { color: 'var(--lm-primary)' } : undefined}
                        onClick={() => {
                            if (aiConfig.enabled) {
                                setAiModalOpen(true, 'digest');
                            } else {
                                setSettingsModalOpen(true, 'ai');
                            }
                        }}
                    >
                        <Sparkles size={14} />
                    </button>
                </Tooltip>
            )}

            <Tooltip title={t('openInDashboard', 'Open in Dashboard')}>
                <button
                    type="button"
                    className="lm-icon-btn"
                    onClick={() => void sendBackgroundCommand({ action: 'OPEN_DASHBOARD_TAB' })}
                >
                    <LayoutGrid size={15} />
                </button>
            </Tooltip>

            <Tooltip
                title={
                    hostMode === 'sidepanel'
                        ? t('openInWindow', 'Pop out to Detached Window')
                        : t('openInSidePanel', 'Switch to Side Panel')
                }
            >
                <button
                    type="button"
                    className="lm-icon-btn"
                    onClick={() => void handleSwitchWindowMode()}
                >
                    {hostMode === 'sidepanel' ? (
                        <PictureInPicture2 size={15} />
                    ) : (
                        <PanelRight size={15} />
                    )}
                </button>
            </Tooltip>

            <Tooltip title={t('settings', 'Settings')}>
                <button
                    type="button"
                    className="lm-icon-btn"
                    onClick={() => setSettingsModalOpen(true, 'general')}
                >
                    <Settings size={15} />
                </button>
            </Tooltip>
        </div>
    );
};
