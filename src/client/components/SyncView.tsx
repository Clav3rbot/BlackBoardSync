import React, { useState, useEffect, useRef } from 'react';
import Header from './Header';
import CourseList from './CourseList';
import SyncResultModal from './SyncResultModal';
import SettingsView from './SettingsView';
import Tutorial from './Tutorial';
import Icon from './Icon';
import { getT } from '../i18n';
import type { Accounts } from '../App';

interface Course {
    id: string;
    courseId: string;
    name: string;
    instructor?: string;
}

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
    heatmap: boolean;
    language: string;
    theme: string;
    tutorialDone: boolean;
    webeepEnabled: boolean;
}

interface SyncProgress {
    phase: 'scanning' | 'downloading' | 'complete' | 'error';
    current: number;
    total: number;
    currentFile?: string;
    error?: string;
}

interface SyncResultCourse {
    courseName: string;
    files: string[];
    webeep: boolean;
}

interface SyncResult {
    totalDownloaded: number;
    totalScanned: number;
    courses: SyncResultCourse[];
    duration: number;
    warnings: string[];
}

interface SyncViewProps {
    lang: 'it' | 'en';
    onLanguageChange: (lang: 'it' | 'en') => void;
    user: { id: string; userName: string; name: { given: string; family: string } };
    accounts: Accounts;
    onLogin: (provider: 'bocconi' | 'webeep', user: any) => void;
    onLogout: (provider?: 'bocconi' | 'webeep' | 'all') => void;
}

