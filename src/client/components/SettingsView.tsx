import React, { useState, useEffect } from 'react';

interface AppConfig {
    syncDir: string;
    autoSync: boolean;
    autoSyncInterval: number;
    autoSyncScheduledTime: string;
    enabledCourses: string[];
    courseAliases: Record<string, string>;
    collapsedTerms: string[];
    lastSync: string | null;
    minimizeToTray: boolean;
    startAtLogin: boolean;
    notifications: boolean;
}

interface SettingsViewProps {
    config: AppConfig;
    onConfigChange: (config: AppConfig) => void;
    onClose: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ config, onConfigChange, onClose }) => {
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

    const handleCheckForUpdates = async () => {
        setCheckingUpdate(true);
        setUpdateMessage('');
        setUpdateStatus('');
        try {
            await window.api.checkForUpdates();
        } catch { /* ignore */ }
    };

    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
                <div className="settings-header">
                    <h2 className="settings-title">Impostazioni</h2>
                    <button className="settings-close-btn" onClick={onClose}>
                        <svg width="14" height="14" viewBox="0 0 10 10">
                            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>

                <div className="settings-body">
                    {/* Sync folder */}
                    <div className="settings-group">
                        <span className="settings-group-label">Cartella di sincronizzazione</span>
                        <div className="folder-row">
                            <span className="folder-path" title={config.syncDir}>
                                {config.syncDir}
                            </span>
                            <div className="folder-actions">
                                <button className="btn-icon" onClick={handleOpenFolder} title="Apri cartella">
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M1.5 2A1.5 1.5 0 000 3.5v9A1.5 1.5 0 001.5 14h13a1.5 1.5 0 001.5-1.5V5a1.5 1.5 0 00-1.5-1.5H7.707l-1.854-1.854A.5.5 0 005.5 1.5H1.5z" />
                                    </svg>
                                </button>
                                <button className="btn-icon" onClick={handleSelectFolder} title="Cambia cartella">
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
                            <span className="toggle-label">Sincronizzazione automatica</span>
                            <div className={`toggle ${config.autoSync ? 'active' : ''}`}>
                                <div className="toggle-thumb" />
                            </div>
                        </div>

                        {config.autoSync && (
                            <div className="auto-sync-options">
                                <span className="auto-sync-info">Frequenza</span>
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
                                        Giornaliero
                                    </button>
                                </div>

                                {config.autoSyncInterval === 0 && (
                                    <div className="schedule-time-row">
                                        <span className="auto-sync-info">Ogni giorno alle</span>
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
                        <span className="settings-group-label">Generali</span>

                        <div className="toggle-row" onClick={() => updateSetting({ minimizeToTray: !config.minimizeToTray })}>
                            <div className="setting-info">
                                <span className="toggle-label">Minimizza nel tray</span>
                                <span className="setting-desc">Chiudendo la finestra, l'app resta attiva</span>
                            </div>
                            <div className={`toggle ${config.minimizeToTray ? 'active' : ''}`}>
                                <div className="toggle-thumb" />
                            </div>
                        </div>

                        <div className="setting-divider" />

                        <div className="toggle-row" onClick={() => updateSetting({ startAtLogin: !config.startAtLogin })}>
                            <div className="setting-info">
                                <span className="toggle-label">Avvia con Windows</span>
                                <span className="setting-desc">Avvia l'app automaticamente all'accesso</span>
                            </div>
                            <div className={`toggle ${config.startAtLogin ? 'active' : ''}`}>
                                <div className="toggle-thumb" />
                            </div>
                        </div>

                        <div className="setting-divider" />

                        <div className="toggle-row" onClick={() => updateSetting({ notifications: !config.notifications })}>
                            <div className="setting-info">
                                <span className="toggle-label">Notifiche</span>
                                <span className="setting-desc">Notifica al completamento della sincronizzazione</span>
                            </div>
                            <div className={`toggle ${config.notifications ? 'active' : ''}`}>
                                <div className="toggle-thumb" />
                            </div>
                        </div>
                    </div>

                    {/* Updates */}
                    <div className="settings-group">
                        <span className="settings-group-label">Aggiornamenti</span>
                        <div className="update-row">
                            <div className="setting-info">
                                <span className="toggle-label">
                                    {appVersion ? `Versione ${appVersion}` : 'BlackBoard Sync'}
                                </span>
                                <span className="setting-desc">
                                    L'app verifica automaticamente gli aggiornamenti
                                </span>
                            </div>
                            <button
                                className={`btn-update ${checkingUpdate ? 'checking' : ''}`}
                                onClick={handleCheckForUpdates}
                                disabled={checkingUpdate}
                            >
                                {checkingUpdate ? (
                                    <span className="spinner-small" />
                                ) : (
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M11.534 7h3.932a.25.25 0 01.192.41l-1.966 2.36a.25.25 0 01-.384 0l-1.966-2.36a.25.25 0 01.192-.41zm-11 2h3.932a.25.25 0 00.192-.41L2.692 6.23a.25.25 0 00-.384 0L.342 8.59A.25.25 0 00.534 9z" />
                                        <path d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 11-.771-.636A5.501 5.501 0 0113.5 7.5a.5.5 0 01-1 0A4.5 4.5 0 008 3zM3.5 9.5a.5.5 0 01.5-.5 4.5 4.5 0 004.5 4.5c1.552 0 2.94-.707 3.857-1.818a.5.5 0 11.771.636A5.501 5.501 0 012.5 9.5a.5.5 0 01.5-.5z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                        {updateMessage && (
                            <div className={`update-message update-${updateStatus}`}>
                                {updateMessage}
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
