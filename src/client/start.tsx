import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme, cachedTheme } from './theme';
import { isMac } from './platform';
import '../styles/main.scss';

// Imported after the module that sets window.api: tauri-api in the app, api-stub in dev.
applyTheme(cachedTheme());

document.documentElement.classList.add(isMac ? 'platform-macos' : 'platform-windows');

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(<App />);
}
