import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    App as AntdApp,
    Button,
    Checkbox,
    ConfigProvider,
    Empty,
    Input,
    Modal,
    Tag,
    theme as antdTheme,
} from 'antd';
import {
    Copy,
    Download,
    ExternalLink,
    FolderInput,
    QrCode,
    Search,
    ShieldCheck,
} from 'lucide-react';

import { extractHostname } from '../core/categorizer';
import {
    buildStandaloneShareHtml,
    decodeShareBundle,
    extractEncodedFromShareUrlOrHash,
} from '../core/share-codec';
import { createCollectionNode, createNodeId, insertExternalNodes } from '../core/tree-engine';
import {
    TAB_GROUP_COLOR_HEX,
    type ShareBundle,
    type ShareItem,
    type TabNode,
} from '../core/types';
import {
    downloadTextOrJsonFile,
    getFaviconUrl,
    openTabsAsChromeGroup,
} from '../services/browser-bridge';
import { db } from '../services/db';
import { t } from '../services/i18n';
import {
    copyCanvasAsPng,
    downloadCanvasAsPng,
    renderSingleUrlCardCanvas,
} from '../services/share-card-renderer';
import { broadcastImportNodesRequest, broadcastStateUpdated } from '../services/sync-channel';

import '../styles/workspace.css';

function shareItemToTabNode(item: ShareItem, idx: number): TabNode {
    return {
        id: createNodeId('tab'),
        nodeType: 'tab',
        title: item.title,
        url: item.url,
        description: item.description,
        index: idx,
        active: false,
        closed: true,
        expanded: true,
        children: [],
    };
}

