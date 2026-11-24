import React, { useEffect, useState } from 'react';
import {
    Alert,
    App as AntdApp,
    Button,
    Divider,
    Input,
    Select,
    Switch,
} from 'antd';
import {
    AlertTriangle,
    CheckCircle2,
    Shield,
    ShieldOff,
    Sparkles,
} from 'lucide-react';

import { AI_PRESETS } from '../services/ai/ai-client';
import type { AiConfig, AiPreset } from '../services/ai/types';
import { t } from '../services/i18n';
import { useWorkspaceStore } from '../store/workspace-store';

export const AiSettingsPanel: React.FC = () => {
    const { message } = AntdApp.useApp();
    const settings = useWorkspaceStore((s) => s.settings);
    const updateSettings = useWorkspaceStore((s) => s.updateSettings);
    const aiConfig = useWorkspaceStore((s) => s.aiConfig);
    const saveAiConfig = useWorkspaceStore((s) => s.saveAiConfig);
    const testAiConnectionAction = useWorkspaceStore((s) => s.testAiConnectionAction);
    const setSettingsModalOpen = useWorkspaceStore((s) => s.setSettingsModalOpen);
    const setAiModalOpen = useWorkspaceStore((s) => s.setAiModalOpen);

    const [draft, setDraft] = useState<AiConfig>(aiConfig);
    const [blacklistText, setBlacklistText] = useState(aiConfig.excludedDomains.join('\n'));
    const [testing, setTesting] = useState(false);
    const [testStatus, setTestStatus] = useState<{
        ok: boolean;
        latencyMs: number;
        message?: string;
    } | null>(null);

    useEffect(() => {
        setDraft(aiConfig);
        setBlacklistText(aiConfig.excludedDomains.join('\n'));
    }, [aiConfig]);

    const buildNormalizedDraft = (): AiConfig => ({
        ...draft,
        excludedDomains: blacklistText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
    });

    const handlePresetChange = (preset: AiPreset) => {
        const meta = AI_PRESETS[preset];
        setDraft((prev) => ({
            ...prev,
            preset,
            baseUrl: meta.baseUrl || prev.baseUrl,
            model: meta.defaultModel || prev.model,
        }));
        setTestStatus(null);
    };

    const handleSave = async () => {
        const next = buildNormalizedDraft();
        await saveAiConfig(next);
        void message.success(t('aiConfigSaved', 'AI settings saved'), 1.2);
    };

    const handleTest = async () => {
        setTesting(true);
        setTestStatus(null);
        try {
            const next = buildNormalizedDraft();
            const res = await testAiConnectionAction(next);
            setTestStatus(res);
            if (res.ok) {
                void message.success(`${res.message ?? 'Connected'} (${res.latencyMs}ms)`, 2);
            } else {
                void message.error(res.message ?? 'AI test failed');
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setTestStatus({ ok: false, latencyMs: 0, message: msg });
            void message.error(msg);
        } finally {
            setTesting(false);
        }
    };

    const disabledByOffline = settings.offlineOnlyMode;

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
                            {t('aiOfflineBannerTitle')}
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
                            <span>{t('aiOfflineBannerDesc')}</span>
                            <div>
                                <Button
                                    size="small"
                                    type="primary"
                                    onClick={() => void updateSettings({ offlineOnlyMode: false })}
                                >
                                    {t('disableOfflineModeBtn')}
                                </Button>
                            </div>
                        </div>
                    }
                />
            )}

            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}
            >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                    <Sparkles size={14} style={{ color: 'var(--lm-primary)' }} />
                    {t('aiEnableToggle')}
                </span>
                <Switch
                    size="small"
                    checked={draft.enabled}
                    onChange={(checked) => setDraft((prev) => ({ ...prev, enabled: checked }))}
                />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--lm-text-muted)' }}>{t('aiProvider')}</span>
                <Select
                    size="small"
                    value={draft.preset}
                    onChange={(v) => handlePresetChange(v as AiPreset)}
                    options={(Object.keys(AI_PRESETS) as AiPreset[]).map((key) => ({
                        value: key,
                        label: AI_PRESETS[key].label,
                    }))}
                />
            </div>

            <Input
                size="small"
                addonBefore="Base URL"
                value={draft.baseUrl}
                onChange={(e) => setDraft((prev) => ({ ...prev, baseUrl: e.target.value }))}
                placeholder="https://api.deepseek.com/v1"
            />

            <div style={{ display: 'flex', gap: 6 }}>
                <Input.Password
                    size="small"
                    placeholder={
                        AI_PRESETS[draft.preset].requiresKey
                            ? 'API Key (sk-...)'
                            : 'API Key (Optional)'
                    }
                    value={draft.apiKey}
                    onChange={(e) => setDraft((prev) => ({ ...prev, apiKey: e.target.value }))}
                    style={{ flex: 1 }}
                />
                <Input
                    size="small"
                    addonBefore="Model"
                    value={draft.model}
                    onChange={(e) => setDraft((prev) => ({ ...prev, model: e.target.value }))}
                    style={{ flex: 1 }}
                />
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12 }}>{t('aiOutputLang')}</span>
                <Select
                    size="small"
                    value={draft.language}
                    style={{ width: 110 }}
                    onChange={(val) =>
                        setDraft((prev) => ({ ...prev, language: val as 'zh' | 'en' }))
                    }
                    options={[
                        { value: 'zh', label: '简体中文' },
                        { value: 'en', label: 'English' },
                    ]}
                />
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12 }}>{t('aiMaxItems')}</span>
                <Select
                    size="small"
                    value={draft.maxItemsPerRequest}
                    style={{ width: 110 }}
                    onChange={(val) =>
                        setDraft((prev) => ({ ...prev, maxItemsPerRequest: val }))
                    }
                    options={[
                        { value: 20, label: '20 tabs' },
                        { value: 40, label: '40 tabs' },
                        { value: 60, label: '60 tabs' },
                        { value: 80, label: '80 tabs' },
                    ]}
                />
            </div>

            <Divider style={{ margin: '4px 0' }} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                    <Shield size={13} />
                    {t('aiStripQuery')}
                </span>
                <Switch
                    size="small"
                    checked={draft.stripQueryParams}
                    onChange={(checked) =>
                        setDraft((prev) => ({ ...prev, stripQueryParams: checked }))
                    }
                />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--lm-text-muted)' }}>
                    {t('aiDomainBlacklist')}
                </span>
                <Input.TextArea
                    rows={3}
                    value={blacklistText}
                    onChange={(e) => setBlacklistText(e.target.value)}
                    style={{ fontFamily: 'monospace', fontSize: 11 }}
                    placeholder="localhost&#10;192.168.&#10;bank&#10;mail."
                />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button size="small" onClick={() => void handleSave()}>
                    {t('syncSaveConfig')}
                </Button>
                <Button
                    size="small"
                    disabled={disabledByOffline}
                    loading={testing}
                    onClick={() => void handleTest()}
                >
                    {t('syncTestConnection')}
                </Button>
                <Button
                    size="small"
                    type="primary"
                    icon={<Sparkles size={12} />}
                    disabled={disabledByOffline || !draft.enabled}
                    onClick={() => {
                        void handleSave().then(() => {
                            setSettingsModalOpen(false);
                            setAiModalOpen(true, 'digest');
                        });
                    }}
                >
                    {t('openAiAssistant')}
                </Button>
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
        </div>
    );
};
