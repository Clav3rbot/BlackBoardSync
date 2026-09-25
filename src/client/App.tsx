import React, { useState, useEffect, useRef } from 'react';
import Icon from './components/Icon';
import LoginView from './components/LoginView';
import SyncView from './components/SyncView';
import { getT } from './i18n';

interface UserInfo {
    id: string;
    userName: string;
    name: { given: string; family: string };
}

const App: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [loggedIn, setLoggedIn] = useState(false);
    const [user, setUser] = useState<UserInfo | null>(null);
    const [offline, setOffline] = useState(false);
    const restoring = useRef(false);
    const [lang, setLang] = useState<'it' | 'en'>(
        navigator.language.startsWith('it') ? 'it' : 'en'
    );

    const t = getT(lang);

    useEffect(() => {
        window.api
            .getConfig()
            .then((cfg) => {
                if (cfg && cfg.language) {
                    setLang(cfg.language as 'it' | 'en');
                }
            })
            .catch((err) => {
                console.error('Failed to load config language:', err);
            });

        restore();
    }, []);

    // Offline at startup: retry as soon as Windows reports a connection, and
    // every few seconds in case that event never fires.
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
                if (result.success && result.user) {
                    setUser(result.user);
                    setLoggedIn(true);
                }
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

    const handleLogin = (u: UserInfo) => {
        setUser(u);
        setLoggedIn(true);
    };

    const handleLogout = async () => {
        try {
            await window.api.logout();
        } catch (err) {
            console.error('Logout failed:', err);
        } finally {
            setUser(null);
            setLoggedIn(false);
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
                    <SyncView lang={lang} onLanguageChange={setLang} user={user} onLogout={handleLogout} />
                ) : (
                    <LoginView lang={lang} onLogin={handleLogin} />
                )}
            </div>
        </div>
    );
};

export default App;