const ShareViewerInner: React.FC<{ onThemeResolved: (isDark: boolean) => void }> = ({
    onThemeResolved,
}) => {
    const { message } = AntdApp.useApp();
    const [bundle, setBundle] = useState<ShareBundle | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [pasteInput, setPasteInput] = useState('');
    const [query, setQuery] = useState('');
    const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
    const [qrModal, setQrModal] = useState<{ item: ShareItem; previewUrl: string } | null>(null);
    const [qrCanvas, setQrCanvas] = useState<HTMLCanvasElement | null>(null);

    const decodeHashInput = (raw: string) => {
        const token = extractEncodedFromShareUrlOrHash(raw);
        if (!token) {
            setErrorMsg('No valid #lm1=... share payload found');
            setBundle(null);
            return;
        }
        try {
            const decoded = decodeShareBundle(token);
            setBundle(decoded);
            setSelectedUrls(decoded.items.map((i) => i.url));
            setErrorMsg(null);
        } catch {
            setErrorMsg('Failed to decode share link. Please check that the full URL was copied.');
            setBundle(null);
        }
    };

    useEffect(() => {
        void db.getSettings().then((s) => {
            const isDark =
                s.theme === 'auto'
                    ? window.matchMedia('(prefers-color-scheme: dark)').matches
                    : s.theme === 'dark';
            onThemeResolved(isDark);
        });
        if (window.location.hash) {
            decodeHashInput(window.location.hash);
        }
        const onHash = () => {
            if (window.location.hash) decodeHashInput(window.location.hash);
        };
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, [onThemeResolved]);

    const filteredItems = useMemo(() => {
        if (!bundle) return [];
        const q = query.trim().toLowerCase();
        if (!q) return bundle.items;
        return bundle.items.filter(
            (i) =>
                i.title.toLowerCase().includes(q) ||
                i.url.toLowerCase().includes(q) ||
                (i.description ?? '').toLowerCase().includes(q),
        );
    }, [bundle, query]);

    const selectedItems = useMemo(() => {
        if (!bundle) return [];
        const set = new Set(selectedUrls);
        return bundle.items.filter((i) => set.has(i.url));
    }, [bundle, selectedUrls]);

    const handleImportToLinkMap = async () => {
        if (!bundle || selectedItems.length === 0) return;
        const tabNodes = selectedItems.map(shareItemToTabNode);
        const handled = await broadcastImportNodesRequest(tabNodes, bundle.title);
        if (!handled) {
            const snap = await db.getSnapshot();
            const existingNodes = snap?.nodes ?? [];
            const existingCols = snap?.collections ?? [];
            const col = createCollectionNode(
                bundle.title,
                bundle.color ?? 'blue',
                'workspace',
                tabNodes,
            );
            await db.saveSnapshot(existingNodes, [col, ...existingCols]);
            broadcastStateUpdated();
        }
        void message.success(t('importSuccess', 'Imported to Link Map'), 1.5);
    };

    const handleImportToTree = async () => {
        if (!bundle || selectedItems.length === 0) return;
        const tabNodes = selectedItems.map(shareItemToTabNode);
        const handled = await broadcastImportNodesRequest(tabNodes);
        if (!handled) {
            const snap = await db.getSnapshot();
            const existingNodes = snap?.nodes ?? [];
            const existingCols = snap?.collections ?? [];
            const merged = insertExternalNodes(existingNodes, tabNodes, null, 'after');
            await db.saveSnapshot(merged, existingCols);
            broadcastStateUpdated();
        }
        void message.success(t('importSuccess', 'Imported to Link Map Tree'), 1.5);
    };

    const handleOpenSingleQr = async (item: ShareItem) => {
        const canvas = await renderSingleUrlCardCanvas({
            title: item.title,
            url: item.url,
            description: item.description,
            theme: 'dark',
            showDescription: true,
            showWatermark: true,
        });
        setQrCanvas(canvas);
        setQrModal({ item, previewUrl: canvas.toDataURL('image/png') });
    };

    return (
        <div
            className="lm-scroll"
            style={{
                height: '100%',
                backgroundColor: 'var(--lm-bg)',
                color: 'var(--lm-text)',
                padding: '24px 18px 48px',
            }}
        >
            <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>
                            Link Map · Shared Viewer
                        </h2>
                        <Tag color="green" style={{ margin: 0 }}>
                            <ShieldCheck size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />
                            Zero-Server Local Decode
                        </Tag>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                    <Input
                        value={pasteInput}
                        onChange={(e) => setPasteInput(e.target.value)}
                        onPressEnter={() => decodeHashInput(pasteInput)}
                        placeholder={t('pasteShareLink')}
                        style={{ flex: 1 }}
                    />
                    <Button type="primary" onClick={() => decodeHashInput(pasteInput)}>
                        Decode
                    </Button>
                </div>

                {errorMsg && <Alert type="error" showIcon message={errorMsg} />}

                {!bundle ? (
                    <Empty description={t('pasteShareLink')} style={{ marginTop: 40 }} />
                ) : (
                    <>
                        <div
                            style={{
                                padding: 16,
                                borderRadius: 10,
                                backgroundColor: 'var(--lm-bg-elevated)',
                                border: '1px solid var(--lm-border)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 10,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {bundle.color && (
                                        <span
                                            className="lm-group-dot"
                                            style={{ margin: 0, backgroundColor: TAB_GROUP_COLOR_HEX[bundle.color] }}
                                        />
                                    )}
                                    <h3 style={{ margin: 0, fontSize: 17 }}>{bundle.title}</h3>
                                    <Tag style={{ margin: 0 }}>{bundle.items.length} links</Tag>
                                </div>

                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <Button
                                        size="small"
                                        type="primary"
                                        icon={<ExternalLink size={12} />}
                                        disabled={selectedItems.length === 0}
                                        onClick={() =>
                                            void openTabsAsChromeGroup(
                                                selectedItems.map(shareItemToTabNode),
                                                { title: bundle.title, color: bundle.color ?? 'blue' },
                                            )
                                        }
                                    >
                                        {t('openAllTabs')} ({selectedItems.length})
                                    </Button>
                                    <Button
                                        size="small"
                                        icon={<FolderInput size={12} />}
                                        disabled={selectedItems.length === 0}
                                        onClick={() => void handleImportToLinkMap()}
                                    >
                                        {t('importAllAsCollection')}
                                    </Button>
                                    <Button
                                        size="small"
                                        disabled={selectedItems.length === 0}
                                        onClick={() => void handleImportToTree()}
                                    >
                                        {t('importSelected')}
                                    </Button>
                                    <Button
                                        size="small"
                                        icon={<Copy size={12} />}
                                        onClick={() => {
                                            const md = selectedItems
                                                .map((i) => `- [${i.title}](${i.url})${i.description ? ` — ${i.description}` : ''}`)
                                                .join('\n');
                                            void navigator.clipboard.writeText(md);
                                            void message.success('Markdown copied', 1);
                                        }}
                                    >
                                        Markdown
                                    </Button>
                                    <Button
                                        size="small"
                                        icon={<Download size={12} />}
                                        onClick={() => {
                                            const html = buildStandaloneShareHtml(bundle);
                                            void downloadTextOrJsonFile(
                                                html,
                                                `${bundle.title || 'share'}.html`,
                                                'text/html',
                                            );
                                        }}
                                    >
                                        HTML
                                    </Button>
                                </div>
                            </div>

                            {bundle.description && (
                                <div style={{ fontSize: 12, color: 'var(--lm-text-muted)' }}>
                                    {bundle.description}
                                </div>
                            )}

                            <Input
                                size="small"
                                allowClear
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                prefix={<Search size={12} style={{ color: 'var(--lm-text-muted)' }} />}
                                placeholder={t('search')}
                            />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {filteredItems.map((item) => {
                                const checked = selectedUrls.includes(item.url);
                                const host = extractHostname(item.url) || 'link';
                                return (
                                    <div
                                        key={item.url}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 10,
                                            padding: '10px 12px',
                                            borderRadius: 8,
                                            backgroundColor: 'var(--lm-bg-elevated)',
                                            border: '1px solid var(--lm-border)',
                                        }}
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onChange={() =>
                                                setSelectedUrls((prev) =>
                                                    prev.includes(item.url)
                                                        ? prev.filter((u) => u !== item.url)
                                                        : [...prev, item.url],
                                                )
                                            }
                                        />
                                        <span className="lm-favicon-wrap" style={{ margin: 0 }}>
                                            <img src={getFaviconUrl(item.url)} alt="" />
                                        </span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <a
                                                    href={item.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    style={{
                                                        color: 'var(--lm-text)',
                                                        fontWeight: 600,
                                                        fontSize: 13,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {item.title}
                                                </a>
                                                <Tag style={{ margin: 0, fontSize: 10 }}>{host}</Tag>
                                            </div>
                                            {item.description && (
                                                <div style={{ fontSize: 11, color: 'var(--lm-text-muted)', marginTop: 2 }}>
                                                    {item.description}
                                                </div>
                                            )}
                                            <div
                                                style={{
                                                    fontSize: 11,
                                                    color: 'var(--lm-text-closed)',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {item.url}
                                            </div>
                                        </div>
                                        <Button
                                            size="small"
                                            type="text"
                                            icon={<QrCode size={14} />}
                                            onClick={() => void handleOpenSingleQr(item)}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            <Modal
                title={qrModal?.item.title}
                open={Boolean(qrModal)}
                onCancel={() => setQrModal(null)}
                footer={null}
                width={520}
            >
                {qrModal && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <img
                            src={qrModal.previewUrl}
                            alt="QR Card"
                            style={{ width: '100%', borderRadius: 8 }}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                            <Button
                                size="small"
                                type="primary"
                                icon={<Copy size={12} />}
                                onClick={() => {
                                    if (qrCanvas) {
                                        void copyCanvasAsPng(qrCanvas).then(() =>
                                            message.success('Card PNG copied', 1.2),
                                        );
                                    }
                                }}
                            >
                                {t('copyImage')}
                            </Button>
                            <Button
                                size="small"
                                icon={<Download size={12} />}
                                onClick={() => {
                                    if (qrCanvas) {
                                        void downloadCanvasAsPng(qrCanvas, 'link-map-card.png');
                                    }
                                }}
                            >
                                {t('downloadPng')}
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export const ShareViewerApp: React.FC = () => {
    const [isDark, setIsDark] = useState(true);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }, [isDark]);

    return (
        <ConfigProvider
            theme={{
                algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
                token: {
                    colorPrimary: '#d2a400',
                    borderRadius: 6,
                    fontSize: 12,
                },
            }}
        >
            <AntdApp style={{ height: '100%' }}>
                <ShareViewerInner onThemeResolved={setIsDark} />
            </AntdApp>
        </ConfigProvider>
    );
};
