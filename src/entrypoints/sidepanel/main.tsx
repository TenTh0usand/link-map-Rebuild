import React from 'react';
import { createRoot } from 'react-dom/client';

import { WorkspaceApp } from '../../components/WorkspaceApp';

createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <WorkspaceApp hostMode="sidepanel" />
    </React.StrictMode>,
);
