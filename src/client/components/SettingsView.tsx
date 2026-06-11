import React, { useState, useEffect } from 'react';
import { getT } from '../i18n';

interface AppConfig {
    syncDir: string;
    autoSync: boolean;
    autoSyncInterval: number;
    autoSyncScheduledTime: string;
    syncAllCourses: boolean;
    enabledCourses: string[];
    courseAliases: Record<string, string>;
    collapsedTerms: string[];
    hiddenCourses: string[];
    hiddenTerms: string[];
    lastSync: string | null;
    minimizeToTray: boolean;
    startAtLogin: boolean;
    notifications: boolean;
    syncOnStartup: boolean;
    language: string;
}

interface SettingsViewProps {
    config: AppConfig;
    onConfigChange: (config: AppConfig) => void;
    onClose: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ config, onConfigChange, onClose }) => {
    const t = getT(config.language);
    const [appVersion, setAppVersion] = useState('');
    const [checkingUpdate, setCheckingUpdate] = useState(false);
    const [updateMessage, setUpdateMessage] = useState('');
    const [updateStatus, setUpdateStatus] = useState<string>('');
    const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
    const [localTime, setLocalTime] = useState(config.autoSyncScheduledTime);

    useEffect(() => {
        window.api.getAppVersion().then(setAppVersion).catch(() => {});
        const unsub = window.api.onUpdateStatus(({ status, message }) => {
            setUpdateStatus(status);
            setUpdateMessage(message);
            if (status !== 'checking') {
                setCheckingUpdate(false);
            }
            if (status === 'available') {
                setDownloadProgress(0);
            } else if (status === 'downloaded' || status === 'error' || status === 'not-available') {
                setDownloadProgress(null);
            }
        });
        const unsubProgress = window.api.onUpdateDownloadProgress(({ percent }) => {
            setDownloadProgress(percent);
        });
        return () => {
            unsub();
            unsubProgress();
        };
    }, []);

    useEffect(() => {
        setLocalTime(config.autoSyncScheduledTime);
    }, [config.autoSyncScheduledTime]);

    const updateSetting = async (partial: Partial<AppConfig>) => {
        const newConfig = await window.api.updateConfig(partial);
        onConfigChange(newConfig);
    };

    const handleSelectFolder = async () => {
        const folder = await window.api.selectFolder();
        if (folder) {
            const newConfig = await window.api.updateConfig({ syncDir: folder });
            onConfigChange(newConfig);
        }
    };

    const handleOpenFolder = () => {
        if (config.syncDir) {
            window.api.openFolder(config.syncDir);
        }
    };

    const handleResetWindowSize = () => {
        window.api.resetWindowSize();
    };

    const handleCheckForUpdates = async () => {
        setCheckingUpdate(true);
        setUpdateMessage('');
        setUpdateStatus('');
        try {
            await window.api.checkForUpdates();
        } catch { /* ignore */ }
    };

    const getUpdateMessage = () => {
        if (updateStatus === 'checking') return t('checkingUpdates');
        if (updateStatus === 'available') return t('updateAvailable');
        if (updateStatus === 'not-available') return t('updateNotAvailable');
        return updateMessage;
    };

    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
                <div className="settings-header">
                    <h2 className="settings-title">{t('settingsTitle')}</h2>
                    <button className="settings-close-btn" onClick={onClose}>
                        <svg width="14" height="14" viewBox="0 0 10 10">
                            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>

                <div className="settings-body">
                    {/* Sync folder */}
                    <div className="settings-group">
                        <span className="settings-group-label">{t('syncFolderGroup')}</span>
                        <div className="folder-row">
                            <span className="folder-path" title={config.syncDir}>
                                {config.syncDir}
                            </span>
                            <div className="folder-actions">
                                <button className="btn-icon" onClick={handleOpenFolder} title={t('openFolder')}>
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M1.5 2A1.5 1.5 0 000 3.5v9A1.5 1.5 0 001.5 14h13a1.5 1.5 0 001.5-1.5V5a1.5 1.5 0 00-1.5-1.5H7.707l-1.854-1.854A.5.5 0 005.5 1.5H1.5z" />
                                    </svg>
                                </button>
                                <button className="btn-icon" onClick={handleSelectFolder} title={t('changeFolder')}>
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M12.146.146a.5.5 0 01.708 0l3 3a.5.5 0 010 .708l-10 10a.5.5 0 01-.168.11l-5 2a.5.5 0 01-.65-.65l2-5a.5.5 0 01.11-.168l10-10zM11.207 2.5L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.293l6.5-6.5z" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Auto sync */}
                    <div className="settings-group">
                        <div className="toggle-row" onClick={() => updateSetting({ autoSync: !config.autoSync })}>
                            <span className="toggle-label">{t('autoSyncGroup')}</span>
                            <div className={`toggle ${config.autoSync ? 'active' : ''}`}>
                                <div className="toggle-thumb" />
                            </div>
                        </div>

                        {config.autoSync && (
                            <div className="auto-sync-options">
                                <span className="auto-sync-info">{t('autoSyncInfoFrequency')}</span>
                                <div className="interval-picker">
                                    {[30, 60, 120].map((mins) => (
                                        <button
                                            key={mins}
                                            className={`interval-btn ${config.autoSyncInterval === mins ? 'active' : ''}`}
                                            onClick={() => updateSetting({ autoSyncInterval: mins })}
                                        >
                                            {mins < 60 ? `${mins}m` : `${mins / 60}h`}
                                        </button>
                                    ))}
                                    <button
                                        className={`interval-btn ${config.autoSyncInterval === 0 ? 'active' : ''}`}
                                        onClick={() => updateSetting({ autoSyncInterval: 0 })}
                                    >
                                        {t('autoSyncDaily')}
                                    </button>
                                </div>

                                {config.autoSyncInterval === 0 && (
                                    <div className="schedule-time-row">
                                        <span className="auto-sync-info">{t('autoSyncDailyAt')}</span>
                                        <input
                                            type="time"
                                            className="time-input"
                                            value={localTime}
                                            onChange={(e) => setLocalTime(e.target.value)}
                                            onBlur={() => {
                                                if (localTime && localTime !== config.autoSyncScheduledTime) {
                                                    updateSetting({ autoSyncScheduledTime: localTime });
                                                }
                                            }}
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* General settings */}
                    <div className="settings-group">
                        <span className="settings-group-label">{t('generalGroup')}</span>

                        <div className="toggle-row" onClick={() => updateSetting({ minimizeToTray: !config.minimizeToTray })}>
                            <div className="setting-info">
                                <span className="toggle-label">{t('minimizeToTrayLabel')}</span>
                                <span className="setting-desc">{t('minimizeToTrayDesc')}</span>
                            </div>
                            <div className={`toggle ${config.minimizeToTray ? 'active' : ''}`}>
                                <div className="toggle-thumb" />
                            </div>
                        </div>

                        <div className="setting-divider" />

                        <div className="toggle-row" onClick={() => updateSetting({ startAtLogin: !config.startAtLogin })}>
                            <div className="setting-info">
                                <span className="toggle-label">
                                    {navigator.userAgent.includes('Mac') ? t('startAtLoginLabelMac') : t('startAtLoginLabelWin')}
                                </span>
                                <span className="setting-desc">{t('startAtLoginDesc')}</span>
                            </div>
                            <div className={`toggle ${config.startAtLogin ? 'active' : ''}`}>
                                <div className="toggle-thumb" />
                            </div>
                        </div>

                        <div className="setting-divider" />

                        <div className="toggle-row" onClick={() => updateSetting({ syncOnStartup: !config.syncOnStartup })}>
                            <div className="setting-info">
                                <span className="toggle-label">{t('syncOnStartupLabel')}</span>
                                <span className="setting-desc">{t('syncOnStartupDesc')}</span>
                            </div>
                            <div className={`toggle ${config.syncOnStartup ? 'active' : ''}`}>
                                <div className="toggle-thumb" />
                            </div>
                        </div>

                        <div className="setting-divider" />

                        <div className="toggle-row" onClick={() => updateSetting({ notifications: !config.notifications })}>
                            <div className="setting-info">
                                <span className="toggle-label">{t('notificationsLabel')}</span>
                                <span className="setting-desc">{t('notificationsDesc')}</span>
                            </div>
                            <div className={`toggle ${config.notifications ? 'active' : ''}`}>
                                <div className="toggle-thumb" />
                            </div>
                        </div>

                        <div className="setting-divider" />

                        <div className="settings-action-row">
                            <div className="setting-info">
                                <span className="toggle-label">{t('languageLabel')}</span>
                                <span className="setting-desc">{t('languageDesc')}</span>
                            </div>
                            <div className="language-selector">
                                <div className={`selector-highlight ${config.language}`} />
                                <button
                                    className={`lang-btn ${config.language === 'it' ? 'active' : ''}`}
                                    onClick={() => updateSetting({ language: 'it' })}
                                >
                                    IT
                                </button>
                                <button
                                    className={`lang-btn ${config.language === 'en' ? 'active' : ''}`}
                                    onClick={() => updateSetting({ language: 'en' })}
                                >
                                    EN
                                </button>
                            </div>
                        </div>

                        <div className="setting-divider" />

                        <div className="settings-action-row">
                            <div className="setting-info">
                                <span className="toggle-label">{t('windowSizeLabel')}</span>
                                <span className="setting-desc">{t('windowSizeDesc')}</span>
                            </div>
                            <button className="btn-settings-action" onClick={handleResetWindowSize}>
                                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 1 0V2.5h3.5a.5.5 0 0 0 0-1h-4zm9 0a.5.5 0 0 0 0 1H14.5v3.5a.5.5 0 0 0 1 0v-4a.5.5 0 0 0-.5-.5h-4zM.5 10a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 0-1H1.5v-3.5A.5.5 0 0 0 .5 10zm13 0a.5.5 0 0 0-.5.5V14h-3.5a.5.5 0 0 0 0 1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5z"/>
                                </svg>
                                {t('reset')}
                            </button>
                        </div>
                    </div>

                    {/* Updates */}
                    <div className="settings-group">
                        <span className="settings-group-label">{t('updatesGroup')}</span>
                        <div className="update-row">
                            <div className="setting-info">
                                <span className="toggle-label">
                                    {appVersion ? (config.language === 'en' ? `Version ${appVersion}` : `Versione ${appVersion}`) : 'BlackBoard Sync'}
                                </span>
                                <span className="setting-desc">
                                    {t('updatesDesc')}
                                </span>
                            </div>
                            <button
                                className={`btn-update ${checkingUpdate ? 'checking' : ''}`}
                                onClick={handleCheckForUpdates}
                                disabled={checkingUpdate}
                                aria-label={t('checkingUpdates')}
                                title={t('checkingUpdates')}
                            >
                                {checkingUpdate ? (
                                    <span className="spinner-small" />
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                        <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z" />
                                        <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                        {getUpdateMessage() && (
                            <div className={`update-message update-${updateStatus}`}>
                                {getUpdateMessage()}
                            </div>
                        )}
                        {downloadProgress !== null && (
                            <div className="update-progress-container">
                                <div className="update-progress-bar">
                                    <div
                                        className="update-progress-fill"
                                        style={{ width: `${downloadProgress}%` }}
                                    />
                                </div>
                                <span className="update-progress-text">{downloadProgress}%</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsView;
