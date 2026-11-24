import React, { useEffect, useState } from 'react';
import { Popover, Tag } from 'antd';
import { Keyboard } from 'lucide-react';

import { getShortcutDocs } from '../hooks/useShortcuts';
import { getOpenLinkMapShortcut, getShortcutSettingsUrl } from '../services/browser-bridge';
import { t } from '../services/i18n';

export const ShortcutsDrawer: React.FC = () => {
    const [globalShortcut, setGlobalShortcut] = useState('');

    const refreshShortcut = async () => {
        const s = await getOpenLinkMapShortcut();
        setGlobalShortcut(s);
    };

    useEffect(() => {
        void refreshShortcut();
    }, []);

    const docs = getShortcutDocs(globalShortcut);
    const sections: Array<{ key: 'basic' | 'navigation' | 'notes'; title: string }> = [
        { key: 'basic', title: t('basicOperation', 'Basic Operations') },
        { key: 'navigation', title: t('navigation', 'Navigation') },
        { key: 'notes', title: t('ctxMenuNotes', 'Notes') },
    ];

    const content = (
        <div style={{ width: 290, maxHeight: 380, overflowY: 'auto', fontSize: 11 }}>
            {sections.map((sec) => (
                <div key={sec.key} style={{ marginBottom: 10 }}>
                    <div
                        style={{
                            fontWeight: 600,
                            color: 'var(--lm-text-muted)',
                            marginBottom: 4,
                        }}
                    >
                        {sec.title}
                    </div>
                    {docs
                        .filter((d) => d.section === sec.key)
                        .map((item) => (
                            <div
                                key={item.label}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '2px 0',
                                }}
                            >
                                <span>{item.label}</span>
                                <Tag style={{ margin: 0, fontSize: 10 }}>{item.keys}</Tag>
                            </div>
                        ))}
                </div>
            ))}
            <div style={{ textAlign: 'right', marginTop: 4 }}>
                <a
                    href={getShortcutSettingsUrl()}
                    onClick={(e) => {
                        e.preventDefault();
                        void chrome.tabs.create({ url: getShortcutSettingsUrl() });
                    }}
                >
                    Configure Browser Shortcut →
                </a>
            </div>
        </div>
    );

    return (
        <Popover
            title={t('shortcut', 'Shortcuts')}
            content={content}
            trigger="click"
            placement="topLeft"
            onOpenChange={(open) => {
                if (open) void refreshShortcut();
            }}
        >
            <button
                type="button"
                className="lm-float-help"
                title={t('shortcut', 'Shortcuts')}
            >
                <Keyboard size={15} />
            </button>
        </Popover>
    );
};
