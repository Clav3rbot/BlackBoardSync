import React, { useState, useEffect, useRef } from 'react';
import Icon from './Icon';
import { formatStudentName } from './Header';
import { connect } from '../connect';
import { getT, type Lang, type TranslationKeys } from '../i18n';
import { isMac } from '../platform';
import { applyTheme } from '../theme';
import { useEscape } from '../useEscape';
import { useFocusTrap } from '../useFocusTrap';
import type { Accounts } from '../App';
import type { Provider, UserInfo, AppConfig } from '../../types';

// In a row, the row takes the click; the switch is what the keyboard and screen readers reach.
const Switch: React.FC<{ on: boolean; label: string; tip?: string; onClick?: () => void }> = ({
    on,
    label,
    tip,
    onClick,
}) => (
    <button
        className={`toggle ${on ? 'active' : ''}`}
        role="switch"
        aria-checked={on}
        aria-label={label}
        data-tip={tip}
        onClick={onClick}
    >
        <span className="toggle-thumb" />
    </button>
);

type ToggleKey = 'minimizeToTray' | 'startAtLogin' | 'syncOnStartup' | 'notifications' | 'heatmap';

const TOGGLES: { key: ToggleKey; label: keyof TranslationKeys; desc: keyof TranslationKeys }[] = [
    { key: 'minimizeToTray', label: 'minimizeToTrayLabel', desc: 'minimizeToTrayDesc' },
    { key: 'startAtLogin', label: isMac ? 'startAtLoginLabelMac' : 'startAtLoginLabelWin', desc: 'startAtLoginDesc' },
    { key: 'syncOnStartup', label: 'syncOnStartupLabel', desc: 'syncOnStartupDesc' },
    { key: 'notifications', label: 'notificationsLabel', desc: 'notificationsDesc' },
    { key: 'heatmap', label: 'heatmapLabel', desc: 'heatmapDesc' },
];

export const formatInterval = (mins: number) => (mins < 60 ? `${mins}m` : `${mins / 60}h`);

