import React from 'react';
import Icon from './Icon';
import { SyncMorph } from './MorphIcon';
import { getT } from '../i18n';

interface HeaderProps {
    lang: 'it' | 'en';
    userName: string;
    matricola?: string;
    lastSync: string;
    lastSyncTitle?: string;
    syncing: boolean;
    syncDir: string;
    onSync: () => void;
    onAbort: () => void;
    onLogout: () => void;
    onSettings: () => void;
    onRecent: () => void;
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

export const formatStudentName = (name: string): string => {
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
    lastSyncTitle,
    syncing,
    syncDir,
    onSync,
    onAbort,
    onLogout,
    onSettings,
    onRecent,
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
                        <span className="last-sync" data-tip={lastSyncTitle}>
                            {t('lastSync')}: {lastSync}
                        </span>
                    </div>
                </div>
                <div className="header-actions">
                    <button className="btn-header-icon" onClick={onRecent} data-tip={t('recentDownloads')} aria-label={t('recentDownloads')}>
                        <Icon name="history" size={16} />
                    </button>
                    <button className="btn-header-icon btn-settings-icon" onClick={onSettings} data-tip={t('settings')} aria-label={t('settings')}>
                        <Icon name="settings" size={16} />
                    </button>
                    <button className="btn-header-icon btn-logout-icon" onClick={onLogout} data-tip={t('logout')} aria-label={t('logout')}>
                        <Icon name="signOut" size={16} />
                    </button>
                </div>
            </div>

            <button
                className={`sync-btn ${syncing ? 'syncing' : ''}`}
                onClick={syncing ? onAbort : onSync}
            >
                <SyncMorph active={syncing} />
                {syncing ? t('abortSyncButton') : t('syncNowButton')}
            </button>

            {syncDir && (
                <div className="sync-dir-box">
                    <button
                        className="sync-dir-input"
                        onClick={onOpenFolder}
                        data-tip={`${t('openFolder')}: ${syncDir}`}
                    >
                        <Icon name="folderOpen" size={14} />
                        <span className="sync-dir-path">{syncDir}</span>
                    </button>
                    <button className="sync-dir-change" onClick={onChangeFolder} data-tip={t('changeFolder')} aria-label={t('changeFolder')}>
                        <Icon name="pencil" size={13} />
                    </button>
                </div>
            )}
        </div>
    );
};

export default Header;
