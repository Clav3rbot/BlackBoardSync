import './api-stub';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../client/App';
import '../styles/main.scss';

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(<App />);
}
