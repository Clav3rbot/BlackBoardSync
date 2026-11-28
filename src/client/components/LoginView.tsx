import React, { useState } from 'react';
import appIcon from '../../../static/icons/png/128x128.png';
import { EyeMorph } from './MorphIcon';
import { connect } from '../connect';
import { getT, type Lang } from '../i18n';
import type { Provider, UserInfo } from '../../types';

// The form is Bocconi; PoliMi-only students get a link, everyone else connects it from Settings.
interface LoginViewProps {
    lang: Lang;
    onLogin: (provider: Provider, user: UserInfo) => void;
}

const LoginView: React.FC<LoginViewProps> = ({ lang, onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [webeepBusy, setWebeepBusy] = useState(false);

    const t = getT(lang);

    const handleWebeep = async () => {
        setWebeepBusy(true);
        setError('');
        setError(await connect('webeep', () => window.api.webeepLogin(), onLogin, t('loginError')));
        setWebeepBusy(false);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username || !password) {
            setError(t('emptyFieldsError'));
            return;
        }

        setLoading(true);
        setError('');
        setError(await connect('bocconi', () => window.api.login(username, password), onLogin, t('loginError')));
        setLoading(false);
    };

    return (
        <div className="login-view">
            <div className="login-header">
                <div className="login-logo">
                    <img src={appIcon} alt={t('appName')} width="64" height="64" />
                </div>
                <h1>{t('appName')}</h1>
                <p className="login-subtitle">{t('loginSubtitle')}</p>
            </div>

            <div className="login-provider">
                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="username">{t('usernameLabel')}</label>
                        <input
                            id="username"
                            name="username"
                            type="text"
                            autoComplete="username"
                            // An identifier, not prose: no spellcheck or macOS autocorrect rewriting it
                            spellCheck={false}
                            autoCorrect="off"
                            autoCapitalize="none"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder={t('usernamePlaceholder')}
                            disabled={loading}
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="password">{t('passwordLabel')}</label>
                        <div className="password-field">
                            <input
                                id="password"
                                name="password"
                                type={showPassword ? 'text' : 'password'}
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={t('passwordPlaceholder')}
                                disabled={loading}
                            />
                            <button
                                type="button"
                                className="password-toggle"
                                onClick={() => setShowPassword((v) => !v)}
                                aria-label={t(showPassword ? 'hidePassword' : 'showPassword')}
                                data-tip={t(showPassword ? 'hidePassword' : 'showPassword')}
                            >
                                <EyeMorph closed={!showPassword} />
                            </button>
                        </div>
                    </div>

                    {error && <div className="error-message" role="alert">{error}</div>}

                    <button type="submit" className="login-btn" disabled={loading || webeepBusy}>
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
                <button
                    type="button"
                    className="login-alt"
                    onClick={handleWebeep}
                    disabled={loading || webeepBusy}
                >
                    {webeepBusy ? t('webeepConnecting') : t('loginWithPolimi')}
                </button>
            </div>

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
