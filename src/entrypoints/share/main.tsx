import React from 'react';
import { createRoot } from 'react-dom/client';

import { ShareViewerApp } from '../../components/ShareViewerApp';

createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ShareViewerApp />
    </React.StrictMode>,
);
