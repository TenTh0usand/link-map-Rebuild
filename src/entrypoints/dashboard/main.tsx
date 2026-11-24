import React from 'react';
import { createRoot } from 'react-dom/client';

import { DashboardApp } from '../../components/DashboardApp';

createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <DashboardApp />
    </React.StrictMode>,
);
