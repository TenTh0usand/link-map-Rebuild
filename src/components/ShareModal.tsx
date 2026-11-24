import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    App as AntdApp,
    Button,
    Input,
    Modal,
    Segmented,
    Select,
    Switch,
    Tabs,
    Tag,
} from 'antd';
import {
    BookmarkCheck,
    Cloud,
    Copy,
    Download,
    ExternalLink,
    FileCode2,
    FileText,
    Image as ImageIcon,
    QrCode,
    RotateCcw,
} from 'lucide-react';

import { inferUrlCategory, normalizeSiteUrl } from '../core/categorizer';
import { exportNodesToMarkdown, exportNodesToText } from '../core/exporter';
import {
    buildShareUrl,
    buildStandaloneShareHtml,
    encodeShareBundle,
} from '../core/share-codec';
import { collectSubtreeTabs } from '../core/tree-engine';
import type { ShareBundle, ShareCardTheme, ShareItem, TabNode } from '../core/types';
import { downloadTextOrJsonFile } from '../services/browser-bridge';
import { t } from '../services/i18n';
import {
    copyCanvasAsPng,
    downloadCanvasAsPng,
    renderGroupShareCardCanvas,
    renderSingleUrlCardCanvas,
} from '../services/share-card-renderer';
import { sendBackgroundCommand } from '../services/sync-channel';
import { useWorkspaceStore } from '../store/workspace-store';

const THEME_OPTIONS: Array<{ value: ShareCardTheme; label: string }> = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'aurora', label: 'Aurora' },
    { value: 'minimal', label: 'Minimal' },
];

