import React from 'react';

interface HeaderProps {
    userName: string;
    lastSync: string;
    syncing: boolean;
    onSync: () => void;
    onAbort: () => void;
    onLogout: () => void;
    onSettings: () => void;
}

const getInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }
    return name.charAt(0).toUpperCase();
};

const Header: React.FC<HeaderProps> = ({
    userName,
    lastSync,
    syncing,
    onSync,
    onAbort,
    onLogout,
    onSettings,
}) => {
    return (
        <div className="header">
            <div className="header-top">
                <div className="header-user">
                    <div className="user-avatar">
                        {getInitials(userName)}
                    </div>
                    <div className="user-info">
                        <span className="user-name">{userName}</span>
                        <span className="last-sync">
                            Ultima sincronizzazione: {lastSync}
                        </span>
                    </div>
                </div>
                <div className="header-actions">
                    <button className="btn-header-icon" onClick={onSettings} title="Impostazioni">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
                            <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 001.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z" />
                        </svg>
                    </button>
                    <button className="btn-header-icon btn-logout-icon" onClick={onLogout} title="Esci">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M10 12.5a.5.5 0 01-.5.5h-8a.5.5 0 01-.5-.5v-9a.5.5 0 01.5-.5h8a.5.5 0 01.5.5v2a.5.5 0 001 0v-2A1.5 1.5 0 009.5 2h-8A1.5 1.5 0 000 3.5v9A1.5 1.5 0 001.5 14h8a1.5 1.5 0 001.5-1.5v-2a.5.5 0 00-1 0v2z" />
                            <path d="M15.854 8.354a.5.5 0 000-.708l-3-3a.5.5 0 00-.708.708L14.293 7.5H5.5a.5.5 0 000 1h8.793l-2.147 2.146a.5.5 0 00.708.708l3-3z" />
                        </svg>
                    </button>
                </div>
            </div>

            <button
                className={`sync-btn ${syncing ? 'syncing' : ''}`}
                onClick={syncing ? onAbort : onSync}
            >
                {syncing ? (
                    <>
                        <span className="spinner-small" />
                        Interrompi
                    </>
                ) : (
                    <>
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            className="sync-icon"
                        >
                            <path d="M11.534 7h3.932a.25.25 0 01.192.41l-1.966 2.36a.25.25 0 01-.384 0l-1.966-2.36a.25.25 0 01.192-.41zm-11 2h3.932a.25.25 0 00.192-.41L2.692 6.23a.25.25 0 00-.384 0L.342 8.59A.25.25 0 00.534 9z" />
                            <path d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 11-.771-.636A5.501 5.501 0 0113.5 7.5a.5.5 0 01-1 0A4.5 4.5 0 008 3zM3.5 9.5a.5.5 0 01.5-.5 4.5 4.5 0 004.5 4.5c1.552 0 2.94-.707 3.857-1.818a.5.5 0 11.771.636A5.501 5.501 0 012.5 9.5a.5.5 0 01.5-.5z" />
                        </svg>
                        Sincronizza ora
                    </>
                )}
            </button>
        </div>
    );
};

export default Header;
