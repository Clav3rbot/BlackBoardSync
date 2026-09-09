import React, { useState, useEffect } from 'react';
import Icon from './Icon';
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
    const [closing, setClosing] = useState(false);

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
        <div className={`settings-overlay ${closing ? 'closing' : ''}`} onClick={() => setClosing(true)}>
            <div
                className="settings-panel"
                onClick={(e) => e.stopPropagation()}
                onAnimationEnd={(e) => {
                    if (closing && e.target === e.currentTarget) onClose();
                }}
            >
                <div className="settings-header">
                    <h2 className="settings-title">{t('settingsTitle')}</h2>
                    <button className="settings-close-btn" onClick={() => setClosing(true)}>
                        <Icon name="close" size={15} weight="regular" />
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
                                    <Icon name="folderOpen" size={15} />
                                </button>
                                <button className="btn-icon" onClick={handleSelectFolder} title={t('changeFolder')}>
                                    <Icon name="pencil" size={14} />
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
                                <Icon name="resize" size={12} />
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
                                    <Icon name="download" size={15} />
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
