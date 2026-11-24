import React, { useRef } from 'react';
import {
    Alert,
    App as AntdApp,
    Button,
    Divider,
    Input,
    List,
    Modal,
    Segmented,
    Select,
    Switch,
    Tabs,
    Tag,
} from 'antd';
import { Download, History, RotateCcw, ShieldCheck, Trash2, Upload } from 'lucide-react';

import { parseLinkMapJson } from '../core/parsers/link-map-v1';
import { isTabsOutlinerExport, parseTabsOutlinerData } from '../core/parsers/tabs-outliner';
import type { OpenMode, ThemeSetting } from '../core/types';
import { db } from '../services/db';
import { t } from '../services/i18n';
import { sendBackgroundCommand } from '../services/sync-channel';
import { useWorkspaceStore, type SettingsTabKey } from '../store/workspace-store';
import { AiSettingsPanel } from './AiSettingsPanel';
import { CloudSyncPanel } from './CloudSyncPanel';

export const SettingsModal: React.FC = () => {
    const { message } = AntdApp.useApp();
    const open = useWorkspaceStore((s) => s.settingsModalOpen);
    const activeTab = useWorkspaceStore((s) => s.settingsTab);
    const settings = useWorkspaceStore((s) => s.settings);
    const backups = useWorkspaceStore((s) => s.backups);
    const setSettingsModalOpen = useWorkspaceStore((s) => s.setSettingsModalOpen);
    const updateSettings = useWorkspaceStore((s) => s.updateSettings);
    const exportBackupJson = useWorkspaceStore((s) => s.exportBackupJson);
    const createManualBackup = useWorkspaceStore((s) => s.createManualBackup);
    const restoreBackup = useWorkspaceStore((s) => s.restoreBackup);
    const deleteBackup = useWorkspaceStore((s) => s.deleteBackup);

    const linkMapInputRef = useRef<HTMLInputElement | null>(null);
    const tabsOutlinerInputRef = useRef<HTMLInputElement | null>(null);

    const handleImportLinkMapFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const raw = JSON.parse(await file.text()) as unknown;
            const parsed = parseLinkMapJson(raw);
            await db.stageImportData('linkMap', parsed.nodes, parsed.collections, parsed.exportTime);
            setSettingsModalOpen(false);
            await sendBackgroundCommand({ action: 'OPEN_IMPORT_WINDOW' });
        } catch {
            void message.error('Invalid Link Map JSON file');
        }
    };

    const handleImportTabsOutlinerFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const raw = JSON.parse(await file.text()) as unknown;
            if (!isTabsOutlinerExport(raw)) {
                void message.error('Invalid Tabs Outliner export file');
                return;
            }
            const nodes = parseTabsOutlinerData(raw);
            await db.stageImportData('tabsOutliner', nodes, []);
            setSettingsModalOpen(false);
            await sendBackgroundCommand({ action: 'OPEN_IMPORT_WINDOW' });
        } catch {
            void message.error('Failed to parse Tabs Outliner file');
        }
    };

    return (
        <Modal
            title={t('settings', 'Settings')}
            open={open}
            onCancel={() => setSettingsModalOpen(false)}
            footer={null}
            width="min(460px, 94vw)"
        >
            <input
                ref={linkMapInputRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={(e) => void handleImportLinkMapFile(e)}
            />
            <input
                ref={tabsOutlinerInputRef}
                type="file"
                accept=".json,.tree"
                style={{ display: 'none' }}
                onChange={(e) => void handleImportTabsOutlinerFile(e)}
            />

            <Tabs
                activeKey={activeTab}
                onChange={(k) => setSettingsModalOpen(true, k as SettingsTabKey)}
                items={[
                    {
                        key: 'general',
                        label: t('appearance', 'General & Privacy'),
                        children: (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                <Alert
                                    type={settings.offlineOnlyMode ? 'success' : 'info'}
                                    showIcon
                                    icon={<ShieldCheck size={16} />}
                                    message={
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                            }}
                                        >
                                            <span style={{ fontWeight: 600, fontSize: 12 }}>
                                                {t('offlineMode')}
                                            </span>
                                            <Switch
                                                size="small"
                                                checked={settings.offlineOnlyMode}
                                                onChange={(checked) =>
                                                    void updateSettings({
                                                        offlineOnlyMode: checked,
                                                    })
                                                }
                                            />
                                        </div>
                                    }
                                    description={
                                        <span style={{ fontSize: 11 }}>{t('offlineModeDesc')}</span>
                                    }
                                />

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: 8,
                                        }}
                                    >
                                        <span>{t('defaultOpenMode')}</span>
                                        <Segmented
                                            size="small"
                                            value={settings.openMode}
                                            onChange={(val) =>
                                                void updateSettings({ openMode: val as OpenMode })
                                            }
                                            options={[
                                                { value: 'sidepanel', label: t('modeSidePanel') },
                                                { value: 'window', label: t('modeWindow') },
                                            ]}
                                        />
                                    </div>
                                    <span style={{ fontSize: 11, color: 'var(--lm-text-muted)' }}>
                                        {t('defaultOpenModeDesc')}
                                    </span>
                                </div>

                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <span>{t('theme')}</span>
                                    <Select
                                        size="small"
                                        value={settings.theme}
                                        style={{ width: 140 }}
                                        onChange={(val) =>
                                            void updateSettings({ theme: val as ThemeSetting })
                                        }
                                        options={[
                                            { value: 'dark', label: t('themeDark') },
                                            { value: 'light', label: t('themeLight') },
                                            { value: 'auto', label: t('themeAuto') },
                                        ]}
                                    />
                                </div>

                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <span>{t('syncNativeTabGroups')}</span>
                                    <Switch
                                        size="small"
                                        checked={settings.syncNativeTabGroups}
                                        onChange={(checked) =>
                                            void updateSettings({ syncNativeTabGroups: checked })
                                        }
                                    />
                                </div>

                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <span>{t('autoScrollToActiveTab')}</span>
                                    <Switch
                                        size="small"
                                        checked={settings.autoScrollToActiveTab}
                                        onChange={(checked) =>
                                            void updateSettings({ autoScrollToActiveTab: checked })
                                        }
                                    />
                                </div>

                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <span>{t('createNewTabByLevel')}</span>
                                    <Switch
                                        size="small"
                                        checked={settings.createNewTabByLevel}
                                        onChange={(checked) =>
                                            void updateSettings({ createNewTabByLevel: checked })
                                        }
                                    />
                                </div>

                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <span>{t('showSiteDescriptions')}</span>
                                    <Switch
                                        size="small"
                                        checked={settings.showSiteDescriptions}
                                        onChange={(checked) =>
                                            void updateSettings({ showSiteDescriptions: checked })
                                        }
                                    />
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <span style={{ fontSize: 12 }}>{t('shareBaseUrl')}</span>
                                    <Input
                                        size="small"
                                        value={settings.shareBaseUrl}
                                        onChange={(e) =>
                                            void updateSettings({ shareBaseUrl: e.target.value })
                                        }
                                        placeholder="https://your-name.github.io/link-map-share/"
                                    />
                                    <span style={{ fontSize: 11, color: 'var(--lm-text-muted)' }}>
                                        {t('shareBaseUrlDesc')}
                                    </span>
                                </div>
                            </div>
                        ),
                    },
                    {
                        key: 'sync',
                        label: t('cloudSyncTab', 'Cloud Sync'),
                        children: <CloudSyncPanel />,
                    },
                    {
                        key: 'ai',
                        label: t('aiAssistantTab', 'AI'),
                        children: <AiSettingsPanel />,
                    },
                    {
                        key: 'backup',
                        label: t('settingsImportExport', 'Backup & Import'),
                        children: (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <Button
                                        size="small"
                                        type="primary"
                                        icon={<Download size={13} />}
                                        onClick={() => void exportBackupJson()}
                                    >
                                        {t('exportLinkMapData')}
                                    </Button>
                                    <Button
                                        size="small"
                                        icon={<Upload size={13} />}
                                        onClick={() => linkMapInputRef.current?.click()}
                                    >
                                        {t('importLinkMapData')}
                                    </Button>
                                    <Button
                                        size="small"
                                        icon={<Upload size={13} />}
                                        onClick={() => tabsOutlinerInputRef.current?.click()}
                                    >
                                        {t('importTabOutlinerData')}
                                    </Button>
                                </div>

                                <Divider style={{ margin: '6px 0' }} />

                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <span
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            fontWeight: 600,
                                            fontSize: 12,
                                        }}
                                    >
                                        <History size={13} />
                                        {t('localBackups')}
                                    </span>
                                    <Button
                                        size="small"
                                        onClick={() => {
                                            void createManualBackup();
                                            void message.success('Local snapshot saved', 1.2);
                                        }}
                                    >
                                        {t('createBackupNow')}
                                    </Button>
                                </div>

                                <List
                                    size="small"
                                    locale={{ emptyText: t('noBackups') }}
                                    dataSource={backups}
                                    style={{ maxHeight: 210, overflowY: 'auto' }}
                                    renderItem={(item) => (
                                        <List.Item
                                            actions={[
                                                <Button
                                                    key="restore"
                                                    size="small"
                                                    type="link"
                                                    icon={<RotateCcw size={12} />}
                                                    onClick={() => {
                                                        if (item.id !== undefined) {
                                                            void restoreBackup(item.id);
                                                            void message.success('Restored snapshot');
                                                        }
                                                    }}
                                                >
                                                    {t('restoreBackup')}
                                                </Button>,
                                                <Button
                                                    key="del"
                                                    size="small"
                                                    type="text"
                                                    danger
                                                    icon={<Trash2 size={12} />}
                                                    onClick={() =>
                                                        item.id !== undefined &&
                                                        void deleteBackup(item.id)
                                                    }
                                                />,
                                            ]}
                                        >
                                            <List.Item.Meta
                                                title={
                                                    <span style={{ fontSize: 11 }}>
                                                        {new Date(item.createdAt).toLocaleString()}
                                                    </span>
                                                }
                                                description={
                                                    <span style={{ fontSize: 11 }}>
                                                        <Tag style={{ fontSize: 10 }}>{item.reason}</Tag>
                                                        {item.nodeCount} nodes
                                                    </span>
                                                }
                                            />
                                        </List.Item>
                                    )}
                                />
                            </div>
                        ),
                    },
                ]}
            />
        </Modal>
    );
};
