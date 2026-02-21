import React from 'react';

interface HeaderProps {
    userName: string;
    lastSync: string;
    syncing: boolean;
    onSync: () => void;
    onAbort: () => void;
    onLogout: () => void;
}

const Header: React.FC<HeaderProps> = ({
    userName,
    lastSync,
    syncing,
    onSync,
    onAbort,
    onLogout,
}) => {
    return (
        <div className="header">
            <div className="header-top">
                <div className="header-user">
                    <div className="user-avatar">
                        {userName.charAt(0).toUpperCase()}
                    </div>
                    <div className="user-info">
                        <span className="user-name">{userName}</span>
                        <span className="last-sync">
                            Ultima sincronizzazione: {lastSync}
                        </span>
                    </div>
                </div>
                <button className="btn-logout" onClick={onLogout} title="Esci">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M10 12.5a.5.5 0 01-.5.5h-8a.5.5 0 01-.5-.5v-9a.5.5 0 01.5-.5h8a.5.5 0 01.5.5v2a.5.5 0 001 0v-2A1.5 1.5 0 009.5 2h-8A1.5 1.5 0 000 3.5v9A1.5 1.5 0 001.5 14h8a1.5 1.5 0 001.5-1.5v-2a.5.5 0 00-1 0v2z" />
                        <path d="M15.854 8.354a.5.5 0 000-.708l-3-3a.5.5 0 00-.708.708L14.293 7.5H5.5a.5.5 0 000 1h8.793l-2.147 2.146a.5.5 0 00.708.708l3-3z" />
                    </svg>
                </button>
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
