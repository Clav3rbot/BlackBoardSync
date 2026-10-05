import './tauri-api';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './client/App';
import { applyTheme, cachedTheme } from './client/theme';
import './styles/main.scss';

applyTheme(cachedTheme());

if (navigator.userAgent.includes('Mac')) {
    document.documentElement.classList.add('platform-macos');
} else {
    document.documentElement.classList.add('platform-windows');
}

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
