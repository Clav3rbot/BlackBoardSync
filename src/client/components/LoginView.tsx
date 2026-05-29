import React, { useState } from 'react';
import { getT } from '../i18n';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const appIcon = require('../../../static/icons/png/128x128.png') as string;

interface LoginViewProps {
    lang: 'it' | 'en';
    onLogin: (user: any) => void;
}

const LoginView: React.FC<LoginViewProps> = ({ lang, onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const t = getT(lang);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username || !password) {
            setError(t('emptyFieldsError'));
            return;
        }

        setLoading(true);
        setError('');

        try {
            const result = await window.api.login(username, password);
            if (result.success) {
                onLogin(result.user);
            } else {
                setError(result.error || t('loginError'));
            }
        } catch {
            setError(t('loginError'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-view">
            <div className="login-header">
                <div className="login-logo">
                    <img src={appIcon} alt="BlackBoard Sync" width="64" height="64" />
                </div>
                <h1>BlackBoard Sync</h1>
                <p className="login-subtitle">{t('loginSubtitle')}</p>
            </div>

            <form className="login-form" onSubmit={handleSubmit}>
                <div className="form-group">
                    <label htmlFor="username">{t('usernameLabel')}</label>
                    <input
                        id="username"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder={t('usernamePlaceholder')}
                        disabled={loading}
                        autoFocus
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="password">{t('passwordLabel')}</label>
                    <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t('passwordPlaceholder')}
                        disabled={loading}
                    />
                </div>

                {error && <div className="error-message">{error}</div>}

                <button type="submit" className="login-btn" disabled={loading}>
                    {loading ? (
                        <>
                            <span className="spinner-small" />
                            {t('loggingIn')}
                        </>
                    ) : (
                        t('loginButton')
                    )}
                </button>
            </form>

            <div className="login-footer">
                <p>{t('loginFooterCredentials')}</p>
                <p className="login-disclaimer">
                    {t('loginFooterDisclaimer1')}<br/>
                    {t('loginFooterDisclaimer2')}<br/>
                    {t('loginFooterDisclaimer3')}
                </p>
            </div>
        </div>
    );
};

export default LoginView;