export const ShareModal: React.FC = () => {
    const { message } = AntdApp.useApp();
    const target = useWorkspaceStore((s) => s.shareModalTarget);
    const setShareModalTarget = useWorkspaceStore((s) => s.setShareModalTarget);
    const settings = useWorkspaceStore((s) => s.settings);
    const syncConfig = useWorkspaceStore((s) => s.syncConfig);
    const siteMetaMap = useWorkspaceStore((s) => s.siteMetaMap);
    const saveSiteDescription = useWorkspaceStore((s) => s.saveSiteDescription);
    const createR2ShortShare = useWorkspaceStore((s) => s.createR2ShortShare);

    const [cardTheme, setCardTheme] = useState<ShareCardTheme>('dark');
    const [showDesc, setShowDesc] = useState(true);
    const [showWatermark, setShowWatermark] = useState(true);
    const [customTitle, setCustomTitle] = useState('');
    const [customDesc, setCustomDesc] = useState('');
    const [previewDataUrl, setPreviewDataUrl] = useState<string>('');
    const [shortShareUrl, setShortShareUrl] = useState<string | null>(null);
    const [shortShareTtl, setShortShareTtl] = useState<number>(2592000);
    const [shortShareLoading, setShortShareLoading] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Sync editable defaults whenever target changes
    useEffect(() => {
        if (!target) return;
        setCardTheme(settings.theme === 'light' ? 'light' : 'dark');
        setShowDesc(settings.showSiteDescriptions);
        setShortShareUrl(null);
        if (target.mode === 'single') {
            setCustomTitle(target.tab.alias || target.tab.title || target.tab.url);
            const meta = siteMetaMap[normalizeSiteUrl(target.tab.url)];
            setCustomDesc(meta?.description || target.tab.description || '');
        } else {
            setCustomTitle(target.title);
            setCustomDesc('');
        }
    }, [target, settings.theme, settings.showSiteDescriptions, siteMetaMap]);

    // Deduplicated ShareItem[] for group mode
    const groupItems = useMemo<ShareItem[]>(() => {
        if (!target || target.mode !== 'group') return [];
        const seen = new Set<string>();
        const tabs: TabNode[] = target.nodes.flatMap((n) => collectSubtreeTabs(n));
        const out: ShareItem[] = [];
        for (const tab of tabs) {
            const url = tab.url || tab.pendingUrl;
            if (!url || seen.has(url)) continue;
            seen.add(url);
            const meta = siteMetaMap[normalizeSiteUrl(url)];
            out.push({
                title: tab.alias || tab.title || url,
                url,
                description: meta?.description || tab.description,
                category: meta?.category || tab.categoryHint || inferUrlCategory(url, tab.title),
            });
        }
        return out;
    }, [target, siteMetaMap]);

    const groupBundle = useMemo<ShareBundle | null>(() => {
        if (!target || target.mode !== 'group') return null;
        return {
            title: customTitle || target.title,
            description: customDesc || undefined,
            color: target.color,
            items: groupItems,
        };
    }, [target, customTitle, customDesc, groupItems]);

    const encodedGroup = useMemo(() => {
        if (!groupBundle) return null;
        return encodeShareBundle(groupBundle);
    }, [groupBundle]);

    const shareUrl = useMemo(() => {
        if (!encodedGroup) return '';
        const fallback =
            typeof chrome !== 'undefined' && chrome.runtime?.getURL
                ? chrome.runtime.getURL('/share.html')
                : 'https://linkmap.cc/share.html';
        return buildShareUrl(encodedGroup.encoded, settings.shareBaseUrl, fallback);
    }, [encodedGroup, settings.shareBaseUrl]);

    const canUseR2ShortLink =
        !settings.offlineOnlyMode &&
        syncConfig.provider === 'r2-worker' &&
        Boolean(syncConfig.r2Worker.endpoint.trim()) &&
        Boolean(syncConfig.r2Worker.token.trim());
    const effectiveShareUrl = shortShareUrl || shareUrl;
    const effectiveQrSupported = Boolean(shortShareUrl || encodedGroup?.qrSupported);

    // Render high-DPI canvas preview
    useEffect(() => {
        if (!target) return;
        let cancelled = false;

        void (async () => {
            const canvas =
                target.mode === 'single'
                    ? await renderSingleUrlCardCanvas({
                          title: customTitle || target.tab.title,
                          url: target.tab.url || target.tab.pendingUrl || '',
                          description: customDesc,
                          theme: cardTheme,
                          showDescription: showDesc,
                          showWatermark,
                      })
                    : await renderGroupShareCardCanvas({
                          title: customTitle || target.title,
                          description: customDesc,
                          color: target.color,
                          items: groupItems,
                          shareUrl: effectiveShareUrl,
                          qrSupported: effectiveQrSupported,
                          theme: cardTheme,
                          showDescriptions: showDesc,
                          showWatermark,
                      });

            if (cancelled) return;
            canvasRef.current = canvas;
            setPreviewDataUrl(canvas.toDataURL('image/png'));
        })();

        return () => {
            cancelled = true;
        };
    }, [
        target,
        customTitle,
        customDesc,
        cardTheme,
        showDesc,
        showWatermark,
        groupItems,
        effectiveShareUrl,
        effectiveQrSupported,
    ]);

    const handleCreateR2ShortLink = async () => {
        if (!groupBundle) return;
        setShortShareLoading(true);
        try {
            const res = await createR2ShortShare(groupBundle, shortShareTtl);
            setShortShareUrl(res.url);
            void message.success(t('r2ShortLinkCreated', 'R2 short share link generated'), 1.5);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            void message.error(msg);
        } finally {
            setShortShareLoading(false);
        }
    };

    if (!target) return null;

    const handleCopyPng = async () => {
        if (!canvasRef.current) return;
        try {
            await copyCanvasAsPng(canvasRef.current);
            void message.success('Card PNG copied to clipboard', 1.4);
        } catch {
            void message.error('Clipboard image copy failed; please use Download PNG');
        }
    };

    const handleDownloadPng = async () => {
        if (!canvasRef.current) return;
        const safeName = (customTitle || 'link-map-card')
            .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-')
            .slice(0, 40);
        await downloadCanvasAsPng(canvasRef.current, `${safeName}.png`);
    };

    const renderPreviewBox = () => (
        <div
            style={{
                borderRadius: 10,
                overflow: 'hidden',
                border: '1px solid var(--lm-border)',
                backgroundColor: 'var(--lm-bg-elevated)',
                textAlign: 'center',
            }}
        >
            {previewDataUrl && (
                <img
                    src={previewDataUrl}
                    alt="Share card preview"
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                />
            )}
        </div>
    );

    const renderStyleControls = () => (
        <div
            style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
            }}
        >
            <Segmented
                size="small"
                value={cardTheme}
                onChange={(v) => setCardTheme(v as ShareCardTheme)}
                options={THEME_OPTIONS}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Switch size="small" checked={showDesc} onChange={setShowDesc} />
                    {t('showSiteDescriptions', 'Descriptions')}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Switch size="small" checked={showWatermark} onChange={setShowWatermark} />
                    Watermark
                </span>
            </div>
        </div>
    );

    if (target.mode === 'single') {
        const rawUrl = target.tab.url || target.tab.pendingUrl || '';
        return (
            <Modal
                title={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <QrCode size={16} />
                        {t('shareSingleCard')}
                    </span>
                }
                open
                onCancel={() => setShareModalTarget(null)}
                footer={null}
                width={540}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {renderPreviewBox()}
                    {renderStyleControls()}

                    <Input
                        size="small"
                        value={customTitle}
                        onChange={(e) => setCustomTitle(e.target.value)}
                        addonBefore="Title"
                    />

                    <div style={{ display: 'flex', gap: 6 }}>
                        <Input
                            size="small"
                            value={customDesc}
                            onChange={(e) => setCustomDesc(e.target.value)}
                            placeholder={t('descriptionPlaceholder')}
                            style={{ flex: 1 }}
                        />
                        <Button
                            size="small"
                            icon={<BookmarkCheck size={13} />}
                            onClick={() => {
                                void saveSiteDescription(rawUrl, customDesc);
                                void message.success('Saved one-line description locally', 1.2);
                            }}
                        >
                            Save Note
                        </Button>
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Button
                            type="primary"
                            size="small"
                            icon={<ImageIcon size={13} />}
                            onClick={() => void handleCopyPng()}
                        >
                            {t('copyImage')}
                        </Button>
                        <Button
                            size="small"
                            icon={<Download size={13} />}
                            onClick={() => void handleDownloadPng()}
                        >
                            {t('downloadPng')}
                        </Button>
                        <Button
                            size="small"
                            icon={<Copy size={13} />}
                            onClick={() => {
                                void navigator.clipboard.writeText(rawUrl);
                                void message.success('URL copied', 1);
                            }}
                        >
                            {t('ctxMenuCopyLink')}
                        </Button>
                        <Button
                            size="small"
                            icon={<FileText size={13} />}
                            onClick={() => {
                                void navigator.clipboard.writeText(`[${customTitle}](${rawUrl})`);
                                void message.success('Markdown copied', 1);
                            }}
                        >
                            Markdown
                        </Button>
                    </div>
                </div>
            </Modal>
        );
    }

    const mdExport = exportNodesToMarkdown(target.nodes);
    const txtExport = exportNodesToText(target.nodes);

    return (
        <Modal
            title={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <QrCode size={16} />
                    {t('shareGroup')}
                    <Tag style={{ margin: 0 }}>{groupItems.length} links</Tag>
                </span>
            }
            open
            onCancel={() => setShareModalTarget(null)}
            footer={null}
            width={580}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                    <Input
                        size="small"
                        value={customTitle}
                        onChange={(e) => setCustomTitle(e.target.value)}
                        addonBefore="Title"
                        style={{ flex: 1 }}
                    />
                    <Input
                        size="small"
                        value={customDesc}
                        onChange={(e) => setCustomDesc(e.target.value)}
                        placeholder="Optional summary"
                        style={{ flex: 1 }}
                    />
                </div>

                <Tabs
                    size="small"
                    items={[
                        {
                            key: 'qr',
                            label: t('shareLinkAndQr'),
                            children: (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {renderPreviewBox()}
                                    {renderStyleControls()}

                                    {encodedGroup && !effectiveQrSupported && (
                                        <Alert
                                            type="warning"
                                            showIcon
                                            message={t('qrTooLargeHint')}
                                        />
                                    )}

                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <Input
                                            size="small"
                                            readOnly
                                            value={effectiveShareUrl}
                                            style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }}
                                        />
                                        <Button
                                            size="small"
                                            type="primary"
                                            icon={<Copy size={12} />}
                                            onClick={() => {
                                                void navigator.clipboard.writeText(
                                                    effectiveShareUrl,
                                                );
                                                void message.success('Share link copied', 1.2);
                                            }}
                                        >
                                            {t('copyShareLink')}
                                        </Button>
                                    </div>

                                    {canUseR2ShortLink && (
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                flexWrap: 'wrap',
                                            }}
                                        >
                                            <Select
                                                size="small"
                                                value={shortShareTtl}
                                                onChange={setShortShareTtl}
                                                style={{ width: 96 }}
                                                options={[
                                                    { value: 604800, label: '7 Days' },
                                                    { value: 2592000, label: '30 Days' },
                                                    { value: 0, label: 'Permanent' },
                                                ]}
                                            />
                                            <Button
                                                size="small"
                                                icon={<Cloud size={12} />}
                                                loading={shortShareLoading}
                                                onClick={() => void handleCreateR2ShortLink()}
                                            >
                                                {t('generateR2ShortLink')}
                                            </Button>
                                            {shortShareUrl && (
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<RotateCcw size={12} />}
                                                    onClick={() => setShortShareUrl(null)}
                                                >
                                                    {t('useLocalHashLink')}
                                                </Button>
                                            )}
                                        </div>
                                    )}

                                    {!settings.shareBaseUrl && !shortShareUrl && (
                                        <div style={{ fontSize: 11, color: 'var(--lm-text-muted)' }}>
                                            Tip: Default link opens inside this browser&apos;s built-in viewer. For phone QR scanning, host <code>share-web/index.html</code> and set its URL in Settings.
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        <Button
                                            size="small"
                                            icon={<ImageIcon size={13} />}
                                            onClick={() => void handleCopyPng()}
                                        >
                                            {t('copyImage')}
                                        </Button>
                                        <Button
                                            size="small"
                                            icon={<Download size={13} />}
                                            onClick={() => void handleDownloadPng()}
                                        >
                                            {t('downloadPng')}
                                        </Button>
                                        <Button
                                            size="small"
                                            icon={<ExternalLink size={13} />}
                                            onClick={() => {
                                                if (shortShareUrl) {
                                                    window.open(
                                                        shortShareUrl,
                                                        '_blank',
                                                        'noopener,noreferrer',
                                                    );
                                                } else {
                                                    void sendBackgroundCommand({
                                                        action: 'OPEN_SHARE_VIEWER_TAB',
                                                        hash: `lm1=${encodedGroup?.encoded ?? ''}`,
                                                    });
                                                }
                                            }}
                                        >
                                            {t('openShareViewer')}
                                        </Button>
                                    </div>
                                </div>
                            ),
                        },
                        {
                            key: 'html',
                            label: t('shareOfflineHtml'),
                            children: (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    <Alert
                                        type="info"
                                        showIcon
                                        icon={<FileCode2 size={15} />}
                                        message="100% Standalone Single-File HTML"
                                        description="Zero external network dependencies, built-in search & Markdown copy. Ideal for sharing large groups (50+ links) or offline archiving."
                                    />
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                        <Switch checked={showDesc} onChange={setShowDesc} size="small" />
                                        <span style={{ fontSize: 12 }}>{t('showSiteDescriptions')}</span>
                                    </div>
                                    <Button
                                        type="primary"
                                        icon={<Download size={14} />}
                                        onClick={() => {
                                            if (!groupBundle) return;
                                            const html = buildStandaloneShareHtml(groupBundle, {
                                                theme: cardTheme === 'light' || cardTheme === 'minimal' ? 'light' : 'dark',
                                                showDescriptions: showDesc,
                                            });
                                            const safeName = (groupBundle.title || 'link-map-share')
                                                .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-')
                                                .slice(0, 40);
                                            void downloadTextOrJsonFile(
                                                html,
                                                `${safeName}.html`,
                                                'text/html',
                                            );
                                        }}
                                    >
                                        {t('downloadHtml')} ({groupItems.length} links)
                                    </Button>
                                </div>
                            ),
                        },
                        {
                            key: 'text',
                            label: t('shareMarkdownTab'),
                            children: (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <Input.TextArea
                                        readOnly
                                        value={mdExport}
                                        rows={9}
                                        style={{ fontFamily: 'monospace', fontSize: 11 }}
                                    />
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <Button
                                            size="small"
                                            type="primary"
                                            icon={<Copy size={12} />}
                                            onClick={() => {
                                                void navigator.clipboard.writeText(mdExport);
                                                void message.success('Markdown copied', 1);
                                            }}
                                        >
                                            {t('batchCopyMd')}
                                        </Button>
                                        <Button
                                            size="small"
                                            icon={<FileText size={12} />}
                                            onClick={() => {
                                                void navigator.clipboard.writeText(txtExport);
                                                void message.success('TXT copied', 1);
                                            }}
                                        >
                                            {t('batchCopyTxt')}
                                        </Button>
                                    </div>
                                </div>
                            ),
                        },
                    ]}
                />
            </div>
        </Modal>
    );
};
