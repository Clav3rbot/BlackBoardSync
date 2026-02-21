import React, { useState, useEffect } from 'react';
import LoginView from './components/LoginView';
import SyncView from './components/SyncView';

interface UserInfo {
    id: string;
    userName: string;
    name: { given: string; family: string };
}

const App: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [loggedIn, setLoggedIn] = useState(false);
    const [user, setUser] = useState<UserInfo | null>(null);

    useEffect(() => {
        window.api
            .autoLogin()
            .then((result) => {
                if (result.success && result.user) {
                    setUser(result.user);
                    setLoggedIn(true);
                }
                setLoading(false);
            })
            .catch(() => {
                setLoading(false);
            });
    }, []);

    const handleLogin = (u: UserInfo) => {
        setUser(u);
        setLoggedIn(true);
    };

    const handleLogout = async () => {
        await window.api.logout();
        setUser(null);
        setLoggedIn(false);
    };

    return (
        <div className="app">
            <div className="titlebar">
                <div className="titlebar-drag">
                    <span className="titlebar-title">BlackBoard Sync</span>
                </div>
                <div className="titlebar-controls">
                    <button
                        className="titlebar-btn"
                        onClick={() => window.api.minimize()}
                        aria-label="Minimize"
                    >
                        <svg width="10" height="1" viewBox="0 0 10 1">
                            <rect width="10" height="1" fill="currentColor" />
                        </svg>
                    </button>
                    <button
                        className="titlebar-btn close"
                        onClick={() => window.api.close()}
                        aria-label="Close"
                    >
                        <svg width="10" height="10" viewBox="0 0 10 10">
                            <path
                                d="M1 1L9 9M9 1L1 9"
                                stroke="currentColor"
                                strokeWidth="1.2"
                            />
                        </svg>
                    </button>
                </div>
            </div>

            <div className="app-content">
                {loading ? (
                    <div className="loading-screen">
                        <div className="spinner" />
                        <p>Connessione in corso...</p>
                    </div>
                ) : loggedIn && user ? (
                    <SyncView user={user} onLogout={handleLogout} />
                ) : (
                    <LoginView onLogin={handleLogin} />
                )}
            </div>
        </div>
    );
};

export default App;
