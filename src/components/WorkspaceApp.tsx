import React, { useEffect, useMemo, useRef, useState } from 'react';
import { App as AntdApp, ConfigProvider, Spin, theme as antdTheme } from 'antd';

import type { OpenMode } from '../core/types';
import { useWorkspaceShortcuts } from '../hooks/useShortcuts';
import { selectVisibleTreeRows, useWorkspaceStore } from '../store/workspace-store';
import { AiAssistantModal } from './AiAssistantModal';
import { GroupsView } from './GroupsView';
import { HeaderBar } from './HeaderBar';
import { MultiSelectBar } from './MultiSelectBar';
import { OperationBar } from './OperationBar';
import { SettingsModal } from './SettingsModal';
import { ShareModal } from './ShareModal';
import { ShortcutsDrawer } from './ShortcutsDrawer';
import { VirtualTree, type VirtualTreeHandle } from './VirtualTree';

import '../styles/workspace.css';

function useResolvedDarkTheme(themeSetting: 'dark' | 'light' | 'auto'): boolean {
    const [systemDark, setSystemDark] = useState<boolean>(() =>
        typeof window !== 'undefined'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
            : true,
    );

    useEffect(() => {
        if (themeSetting !== 'auto') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
        setSystemDark(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, [themeSetting]);

    return themeSetting === 'auto' ? systemDark : themeSetting === 'dark';
}

const WorkspaceInner: React.FC<{ hostMode: OpenMode }> = ({ hostMode }) => {
    const init = useWorkspaceStore((s) => s.init);
    const initialized = useWorkspaceStore((s) => s.initialized);
    const nodes = useWorkspaceStore((s) => s.nodes);
    const searchQuery = useWorkspaceStore((s) => s.searchQuery);
    const activeView = useWorkspaceStore((s) => s.activeView);

    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const treeRef = useRef<VirtualTreeHandle | null>(null);

    useEffect(() => {
        let cleanup: (() => void) | undefined;
        void init().then((fn) => {
            cleanup = fn;
        });
        return () => {
            cleanup?.();
        };
    }, [init]);

    const visibleRows = useMemo(
        () => selectVisibleTreeRows(nodes, searchQuery),
        [nodes, searchQuery],
    );

    useWorkspaceShortcuts(searchInputRef, visibleRows);

    return (
        <div className="lm-shell">
            <HeaderBar hostMode={hostMode} searchInputRef={searchInputRef} />
            <OperationBar onScrollToNode={(id) => treeRef.current?.scrollToNode(id)} />

            {!initialized ? (
                <div
                    style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Spin />
                </div>
            ) : activeView === 'tree' ? (
                <VirtualTree ref={treeRef} rows={visibleRows} />
            ) : (
                <GroupsView />
            )}

            <MultiSelectBar />
            <ShortcutsDrawer />
            <SettingsModal />
            <ShareModal />
            <AiAssistantModal />
        </div>
    );
};

export const WorkspaceApp: React.FC<{ hostMode: OpenMode }> = ({ hostMode }) => {
    const themeSetting = useWorkspaceStore((s) => s.settings.theme);
    const isDark = useResolvedDarkTheme(themeSetting);

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
                <WorkspaceInner hostMode={hostMode} />
            </AntdApp>
        </ConfigProvider>
    );
};