const SyncView: React.FC<SyncViewProps> = ({
    lang,
    onLanguageChange,
    user,
    accounts,
    onLogin,
    onLogout,
}) => {
    const t = getT(lang);
    const [courses, setCourses] = useState<Course[]>([]);
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [progress, setProgress] = useState<SyncProgress | null>(null);
    const [loadingCourses, setLoadingCourses] = useState(true);
    const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsDismiss, setSettingsDismiss] = useState(false);
    const [coursesError, setCoursesError] = useState('');
    const [updateReady, setUpdateReady] = useState<{ releaseName: string } | null>(null);
    const [progressVisible, setProgressVisible] = useState(false);
    const [loadingInstructors, setLoadingInstructors] = useState(false);
    const [cacheMisses, setCacheMisses] = useState<Set<string>>(new Set());
    const [tutorialOpen, setTutorialOpen] = useState(false);
    const tutorialShown = useRef(false);

    // First time in: the tour starts once the courses are on screen, so it
    // can point at them. It runs once per session at most.
    useEffect(() => {
        if (!config || config.tutorialDone || loadingCourses || syncResult || tutorialShown.current) return;
        tutorialShown.current = true;
        setTutorialOpen(true);
    }, [config, loadingCourses, syncResult]);

    // Connecting, disconnecting or pausing an account changes which courses
    // exist, so the list is fetched again; the first value is the initial load.
    const accountsKey = config
        ? `${!!accounts.bocconi}:${!!accounts.webeep}:${config.webeepEnabled}`
        : '';
    const lastAccountsKey = useRef('');
    useEffect(() => {
        if (!accountsKey) return;
        if (lastAccountsKey.current && lastAccountsKey.current !== accountsKey) loadCourses();
        lastAccountsKey.current = accountsKey;
    }, [accountsKey]);

    // The tour opens Settings for its PoliMi step and slides it shut again when
    // it moves on. Closing doesn't check whether the panel is open: the tour's
    // key handler can hold an older render where it wasn't yet, and a request
    // left over is cleared whenever the panel opens.
    const openSettings = () => {
        setSettingsDismiss(false);
        setSettingsOpen(true);
    };
    const handleTutorialSettings = (open: boolean) => {
        if (open) openSettings();
        else setSettingsDismiss(true);
    };

    const handleTutorialDone = async () => {
        setTutorialOpen(false);
        handleTutorialSettings(false);
        if (config && !config.tutorialDone) {
            setConfig(await window.api.updateConfig({ tutorialDone: true }));
        }
    };

    useEffect(() => {
        loadData();

        const unsubProgress = window.api.onSyncProgress((p: SyncProgress) => {
            setProgress(p);
            if (p.phase === 'error') {
                setSyncing(false);
            }
        });

        const unsubComplete = window.api.onSyncComplete((result: SyncResult) => {
            setSyncing(false);
            if (result) setSyncResult(result);
            loadConfig();
        });

        const unsubSyncStart = window.api.onSyncStart(() => {
            setSyncing(true);
            setProgress(null);
        });

        const unsubUpdateReady = window.api.onUpdateReady((info: { releaseName: string }) => {
            setUpdateReady(info);
        });

        return () => {
            unsubProgress();
            unsubComplete();
            unsubSyncStart();
            unsubUpdateReady();
        };
    }, []);

    // Grace delay: don't flash the progress bar on the very first frame of a
    // sync (feels abrupt, esp. on startup auto-sync). Show it after 250ms so it
    // fades in deliberately; hide immediately when the sync ends.
    useEffect(() => {
        const active = syncing || progress?.phase === 'error';
        if (!active) {
            setProgressVisible(false);
            return;
        }
        const t = window.setTimeout(() => setProgressVisible(true), 250);
        return () => window.clearTimeout(t);
    }, [syncing, progress]);

    const loadData = async () => {
        try {
            await loadConfig();
            await loadCourses();
        } catch (err) {
            console.error('Failed to load data:', err);
        }
    };

    // Only the latest request may write the list: pausing PoliMi right after
    // resuming it fires two, and the slower one must not land last.
    const coursesRequest = useRef(0);
    const loadCourses = async () => {
        const request = ++coursesRequest.current;
        setLoadingCourses(true);
        setCoursesError('');
        try {
            const result = await window.api.getCourses();
            if (request !== coursesRequest.current) return;
            // A university that fails to answer must say so: with two sources,
            // silence is indistinguishable from "you have no courses there".
            setCoursesError(result.error ?? '');
            if (result.courses) {
                const list = result.courses;
                
                // Read cache first (extremely fast local disk read)
                let cached: Record<string, string> = {};
                try {
                    const res = await window.api.getCachedInstructors();
                    if (res) cached = res;
                } catch (e) {
                    console.error('Failed to load cached instructors:', e);
                }

                // Determine which ones are not in the cache (cache misses)
                const misses = new Set<string>();
                const listWithCache = list.map((c) => {
                    if (cached && cached[c.id]) {
                        return { ...c, instructor: cached[c.id] };
                    }
                    // WeBeep encodes the teacher in the course title, so it
                    // arrives already resolved — no lookup, no skeleton.
                    if (!c.instructor) {
                        misses.add(c.id);
                    }
                    return c;
                });

                setCacheMisses(misses);
                setCourses(listWithCache);
                
                // Start background fetch for instructor names
                loadInstructors(list.map((c) => c.id));
            } else {
                setCoursesError(result.error || t('coursesLoadError'));
            }
        } catch (err) {
            console.error('Failed to load courses:', err);
            setCoursesError(t('coursesLoadError'));
        } finally {
            if (request === coursesRequest.current) setLoadingCourses(false);
        }
    };

    const loadInstructors = async (courseIds: string[]) => {
        if (courseIds.length === 0) return;
        setLoadingInstructors(true);

        // Background: fetch fresh data and update UI if anything changed
        try {
            const fresh = await window.api.getInstructors(courseIds);
            if (fresh && Object.keys(fresh).length > 0) {
                setCourses((prev) =>
                    prev.map((c) => (fresh[c.id] ? { ...c, instructor: fresh[c.id] } : c))
                );
            }
        } catch {
            /* instructors are best-effort; ignore failures */
        } finally {
            setLoadingInstructors(false);
        }
    };

    const loadConfig = async () => {
        try {
            const cfg = await window.api.getConfig();
            setConfig(cfg);
            if (cfg.language && cfg.language !== lang) {
                onLanguageChange(cfg.language as 'it' | 'en');
            }
        } catch (err) {
            console.error('Failed to load config:', err);
        }
    };

    // The button turns into "Stop" under the pointer, so the second click of a
    // double click would cancel the sync it just started. Stop ignores clicks
    // for a moment after a start.
    const syncStartedAt = useRef(0);
    const handleSync = async () => {
        syncStartedAt.current = Date.now();
        setSyncing(true);
        await window.api.sync();
    };

    const handleAbortSync = async () => {
        if (Date.now() - syncStartedAt.current < 600) return;
        await window.api.abortSync();
        setSyncing(false);
        setProgress(null);
    };

    const handleToggleCourse = async (courseId: string) => {
        if (!config) return;
        const hidden = config.hiddenCourses || [];
        const visibleIds = courses.filter((c) => !hidden.includes(c.id)).map((c) => c.id);

        let enabled: string[];
        if (config.syncAllCourses) {
            // Leaving "sync all" mode: materialise the explicit list as every
            // visible course minus the one just unchecked.
            enabled = visibleIds.filter((id) => id !== courseId);
        } else {
            enabled = [...config.enabledCourses];
            if (enabled.includes(courseId)) {
                enabled = enabled.filter((id) => id !== courseId);
            } else {
                enabled.push(courseId);
            }
        }

        // Re-checking every visible course collapses back to "sync all" so newly
        // appearing courses keep syncing automatically.
        const syncAll =
            visibleIds.length > 0 && visibleIds.every((id) => enabled.includes(id));

        const newConfig = await window.api.updateConfig({
            syncAllCourses: syncAll,
            enabledCourses: syncAll ? [] : enabled,
        });
        setConfig(newConfig);
    };

    const handleRenameCourse = async (courseId: string, newName: string) => {
        if (!config) return;
        const aliases = { ...config.courseAliases };
        if (newName) {
            aliases[courseId] = newName;
        } else {
            delete aliases[courseId];
        }
        const newConfig = await window.api.updateConfig({ courseAliases: aliases });
        setConfig(newConfig);
    };

    const handleCollapsedTermsChange = async (collapsed: string[]) => {
        const newConfig = await window.api.updateConfig({ collapsedTerms: collapsed });
        setConfig(newConfig);
    };

    const handleHideCourse = async (courseId: string) => {
        if (!config) return;
        const hidden = [...(config.hiddenCourses || [])];
        if (!hidden.includes(courseId)) hidden.push(courseId);
        // The selection is left alone: syncs already skip hidden courses, and
        // showing the course again brings back the tick it had.
        const newConfig = await window.api.updateConfig({ hiddenCourses: hidden });
        setConfig(newConfig);
    };

    const handleUnhideCourse = async (courseId: string) => {
        if (!config) return;
        const hidden = (config.hiddenCourses || []).filter((id) => id !== courseId);
        const newConfig = await window.api.updateConfig({ hiddenCourses: hidden });
        setConfig(newConfig);
    };

    const handleHideTerm = async (termId: string) => {
        if (!config) return;
        const hidden = [...(config.hiddenTerms || [])];
        if (!hidden.includes(termId)) hidden.push(termId);
        const newConfig = await window.api.updateConfig({ hiddenTerms: hidden });
        setConfig(newConfig);
    };

    const handleUnhideTerm = async (termId: string) => {
        if (!config) return;
        const hidden = (config.hiddenTerms || []).filter((id) => id !== termId);
        const newConfig = await window.api.updateConfig({ hiddenTerms: hidden });
        setConfig(newConfig);
    };

    const handleChangeFolder = async () => {
        const folder = await window.api.selectFolder();
        if (folder) {
            const newConfig = await window.api.updateConfig({ syncDir: folder });
            setConfig(newConfig);
        }
    };

    const formatLastSync = (iso: string | null): string => {
        if (!iso) return t('never');
        const date = new Date(iso);
        return date.toLocaleString(lang === 'en' ? 'en-US' : 'it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    if (!config) {
        return (
            <div className="sync-view">
                <div className="loading-screen">
                    <div className="spinner" />
                </div>
            </div>
        );
    }

    const isSyncError = progress?.phase === 'error';
    const showProgress = (syncing || isSyncError) && progressVisible;
    const hasTotal = !!progress && progress.total > 0;
    const indeterminate = (syncing || isSyncError) && !isSyncError && !hasTotal;
    const progressPct = isSyncError ? 100 : hasTotal ? (progress!.current / progress!.total) * 100 : 0;

    let phaseText = '';
    if (isSyncError) {
        phaseText = `${t('error')}: ${progress?.error ?? t('syncingPhaseError')}`;
    } else if (!progress) {
        phaseText = t('syncingPhaseConnecting');
    } else if (progress.phase === 'scanning') {
        phaseText = progress.total > 0
            ? `${t('syncingPhaseScanning')} (${progress.current}/${progress.total})`
            : t('syncingPhaseScanning');
    } else if (progress.phase === 'downloading') {
        phaseText = `${progress.currentFile || t('syncingPhaseDownloading')} (${progress.current}/${progress.total})`;
    }


    return (
        <div className="sync-view">
            <Header
                lang={lang}
                userName={`${user.name.given} ${user.name.family}`}
                matricola={user.userName}
                lastSync={formatLastSync(config.lastSync)}
                syncing={syncing}
                syncDir={config.syncDir}
                onSync={handleSync}
                onAbort={handleAbortSync}
                onLogout={() => onLogout('all')}
                onSettings={openSettings}
                onOpenFolder={() => window.api.openFolder(config.syncDir)}
                onChangeFolder={handleChangeFolder}
            />

            {showProgress && (
                <div className={`sync-progress ${isSyncError ? 'error' : ''}`}>
                    <div className={`progress-bar ${isSyncError ? 'error' : ''}`}>
                        {/* Determinate fill: always anchored left, grows 0 -> pct.
                            Stays at 0 while connecting, so when scanning starts it
                            grows forward with no snap-back. */}
                        <div
                            className="progress-fill"
                            style={{ width: `${progressPct}%` }}
                        />
                        {/* Indeterminate overlay: a sliding segment for the
                            "connecting" phase. Fades out (doesn't teleport) once a
                            real total arrives, masking the hand-off. */}
                        <div
                            className={`progress-indeterminate ${indeterminate ? 'visible' : ''}`}
                            aria-hidden="true"
                        />
                    </div>
                    <p className="progress-text" aria-live="polite">
                        <span className="progress-text-label">{phaseText}</span>
                    </p>
                </div>
            )}

            {/* A sync that ends during the tour keeps its summary for after. */}
            {syncResult && !tutorialOpen && (
                <SyncResultModal
                    lang={lang}
                    result={syncResult}
                    onClose={() => setSyncResult(null)}
                />
            )}

            {coursesError && !loadingCourses && (
                <div className="error-message" style={{ margin: '0 18px 12px' }}>
                    {coursesError}{' '}
                    <a href="#" onClick={(e) => { e.preventDefault(); loadCourses(); }}>{t('retry')}</a>
                </div>
            )}

            <CourseList
                lang={lang}
                courses={courses}
                syncAll={config.syncAllCourses}
                enabledCourses={config.enabledCourses}
                courseAliases={config.courseAliases}
                collapsedTerms={config.collapsedTerms || []}
                hiddenCourses={config.hiddenCourses || []}
                hiddenTerms={config.hiddenTerms || []}
                loading={loadingCourses}
                onToggle={handleToggleCourse}
                onRename={handleRenameCourse}
                onCollapsedTermsChange={handleCollapsedTermsChange}
                onHide={handleHideCourse}
                onUnhide={handleUnhideCourse}
                onHideTerm={handleHideTerm}
                onUnhideTerm={handleUnhideTerm}
                loadingInstructors={loadingInstructors}
                cacheMisses={cacheMisses}
                heatmap={config.heatmap}
            />

            {settingsOpen && (
                <SettingsView
                    config={config}
                    onConfigChange={(newConfig) => {
                        setConfig(newConfig);
                        if (newConfig.language && newConfig.language !== lang) {
                            onLanguageChange(newConfig.language as 'it' | 'en');
                        }
                    }}
                    onClose={() => {
                        setSettingsOpen(false);
                        setSettingsDismiss(false);
                    }}
                    dismiss={settingsDismiss}
                    lang={lang}
                    accounts={accounts}
                    onLogin={onLogin}
                    onLogout={onLogout}
                />
            )}

            {tutorialOpen && (
                <Tutorial lang={lang} onDone={handleTutorialDone} onSettings={handleTutorialSettings} />
            )}

            {updateReady && (
                <div className="update-dialog-overlay" onClick={() => setUpdateReady(null)}>
                    <div className="update-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="update-dialog-icon">
                            <Icon name="download" size={30} />
                        </div>
                        <h3 className="update-dialog-title">{t('updateReadyTitle')}</h3>
                        <p className="update-dialog-text">
                            {updateReady.releaseName
                                ? (lang === 'en' ? `Version ${updateReady.releaseName} has been downloaded.` : `La versione ${updateReady.releaseName} è stata scaricata.`)
                                : t('updateReadyText')}
                        </p>
                        <p className="update-dialog-subtext">{t('updateReadySubtext')}</p>
                        <div className="update-dialog-actions">
                            <button className="btn-update-later" onClick={() => setUpdateReady(null)}>{t('updateLater')}</button>
                            <button className="btn-update-restart" onClick={() => window.api.restartForUpdate()}>{t('updateRestart')}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SyncView;
