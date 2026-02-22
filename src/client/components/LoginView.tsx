import React, { useState } from 'react';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const appIcon = require('../../../static/icons/png/128x128.png') as string;

interface LoginViewProps {
    onLogin: (user: any) => void;
}

const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username || !password) {
            setError('Inserisci email e password');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const result = await window.api.login(username, password);
            if (result.success) {
                onLogin(result.user);
            } else {
                setError(result.error || 'Errore di autenticazione');
            }
        } catch {
            setError('Errore di connessione');
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
                <p className="login-subtitle">Università Bocconi</p>
            </div>

            <form className="login-form" onSubmit={handleSubmit}>
                <div className="form-group">
                    <label htmlFor="username">Email / Matricola</label>
                    <input
                        id="username"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="nome.cognome@studbocconi.it"
                        disabled={loading}
                        autoFocus
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="password">Password</label>
                    <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        disabled={loading}
                    />
                </div>

                {error && <div className="error-message">{error}</div>}

                <button type="submit" className="login-btn" disabled={loading}>
                    {loading ? (
                        <>
                            <span className="spinner-small" />
                            Accesso in corso...
                        </>
                    ) : (
                        'Accedi'
                    )}
                </button>
            </form>

            <div className="login-footer">
                <p>Le credenziali vengono salvate in modo sicuro sul tuo dispositivo.</p>
                <p className="login-disclaimer">
                    Questa app non è affiliata, associata o approvata dall'Università Bocconi.<br/>
                    È uno strumento indipendente per velocizzare il download dei documenti.<br/>
                    Il creatore non è in alcun modo responsabile dell'uso delle credenziali inserite.
                </p>
            </div>
        </div>
    );
};

export default LoginView;
