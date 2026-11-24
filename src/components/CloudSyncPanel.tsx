import React, { useEffect, useState } from 'react';
import {
    Alert,
    App as AntdApp,
    Button,
    Divider,
    Input,
    Popconfirm,
    Segmented,
    Select,
    Switch,
    Tag,
} from 'antd';
import {
    AlertTriangle,
    CheckCircle2,
    Cloud,
    Copy,
    Download,
    Lock,
    RefreshCw,
    ShieldOff,
    Upload,
} from 'lucide-react';

import { t } from '../services/i18n';
import {
    R2_RECOMMENDED_CORS_JSON,
    resolveS3Endpoint,
} from '../services/sync/providers/s3-r2-provider';
import { WEBDAV_PRESETS } from '../services/sync/providers/webdav-provider';
import type {
    ActiveSyncProviderType,
    SyncConfig,
    WebDavPreset,
} from '../services/sync/types';
import { useWorkspaceStore } from '../store/workspace-store';

export const CloudSyncPanel: React.FC = () => {
    const { message } = AntdApp.useApp();
    const settings = useWorkspaceStore((s) => s.settings);
    const updateSettings = useWorkspaceStore((s) => s.updateSettings);
    const syncConfig = useWorkspaceStore((s) => s.syncConfig);
    const syncMeta = useWorkspaceStore((s) => s.syncMeta);
    const syncing = useWorkspaceStore((s) => s.syncing);
    const syncConflict = useWorkspaceStore((s) => s.syncConflict);
    const saveSyncConfig = useWorkspaceStore((s) => s.saveSyncConfig);
    const testSyncConnection = useWorkspaceStore((s) => s.testSyncConnection);
    const runCloudSync = useWorkspaceStore((s) => s.runCloudSync);
    const resolveSyncConflict = useWorkspaceStore((s) => s.resolveSyncConflict);
    const dismissSyncConflict = useWorkspaceStore((s) => s.dismissSyncConflict);

    const [draft, setDraft] = useState<SyncConfig>(syncConfig);
    const [testing, setTesting] = useState(false);
    const [testStatus, setTestStatus] = useState<{
        ok: boolean;
        latencyMs: number;
        message?: string;
    } | null>(null);

    useEffect(() => {
        setDraft(syncConfig);
    }, [syncConfig]);

    const handleWebDavPresetChange = (preset: WebDavPreset) => {
        const meta = WEBDAV_PRESETS[preset];
        setDraft((prev) => ({
            ...prev,
            webdav: {
                ...prev.webdav,
                preset,
                endpoint: meta.defaultEndpoint || prev.webdav.endpoint,
                basePath: prev.webdav.basePath || meta.defaultBasePath,
            },
        }));
        setTestStatus(null);
    };

    const handleSaveConfig = async () => {
        await saveSyncConfig(draft);
        void message.success(t('syncConfigSaved', 'Sync settings saved'), 1.2);
    };

    const handleTestConnection = async () => {
        setTesting(true);
        setTestStatus(null);
        try {
            const res = await testSyncConnection(draft);
            setTestStatus(res);
            if (res.ok) {
                void message.success(`${res.message ?? 'Connected'} (${res.latencyMs}ms)`, 2);
            } else {
                void message.error(res.message ?? 'Connection failed');
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setTestStatus({ ok: false, latencyMs: 0, message: msg });
            void message.error(msg);
        } finally {
            setTesting(false);
        }
    };

    const handleRunSync = async (mode: 'smart' | 'forcePush' | 'forcePull') => {
        await saveSyncConfig(draft);
        const res = await runCloudSync(mode);
        if (res.status === 'pushed' || res.status === 'pulled') {
            void message.success(res.message ?? 'Sync completed', 1.5);
        } else if (res.status === 'noop') {
            void message.info(res.message ?? 'Already up to date', 1.2);
        } else if (res.status === 'conflict') {
            void message.warning(res.message ?? 'Sync conflict detected');
        } else {
            void message.error(res.message ?? 'Sync failed');
        }
    };

    const disabledByOffline = settings.offlineOnlyMode;
    const isActiveProvider =
        draft.provider !== 'none' && draft.provider !== 'google-drive';

    const r2DerivedEndpoint = resolveS3Endpoint('r2', draft.r2);

    const statusColorMap: Record<string, string> = {
        pushed: 'green',
        pulled: 'blue',
        noop: 'default',
        conflict: 'orange',
        error: 'red',
        idle: 'default',
    };

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                maxHeight: '62vh',
                overflowY: 'auto',
                paddingRight: 2,
            }}
        >
            {disabledByOffline && (
                <Alert
                    type="warning"
                    showIcon
                    icon={<ShieldOff size={15} />}
                    message={
                        <span style={{ fontSize: 12, fontWeight: 600 }}>
                            {t('syncOfflineBannerTitle')}
                        </span>
                    }
                    description={
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                                fontSize: 11,
                            }}
                        >
                            <span>{t('syncOfflineBannerDesc')}</span>
                            <div>
                                <Button
                                    size="small"
                                    type="primary"
                                    onClick={() =>
                                        void updateSettings({ offlineOnlyMode: false })
                                    }
                                >
                                    {t('disableOfflineModeBtn')}
                                </Button>
                            </div>
                        </div>
                    }
                />
            )}

            {syncConflict && (
                <Alert
                    type="error"
                    showIcon
                    icon={<AlertTriangle size={15} />}
                    message={
                        <span style={{ fontSize: 12, fontWeight: 600 }}>
                            {t('syncConflictTitle')}
                        </span>
                    }
                    description={
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                                fontSize: 11,
                            }}
                        >
                            <span>
                                {t('syncConflictDesc')} (Local: {syncConflict.localCounts.nodes}{' '}
                                nodes / {syncConflict.localCounts.collections} groups · Remote:{' '}
                                {new Date(syncConflict.remoteUpdatedAt).toLocaleString()})
                            </span>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <Button
                                    size="small"
                                    type="primary"
                                    loading={syncing}
                                    onClick={() =>
                                        void resolveSyncConflict('mergeBoth').then((r) => {
                                            if (r.status === 'pushed') {
                                                void message.success(r.message ?? 'Merged');
                                            }
                                        })
                                    }
                                >
                                    {t('syncConflictMerge')}
                                </Button>
                                <Button
                                    size="small"
                                    loading={syncing}
                                    onClick={() => void resolveSyncConflict('keepLocal')}
                                >
                                    {t('syncConflictKeepLocal')}
                                </Button>
                                <Button
                                    size="small"
                                    danger
                                    loading={syncing}
                                    onClick={() => void resolveSyncConflict('keepRemote')}
                                >
                                    {t('syncConflictKeepRemote')}
                                </Button>
                                <Button size="small" type="text" onClick={dismissSyncConflict}>
                                    Dismiss
                                </Button>
                            </div>
                        </div>
                    }
                />
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{t('syncProvider')}</span>
                <Select
                    size="small"
                    value={draft.provider}
                    onChange={(val) => {
                        setDraft((prev) => ({
                            ...prev,
                            provider: val as ActiveSyncProviderType,
                        }));
                        setTestStatus(null);
                    }}
                    options={[
                        { value: 'none', label: t('syncProviderNone') },
                        { value: 'webdav', label: t('syncProviderWebDav') },
                        { value: 'r2', label: t('syncProviderR2') },
                        { value: 'r2-worker', label: t('syncProviderR2Worker') },
                        { value: 's3', label: t('syncProviderS3') },
                        { value: 'google-drive', label: t('syncProviderGoogleDrive') },
                    ]}
                />
            </div>

            {draft.provider === 'webdav' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Segmented
                        size="small"
                        block
                        value={draft.webdav.preset}
                        onChange={(v) => handleWebDavPresetChange(v as WebDavPreset)}
                        options={[
                            { value: 'jianguoyun', label: '坚果云' },
                            { value: '123pan', label: '123云盘' },
                            { value: 'openlist', label: 'OpenList' },
                            { value: 'custom', label: '自定义' },
                        ]}
                    />

                    <Input
                        size="small"
                        addonBefore="Endpoint"
                        value={draft.webdav.endpoint}
                        onChange={(e) =>
                            setDraft((prev) => ({
                                ...prev,
                                webdav: { ...prev.webdav, endpoint: e.target.value },
                            }))
                        }
                        placeholder="https://dav.jianguoyun.com/dav/"
                    />
                    <Input
                        size="small"
                        addonBefore="Folder"
                        value={draft.webdav.basePath}
                        onChange={(e) =>
                            setDraft((prev) => ({
                                ...prev,
                                webdav: { ...prev.webdav, basePath: e.target.value },
                            }))
                        }
                        placeholder="LinkMap"
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                        <Input
                            size="small"
                            addonBefore="User"
                            value={draft.webdav.username}
                            onChange={(e) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    webdav: { ...prev.webdav, username: e.target.value },
                                }))
                            }
                            style={{ flex: 1 }}
                        />
                        <Input.Password
                            size="small"
                            placeholder="App Password / Token"
                            value={draft.webdav.password}
                            onChange={(e) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    webdav: { ...prev.webdav, password: e.target.value },
                                }))
                            }
                            style={{ flex: 1 }}
                        />
                    </div>

                    {draft.webdav.preset === 'jianguoyun' && (
                        <Alert
                            type="info"
                            showIcon
                            style={{ fontSize: 11 }}
                            message={t('webdavTipJianguoyun')}
                        />
                    )}
                    {draft.webdav.preset === '123pan' && (
                        <Alert
                            type="info"
                            showIcon
                            style={{ fontSize: 11 }}
                            message={t('webdavTip123Pan')}
                        />
                    )}
                    {draft.webdav.preset === 'openlist' && (
                        <Alert
                            type="info"
                            showIcon
                            style={{ fontSize: 11 }}
                            message={t('webdavTipOpenList')}
                        />
                    )}
                </div>
            )}

            {draft.provider === 'r2' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Input
                        size="small"
                        addonBefore="Account ID"
                        value={draft.r2.accountId}
                        onChange={(e) =>
                            setDraft((prev) => ({
                                ...prev,
                                r2: { ...prev.r2, accountId: e.target.value },
                            }))
                        }
                        placeholder="Cloudflare 32-char Account ID"
                    />
                    <Input
                        size="small"
                        addonBefore="Endpoint"
                        value={draft.r2.endpoint}
                        onChange={(e) =>
                            setDraft((prev) => ({
                                ...prev,
                                r2: { ...prev.r2, endpoint: e.target.value },
                            }))
                        }
                        placeholder={
                            r2DerivedEndpoint ||
                            'https://<accountId>.r2.cloudflarestorage.com'
                        }
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                        <Input
                            size="small"
                            addonBefore="Bucket"
                            value={draft.r2.bucket}
                            onChange={(e) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    r2: { ...prev.r2, bucket: e.target.value },
                                }))
                            }
                            style={{ flex: 1 }}
                        />
                        <Input
                            size="small"
                            addonBefore="Prefix"
                            value={draft.r2.prefix}
                            onChange={(e) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    r2: { ...prev.r2, prefix: e.target.value },
                                }))
                            }
                            style={{ flex: 1 }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <Input
                            size="small"
                            addonBefore="AccessKey"
                            value={draft.r2.accessKeyId}
                            onChange={(e) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    r2: { ...prev.r2, accessKeyId: e.target.value },
                                }))
                            }
                            style={{ flex: 1 }}
                        />
                        <Input.Password
                            size="small"
                            placeholder="Secret Access Key"
                            value={draft.r2.secretAccessKey}
                            onChange={(e) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    r2: { ...prev.r2, secretAccessKey: e.target.value },
                                }))
                            }
                            style={{ flex: 1 }}
                        />
                    </div>
                    <Alert
                        type="info"
                        showIcon
                        style={{ fontSize: 11 }}
                        message={
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 8,
                                }}
                            >
                                <span>{t('r2DirectTip')}</span>
                                <Button
                                    size="small"
                                    icon={<Copy size={11} />}
                                    onClick={() => {
                                        void navigator.clipboard.writeText(
                                            R2_RECOMMENDED_CORS_JSON,
                                        );
                                        void message.success(t('r2CorsCopied'), 1.5);
                                    }}
                                >
                                    {t('copyR2Cors')}
                                </Button>
                            </div>
                        }
                    />
                </div>
            )}

            {draft.provider === 'r2-worker' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Input
                        size="small"
                        addonBefore="Worker URL"
                        value={draft.r2Worker.endpoint}
                        onChange={(e) =>
                            setDraft((prev) => ({
                                ...prev,
                                r2Worker: { ...prev.r2Worker, endpoint: e.target.value },
                            }))
                        }
                        placeholder="https://sync.yourdomain.com"
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                        <Input.Password
                            size="small"
                            placeholder="Bearer AUTH_TOKEN"
                            value={draft.r2Worker.token}
                            onChange={(e) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    r2Worker: { ...prev.r2Worker, token: e.target.value },
                                }))
                            }
                            style={{ flex: 2 }}
                        />
                        <Input
                            size="small"
                            addonBefore="Prefix"
                            value={draft.r2Worker.prefix}
                            onChange={(e) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    r2Worker: { ...prev.r2Worker, prefix: e.target.value },
                                }))
                            }
                            style={{ flex: 1 }}
                        />
                    </div>
                    <Alert
                        type="info"
                        showIcon
                        style={{ fontSize: 11 }}
                        message={t('r2WorkerTip')}
                    />
                </div>
            )}

            {draft.provider === 's3' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Input
                        size="small"
                        addonBefore="Endpoint"
                        value={draft.s3.endpoint}
                        onChange={(e) =>
                            setDraft((prev) => ({
                                ...prev,
                                s3: { ...prev.s3, endpoint: e.target.value },
                            }))
                        }
                        placeholder="https://s3.us-east-1.amazonaws.com"
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                        <Input
                            size="small"
                            addonBefore="Region"
                            value={draft.s3.region}
                            onChange={(e) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    s3: { ...prev.s3, region: e.target.value },
                                }))
                            }
                            style={{ flex: 1 }}
                        />
                        <Input
                            size="small"
                            addonBefore="Bucket"
                            value={draft.s3.bucket}
                            onChange={(e) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    s3: { ...prev.s3, bucket: e.target.value },
                                }))
                            }
                            style={{ flex: 1 }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <Input
                            size="small"
                            addonBefore="AccessKey"
                            value={draft.s3.accessKeyId}
                            onChange={(e) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    s3: { ...prev.s3, accessKeyId: e.target.value },
                                }))
                            }
                            style={{ flex: 1 }}
                        />
                        <Input.Password
                            size="small"
                            placeholder="Secret Access Key"
                            value={draft.s3.secretAccessKey}
                            onChange={(e) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    s3: { ...prev.s3, secretAccessKey: e.target.value },
                                }))
                            }
                            style={{ flex: 1 }}
                        />
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        }}
                    >
                        <Input
                            size="small"
                            addonBefore="Prefix"
                            value={draft.s3.prefix}
                            onChange={(e) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    s3: { ...prev.s3, prefix: e.target.value },
                                }))
                            }
                            style={{ flex: 1 }}
                        />
                        <span style={{ fontSize: 11 }}>
                            Path-Style{' '}
                            <Switch
                                size="small"
                                checked={draft.s3.forcePathStyle}
                                onChange={(checked) =>
                                    setDraft((prev) => ({
                                        ...prev,
                                        s3: { ...prev.s3, forcePathStyle: checked },
                                    }))
                                }
                            />
                        </span>
                    </div>
                </div>
            )}

            {draft.provider === 'google-drive' && (
                <Alert
                    type="info"
                    showIcon
                    message={t('googleDrivePlannedTitle')}
                    description={
                        <span style={{ fontSize: 11 }}>{t('googleDrivePlannedDesc')}</span>
                    }
                />
            )}

            {isActiveProvider && (
                <>
                    <Divider style={{ margin: '4px 0' }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                                    gap: 5,
                                    fontSize: 12,
                                }}
                            >
                                <Lock size={13} />
                                {t('syncE2eeLabel')}
                            </span>
                            <Switch
                                size="small"
                                checked={draft.e2eeEnabled}
                                onChange={(checked) =>
                                    setDraft((prev) => ({ ...prev, e2eeEnabled: checked }))
                                }
                            />
                        </div>
                        {draft.e2eeEnabled && (
                            <Input.Password
                                size="small"
                                value={draft.e2eePassphrase}
                                onChange={(e) =>
                                    setDraft((prev) => ({
                                        ...prev,
                                        e2eePassphrase: e.target.value,
                                    }))
                                }
                                placeholder={t('syncE2eePlaceholder')}
                            />
                        )}

                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 8,
                            }}
                        >
                            <span style={{ fontSize: 12 }}>{t('syncAutoSync')}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Select
                                    size="small"
                                    disabled={!draft.autoSync}
                                    value={draft.autoSyncIntervalSec}
                                    style={{ width: 88 }}
                                    onChange={(val) =>
                                        setDraft((prev) => ({
                                            ...prev,
                                            autoSyncIntervalSec: val,
                                        }))
                                    }
                                    options={[
                                        { value: 30, label: '30s' },
                                        { value: 60, label: '60s' },
                                        { value: 120, label: '2m' },
                                        { value: 300, label: '5m' },
                                    ]}
                                />
                                <Switch
                                    size="small"
                                    checked={draft.autoSync}
                                    onChange={(checked) =>
                                        setDraft((prev) => ({ ...prev, autoSync: checked }))
                                    }
                                />
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                        <Button size="small" onClick={() => void handleSaveConfig()}>
                            {t('syncSaveConfig')}
                        </Button>
                        <Button
                            size="small"
                            disabled={disabledByOffline}
                            loading={testing}
                            onClick={() => void handleTestConnection()}
                        >
                            {t('syncTestConnection')}
                        </Button>
                        <Button
                            size="small"
                            type="primary"
                            icon={<RefreshCw size={12} />}
                            disabled={disabledByOffline}
                            loading={syncing}
                            onClick={() => void handleRunSync('smart')}
                        >
                            {t('syncNow')}
                        </Button>
                        <Popconfirm
                            title={t('syncForcePushConfirm')}
                            onConfirm={() => void handleRunSync('forcePush')}
                            disabled={disabledByOffline}
                        >
                            <Button
                                size="small"
                                icon={<Upload size={12} />}
                                disabled={disabledByOffline || syncing}
                            >
                                {t('syncForcePush')}
                            </Button>
                        </Popconfirm>
                        <Popconfirm
                            title={t('syncForcePullConfirm')}
                            onConfirm={() => void handleRunSync('forcePull')}
                            disabled={disabledByOffline}
                        >
                            <Button
                                size="small"
                                danger
                                icon={<Download size={12} />}
                                disabled={disabledByOffline || syncing}
                            >
                                {t('syncForcePull')}
                            </Button>
                        </Popconfirm>
                    </div>

                    {testStatus && (
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: 11,
                                color: testStatus.ok ? '#22be6b' : '#ef4444',
                            }}
                        >
                            {testStatus.ok ? (
                                <CheckCircle2 size={13} />
                            ) : (
                                <AlertTriangle size={13} />
                            )}
                            <span>
                                {testStatus.message}
                                {testStatus.ok ? ` (${testStatus.latencyMs}ms)` : ''}
                            </span>
                        </div>
                    )}
                </>
            )}

            {!isActiveProvider && (
                <div>
                    <Button size="small" onClick={() => void handleSaveConfig()}>
                        {t('syncSaveConfig')}
                    </Button>
                </div>
            )}

            <div
                style={{
                    marginTop: 4,
                    padding: '6px 8px',
                    borderRadius: 6,
                    backgroundColor: 'var(--lm-bg-elevated)',
                    border: '1px solid var(--lm-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    fontSize: 11,
                    color: 'var(--lm-text-muted)',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                    }}
                >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Cloud size={12} />
                        Device: <code>{syncMeta.deviceId || '-'}</code>
                    </span>
                    <Tag
                        color={statusColorMap[syncMeta.lastSyncStatus] ?? 'default'}
                        style={{ margin: 0, fontSize: 10 }}
                    >
                        {syncMeta.lastSyncStatus}
                    </Tag>
                </div>
                <div>
                    {t('syncLastTime')}:{' '}
                    {syncMeta.lastSyncedAt
                        ? new Date(syncMeta.lastSyncedAt).toLocaleString()
                        : t('syncNever')}
                </div>
                {syncMeta.lastSyncMessage && (
                    <div style={{ wordBreak: 'break-word' }}>{syncMeta.lastSyncMessage}</div>
                )}
            </div>
        </div>
    );
};
