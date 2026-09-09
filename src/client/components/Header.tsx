import React from 'react';
import Icon from './Icon';
import { getT } from '../i18n';

interface HeaderProps {
    lang: 'it' | 'en';
    userName: string;
    matricola?: string;
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

const formatStudentName = (name: string): string => {
    return name
        .toLowerCase()
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

const Header: React.FC<HeaderProps> = ({
    lang,
    userName,
    matricola,
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
    const t = getT(lang);

    return (
        <div className="header">
            <div className="header-top">
                <div className="header-user">
                    <div className="user-avatar">
                        {getInitials(userName)}
                    </div>
                    <div className="user-info">
                        <span className="user-name">
                            {formatStudentName(userName)}
                            {matricola && <span className="user-matricola-text"> {matricola}</span>}
                        </span>
                        <span className="last-sync">
                            {t('lastSync')}: {lastSync}
                        </span>
                    </div>
                </div>
                <div className="header-actions">
                    <button className="btn-header-icon" onClick={onSettings} title={t('settings')}>
                        <Icon name="settings" size={16} />
                    </button>
                    <button className="btn-header-icon btn-logout-icon" onClick={onLogout} title={t('logout')}>
                        <Icon name="signOut" size={16} />
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
                        {t('abortSyncButton')}
                    </>
                ) : (
                    <>
                        <Icon name="sync" size={16} className="sync-icon" />
                        {t('syncNowButton')}
                    </>
                )}
            </button>

            {syncDir && (
                <div className="sync-dir-box">
                    <div className="sync-dir-input" onClick={onOpenFolder} title={syncDir}>
                        <Icon name="folder" size={14} />
                        <span className="sync-dir-path">{syncDir}</span>
                    </div>
                    <button className="sync-dir-change" onClick={onChangeFolder} title={t('changeFolder')}>
                        <Icon name="pencil" size={13} />
                    </button>
                </div>
            )}
        </div>
    );
};

export default Header;
