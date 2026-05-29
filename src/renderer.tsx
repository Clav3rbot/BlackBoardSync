import './tauri-api';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './client/App';
import './styles/main.scss';

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