interface SettingsViewProps {
    config: AppConfig;
    onConfigChange: (config: AppConfig) => void;
    onClose: () => void;
    // Set from outside (the tour) to slide the panel out as a click would.
    dismiss?: boolean;
    lang: Lang;
    accounts: Accounts;
    onLogin: (provider: Provider, user: UserInfo) => void;
    onLogout: (provider?: Provider | 'all') => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({
    config,
    onConfigChange,
    onClose,
    dismiss,
    accounts,
    onLogin,
    onLogout,
}) => {
    const [webeepBusy, setWebeepBusy] = useState(false);
    const [webeepError, setWebeepError] = useState('');

    const connectWebeep = async () => {
        setWebeepBusy(true);
        setWebeepError('');
        setWebeepError(await connect('webeep', () => window.api.webeepLogin(), onLogin, ''));
        setWebeepBusy(false);
    };

    const t = getT(config.language);
    const [appVersion, setAppVersion] = useState('');
    const [checkingUpdate, setCheckingUpdate] = useState(false);
    const [updateMessage, setUpdateMessage] = useState('');
    const [updateStatus, setUpdateStatus] = useState<string>('');
    const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
    const [localTime, setLocalTime] = useState(config.autoSyncScheduledTime);
    const [closing, setClosing] = useState(false);

    useEffect(() => {
        if (dismiss) setClosing(true);
    }, [dismiss]);

    useEscape(() => setClosing(true));
    const panelRef = useRef<HTMLDivElement>(null);
    useFocusTrap(panelRef);

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

    const toggle = (key: ToggleKey) => {
        const partial: Partial<AppConfig> = {};
        partial[key] = !config[key];
        updateSetting(partial);
    };

    const theme = config.theme === 'light' ? 'light' : 'dark';
    const webeepEnabled = config.webeepEnabled !== false;

    const setTheme = (next: 'dark' | 'light') => {
        if (next === theme) return;
        applyTheme(next, true);
        updateSetting({ theme: next });
    };

    const handleSelectFolder = async () => {
        const folder = await window.api.selectFolder();
        if (folder) await updateSetting({ syncDir: folder });
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
                ref={panelRef}
                className="settings-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-title"
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                onAnimationEnd={(e) => {
                    if (closing && e.target === e.currentTarget) onClose();
                }}
            >
                <div className="settings-header">
                    <h2 id="settings-title" className="settings-title">{t('settingsTitle')}</h2>
                    <button className="settings-close-btn" onClick={() => setClosing(true)} aria-label={t('close')}>
                        <Icon name="close" size={15} weight="regular" />
                    </button>
                </div>

                <div className="settings-body">
                    <div className="settings-group">
                        <span className="settings-group-label">{t('syncFolderGroup')}</span>
                        <div className="folder-row">
                            <span className="folder-path" data-tip={config.syncDir}>
                                {config.syncDir}
                            </span>
                            <div className="folder-actions">
                                <button className="btn-icon" onClick={handleOpenFolder} data-tip={t('openFolder')} aria-label={t('openFolder')}>
                                    <Icon name="folderOpen" size={15} />
                                </button>
                                <button className="btn-icon" onClick={handleSelectFolder} data-tip={t('changeFolder')} aria-label={t('changeFolder')}>
                                    <Icon name="pencil" size={14} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="settings-group">
                        <div className="toggle-row" onClick={() => updateSetting({ autoSync: !config.autoSync })}>
                            <span className="toggle-label">{t('autoSyncGroup')}</span>
                            <Switch on={config.autoSync} label={t('autoSyncGroup')} />
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
                                            {formatInterval(mins)}
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

                    <div className="settings-group">
                        <span className="settings-group-label">{t('generalGroup')}</span>

                        {TOGGLES.map(({ key, label, desc }) => (
                            <React.Fragment key={key}>
                                <div className="toggle-row" onClick={() => toggle(key)}>
                                    <div className="setting-info">
                                        <span className="toggle-label">{t(label)}</span>
                                        <span className="setting-desc">{t(desc)}</span>
                                    </div>
                                    <Switch on={!!config[key]} label={t(label)} />
                                </div>
                                <div className="setting-divider" />
                            </React.Fragment>
                        ))}

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
                                <span className="toggle-label">{t('themeLabel')}</span>
                                <span className="setting-desc">{t('themeDesc')}</span>
                            </div>
                            <div className="language-selector">
                                <div className={`selector-highlight ${theme}`} />
                                <button
                                    className={`lang-btn ${theme === 'dark' ? 'active' : ''}`}
                                    onClick={() => setTheme('dark')}
                                    aria-label={t('themeDark')}
                                    data-tip={t('themeDark')}
                                >
                                    <Icon name="moon" size={14} />
                                </button>
                                <button
                                    className={`lang-btn ${theme === 'light' ? 'active' : ''}`}
                                    onClick={() => setTheme('light')}
                                    aria-label={t('themeLight')}
                                    data-tip={t('themeLight')}
                                >
                                    <Icon name="sun" size={14} />
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

                    <div className="settings-group settings-accounts">
                        <span className="settings-group-label">{t('accountsTitle')}</span>

                        <div className="settings-action-row account-row">
                            <div className="setting-info">
                                <span className="toggle-label">{t('bocconiLabel')}</span>
                                <span className="setting-desc account-meta">
                                    {accounts.bocconi ? (
                                        <>
                                            <span>{formatStudentName(`${accounts.bocconi.name.given} ${accounts.bocconi.name.family}`)}</span>
                                            <span aria-hidden="true">·</span>
                                            <button className="account-link" onClick={() => onLogout('bocconi')}>
                                                {t('webeepDisconnect')}
                                            </button>
                                        </>
                                    ) : (
                                        t('accountNotConnected')
                                    )}
                                </span>
                            </div>
                        </div>

                        <div className="setting-divider" />

                        <div
                            className={`settings-action-row account-row ${
                                accounts.webeep && !webeepEnabled ? 'paused' : ''
                            }`}
                        >
                            <div className="setting-info">
                                <span className="toggle-label">{t('polimiLabel')}</span>
                                <span className="setting-desc account-meta">
                                    {webeepError ? (
                                        webeepError
                                    ) : accounts.webeep ? (
                                        <>
                                            <span>
                                                {webeepEnabled
                                                    ? formatStudentName(`${accounts.webeep.name.given} ${accounts.webeep.name.family}`)
                                                    : t('webeepPaused')}
                                            </span>
                                            <span aria-hidden="true">·</span>
                                            <button className="account-link" onClick={() => onLogout('webeep')}>
                                                {t('webeepDisconnect')}
                                            </button>
                                        </>
                                    ) : (
                                        t('accountNotConnected')
                                    )}
                                </span>
                            </div>
                            {accounts.webeep ? (
                                <Switch
                                    on={webeepEnabled}
                                    label={t('webeepToggle')}
                                    tip={t('webeepToggle')}
                                    onClick={() => updateSetting({ webeepEnabled: !webeepEnabled })}
                                />
                            ) : (
                                <button
                                    className="btn-account-connect"
                                    onClick={connectWebeep}
                                    disabled={webeepBusy}
                                >
                                    {webeepBusy && <span className="spinner-small" />}
                                    {webeepBusy ? t('webeepConnecting') : t('webeepConnect')}
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="settings-group">
                        <span className="settings-group-label">{t('updatesGroup')}</span>
                        <div className="update-row">
                            <div className="setting-info">
                                <span className="toggle-label">
                                    {appVersion ? `${t('version')} ${appVersion}` : t('appName')}
                                </span>
                                <span className="setting-desc">
                                    {t('updatesDesc')}
                                </span>
                            </div>
                            <button
                                className="btn-settings-action"
                                onClick={handleCheckForUpdates}
                                disabled={checkingUpdate}
                                data-tip={checkingUpdate ? t('checkingUpdates') : t('checkUpdates')}
                            >
                                {checkingUpdate ? (
                                    <span className="spinner-small" />
                                ) : (
                                    <Icon name="sync" size={12} />
                                )}
                                {t('checkUpdatesShort')}
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
