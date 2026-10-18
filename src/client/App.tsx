import React, { useState, useEffect, useRef } from 'react';
import Icon from './components/Icon';
import LoginView from './components/LoginView';
import SyncView from './components/SyncView';
import { getT } from './i18n';
import { applyTheme } from './theme';
import type { UserInfo } from '../types';

export interface Accounts {
    bocconi: UserInfo | null;
    webeep: UserInfo | null;
}

const App: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [accounts, setAccounts] = useState<Accounts>({ bocconi: null, webeep: null });
    const [offline, setOffline] = useState(false);
    const restoring = useRef(false);
    const [lang, setLang] = useState<'it' | 'en'>(
        navigator.language.startsWith('it') ? 'it' : 'en'
    );

    const loggedIn = !!(accounts.bocconi || accounts.webeep);
    // Bocconi is the primary identity when both are connected: it holds the stored credentials.
    const user = accounts.bocconi ?? accounts.webeep;

    const t = getT(lang);

    useEffect(() => {
        window.api
            .getConfig()
            .then((cfg) => {
                applyTheme(cfg?.theme);
                if (cfg && cfg.language) {
                    setLang(cfg.language as 'it' | 'en');
                }
            })
            .catch((err) => {
                console.error('Failed to load config language:', err);
            });

        restore();
    }, []);

    // Offline at startup: retry on the online event, and on a timer in case it never fires.
    useEffect(() => {
        if (!offline) return;
        window.addEventListener('online', restore);
        const id = setInterval(restore, 5000);
        return () => {
            window.removeEventListener('online', restore);
            clearInterval(id);
        };
    }, [offline]);

    const restore = () => {
        if (restoring.current) return;
        restoring.current = true;
        window.api
            .autoLogin()
            .then((result) => {
                setAccounts({
                    bocconi: result.bocconi ?? null,
                    webeep: result.webeep ?? null,
                });
                setOffline(false);
                setLoading(false);
            })
            .catch((err) => {
                setOffline(err === 'offline');
                setLoading(false);
            })
            .finally(() => {
                restoring.current = false;
            });
    };

    const handleLogin = (provider: 'bocconi' | 'webeep', u: UserInfo) => {
        setAccounts((prev) => ({ ...prev, [provider]: u }));
    };

    const handleLogout = async (provider: 'bocconi' | 'webeep' | 'all' = 'all') => {
        try {
            await window.api.logout(provider);
        } catch (err) {
            console.error('Logout failed:', err);
        } finally {
            setAccounts((prev) =>
                provider === 'all'
                    ? { bocconi: null, webeep: null }
                    : { ...prev, [provider]: null }
            );
        }
    };

    return (
        <div className="app">
            <div className="titlebar">
                <div className="titlebar-drag" data-tauri-drag-region>
                    <span className="titlebar-title">BlackBoard Sync</span>
                </div>
                <div className="titlebar-controls">
                    <button
                        className="titlebar-btn"
                        onClick={() => window.api.minimize()}
                        aria-label="Minimize"
                    >
                        <Icon name="minimize" size={13} weight="regular" />
                    </button>
                    <button
                        className="titlebar-btn close"
                        onClick={() => window.api.close()}
                        aria-label="Close"
                    >
                        <Icon name="close" size={13} weight="regular" />
                    </button>
                </div>
            </div>

            <div className="app-content">
                {loading ? (
                    <div className="loading-screen">
                        <div className="spinner" />
                        <p>{t('connecting')}</p>
                    </div>
                ) : offline ? (
                    <div className="loading-screen">
                        <div className="spinner" />
                        <p>{t('offline')}</p>
                        <p>{t('offlineHint')}</p>
                    </div>
                ) : loggedIn && user ? (
                    <SyncView
                        lang={lang}
                        onLanguageChange={setLang}
                        user={user}
                        accounts={accounts}
                        onLogin={handleLogin}
                        onLogout={handleLogout}
                    />
                ) : (
                    <LoginView
                        lang={lang}
                        onLogin={handleLogin}
                    />
                )}
            </div>
        </div>
    );
};

export default App;
