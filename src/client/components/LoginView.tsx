import React, { useState } from 'react';

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
                    <svg
                        width="48"
                        height="48"
                        viewBox="0 0 48 48"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <rect
                            x="4"
                            y="8"
                            width="40"
                            height="32"
                            rx="3"
                            stroke="currentColor"
                            strokeWidth="2.5"
                        />
                        <path
                            d="M4 16H44"
                            stroke="currentColor"
                            strokeWidth="2.5"
                        />
                        <path
                            d="M16 16V40"
                            stroke="currentColor"
                            strokeWidth="2.5"
                        />
                        <circle cx="10" cy="12" r="1.5" fill="currentColor" />
                        <circle cx="15" cy="12" r="1.5" fill="currentColor" />
                        <circle cx="20" cy="12" r="1.5" fill="currentColor" />
                        <rect
                            x="22"
                            y="22"
                            width="16"
                            height="2"
                            rx="1"
                            fill="currentColor"
                        />
                        <rect
                            x="22"
                            y="28"
                            width="12"
                            height="2"
                            rx="1"
                            fill="currentColor"
                        />
                        <rect
                            x="22"
                            y="34"
                            width="14"
                            height="2"
                            rx="1"
                            fill="currentColor"
                        />
                        <rect
                            x="8"
                            y="22"
                            width="5"
                            height="2"
                            rx="1"
                            fill="currentColor"
                        />
                        <rect
                            x="8"
                            y="28"
                            width="5"
                            height="2"
                            rx="1"
                            fill="currentColor"
                        />
                    </svg>
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

            <p className="login-footer">
                Le credenziali vengono salvate in modo sicuro sul tuo dispositivo.
            </p>
        </div>
    );
};

export default LoginView;
