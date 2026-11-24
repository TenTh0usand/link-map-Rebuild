import React from 'react';
import { createRoot } from 'react-dom/client';

import { ImportApp } from '../../components/ImportApp';

createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ImportApp />
    </React.StrictMode>,
);
