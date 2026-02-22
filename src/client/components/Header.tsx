import React from 'react';

interface HeaderProps {
    userName: string;
    lastSync: string;
    syncing: boolean;
    syncDir: string;
    onSync: () => void;
    onAbort: () => void;
    onLogout: () => void;
    onSettings: () => void;
    onOpenFolder: () => void;
    onChangeFolder: () => void;
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
    syncDir,
    onSync,
    onAbort,
    onLogout,
    onSettings,
    onOpenFolder,
    onChangeFolder,
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
                            <path d="M4.406 1.342A5.53 5.53 0 018 0c2.69 0 4.923 2 5.166 4.579C14.758 4.804 16 6.137 16 7.773 16 9.569 14.502 11 12.687 11H10a.5.5 0 010-1h2.688C13.979 10 15 8.988 15 7.773c0-1.216-1.02-2.228-2.313-2.228h-.5v-.5C12.188 2.825 10.328 1 8 1a4.53 4.53 0 00-2.941 1.1c-.757.652-1.153 1.438-1.153 2.055v.448l-.445.049C2.064 4.805 1 5.952 1 7.318 1 8.785 2.23 10 3.781 10H6a.5.5 0 010 1H3.781C1.708 11 0 9.366 0 7.318c0-1.763 1.266-3.223 2.942-3.593.143-.863.698-1.723 1.464-2.383z" />
                            <path d="M7.646 15.854a.5.5 0 00.708 0l3-3a.5.5 0 00-.708-.708L8.5 14.293V5.5a.5.5 0 00-1 0v8.793l-2.146-2.147a.5.5 0 00-.708.708l3 3z" />
                        </svg>
                        Sincronizza ora
                    </>
                )}
            </button>

            {syncDir && (
                <div className="sync-dir-box">
                    <div className="sync-dir-input" onClick={onOpenFolder} title={syncDir}>
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M.54 3.87L.5 3a2 2 0 012-2h3.672a2 2 0 011.414.586l.828.828A2 2 0 009.828 3H13.5a2 2 0 012 2v.5H8.312a2 2 0 00-1.414.586l-.828.828A2 2 0 014.672 7.5H.5v-.382a1 1 0 01.54-.868zM1 8.5v5a2 2 0 002 2h10a2 2 0 002-2v-5H1z" />
                        </svg>
                        <span className="sync-dir-path">{syncDir}</span>
                    </div>
                    <button className="sync-dir-change" onClick={onChangeFolder} title="Cambia cartella">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M12.146.146a.5.5 0 01.708 0l3 3a.5.5 0 010 .708l-10 10a.5.5 0 01-.168.11l-5 2a.5.5 0 01-.65-.65l2-5a.5.5 0 01.11-.168l10-10zM11.207 2.5L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.293l6.5-6.5z" />
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
};

export default Header;
