import React, { useState, useEffect, useRef } from 'react';
import Header from './Header';
import CourseList from './CourseList';
import SyncResultModal from './SyncResultModal';
import RecentDownloadsModal from './RecentDownloadsModal';
import SettingsView from './SettingsView';
import ConfirmDialog from './ConfirmDialog';
import Tutorial from './Tutorial';
import { getT } from '../i18n';
import { dismissToast, toast } from '../toast';
import type { Accounts } from '../App';
import type { AppConfig, Course, SyncProgress, SyncResult } from '../../types';

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
    // For the listeners below, which are registered once and would keep the first language.
    const tRef = useRef(t);
    tRef.current = t;
    const [courses, setCourses] = useState<Course[]>([]);
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [progress, setProgress] = useState<SyncProgress | null>(null);
    const [loadingCourses, setLoadingCourses] = useState(true);
    const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsDismiss, setSettingsDismiss] = useState(false);
    const [coursesError, setCoursesError] = useState('');
    const [progressVisible, setProgressVisible] = useState(false);
    const [loadingInstructors, setLoadingInstructors] = useState(false);
    const [cacheMisses, setCacheMisses] = useState<Set<string>>(new Set());
    const [tutorialOpen, setTutorialOpen] = useState(false);
    const [recentOpen, setRecentOpen] = useState(false);
    const [logoutConfirm, setLogoutConfirm] = useState(false);
    const [now, setNow] = useState(Date.now());
    const tutorialShown = useRef(false);
    const lastProgress = useRef({ indeterminate: false, progressPct: 0, phaseText: '' });

    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 30000);
        return () => window.clearInterval(id);
    }, []);

    // The tour waits for the courses to be on screen so it can point at them; once per session.
    useEffect(() => {
        if (!config || config.tutorialDone || loadingCourses || syncResult || tutorialShown.current) return;
        tutorialShown.current = true;
        setTutorialOpen(true);
    }, [config, loadingCourses, syncResult]);

    // Account changes alter which courses exist, so refetch; the first value is the initial load.
    const accountsKey = config
        ? `${!!accounts.bocconi}:${!!accounts.webeep}:${config.webeepEnabled}`
        : '';
    const lastAccountsKey = useRef('');
    useEffect(() => {
        if (!accountsKey) return;
        if (lastAccountsKey.current && lastAccountsKey.current !== accountsKey) loadCourses();
        lastAccountsKey.current = accountsKey;
    }, [accountsKey]);

    // Closing doesn't check whether the panel is open: the tour's key handler can hold a stale
    // render, and a leftover request is cleared whenever the panel opens.
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
            if (p.phase !== 'error') {
                setProgress(p);
                return;
            }
            setSyncing(false);
            setProgress(null);
            toast({
                key: 'sync-error',
                tone: 'error',
                icon: 'warning',
                message: tRef.current('syncingPhaseError'),
                description: p.error,
                sticky: true,
                action: { label: tRef.current('retry'), run: handleSync },
            });
        });

        const unsubComplete = window.api.onSyncComplete((result: SyncResult) => {
            setSyncing(false);
            if (result && (result.totalDownloaded > 0 || result.warnings?.length > 0)) {
                setSyncResult(result);
            } else if (result) {
                toast({
                    key: 'up-to-date',
                    tone: 'success',
                    icon: 'checkCircle',
                    message: tRef.current('upToDate'),
                    description: `${result.totalScanned} ${tRef.current('filesVerified')}`,
                });
            }
            setNow(Date.now());
            loadConfig();
        });

        const unsubSyncStart = window.api.onSyncStart(() => {
            setSyncing(true);
            setProgress(null);
            dismissToast('sync-error');
        });

        const unsubUpdateReady = window.api.onUpdateReady((info: { releaseName: string }) => {
            const title = tRef.current('updateReadyTitle');
            toast({
                key: 'update-ready',
                tone: 'accent',
                icon: 'download',
                message: info.releaseName ? `${title} · ${info.releaseName}` : title,
                description: tRef.current('updateReadySubtext'),
                sticky: true,
                action: { label: tRef.current('updateRestart'), run: () => window.api.restartForUpdate() },
            });
        });

        return () => {
            unsubProgress();
            unsubComplete();
            unsubSyncStart();
            unsubUpdateReady();
        };
    }, []);

    // Grace delay so the bar doesn't flash on the first frame of a sync; hide at once when it ends.
    useEffect(() => {
        if (!syncing) {
            setProgressVisible(false);
            return;
        }
        const t = window.setTimeout(() => setProgressVisible(true), 250);
        return () => window.clearTimeout(t);
    }, [syncing]);

    const loadData = async () => {
        try {
            await loadConfig();
            await loadCourses();
        } catch (err) {
            console.error('Failed to load data:', err);
        }
    };

    // Only the latest request may write the list: pausing PoliMi right after resuming fires two.
    const coursesRequest = useRef(0);
    const loadCourses = async () => {
        const request = ++coursesRequest.current;
        setLoadingCourses(true);
        setCoursesError('');
        try {
            const result = await window.api.getCourses();
            if (request !== coursesRequest.current) return;
            // With two sources, a silent failure would look like "no courses there".
            setCoursesError(result.error ?? '');
            if (result.courses) {
                const list = result.courses;

                let cached: Record<string, string> = {};
                try {
                    const res = await window.api.getCachedInstructors();
                    if (res) cached = res;
                } catch (e) {
                    console.error('Failed to load cached instructors:', e);
                }

                const misses = new Set<string>();
                const listWithCache = list.map((c) => {
                    if (cached && cached[c.id]) {
                        return { ...c, instructor: cached[c.id] };
                    }
                    // WeBeep courses arrive with the teacher parsed from the title: no lookup.
                    if (!c.instructor) {
                        misses.add(c.id);
                    }
                    return c;
                });

                setCacheMisses(misses);
                setCourses(listWithCache);

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

    // The button turns into "Stop" under the pointer: Stop ignores clicks briefly after a start,
    // so a double click doesn't cancel the sync it just started.
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

    const saveSelection = async (change: (enabled: string[]) => string[]) => {
        if (!config) return;
        const hidden = config.hiddenCourses || [];
        const visibleIds = courses.filter((c) => !hidden.includes(c.id)).map((c) => c.id);
        const enabled = change(config.syncAllCourses ? visibleIds : config.enabledCourses);

        // Back to "sync all" when every visible course is checked, so new courses keep syncing.
        const syncAll =
            visibleIds.length > 0 && visibleIds.every((id) => enabled.includes(id));

        const newConfig = await window.api.updateConfig({
            syncAllCourses: syncAll,
            enabledCourses: syncAll ? [] : enabled,
        });
        setConfig(newConfig);
    };

    const handleToggleCourse = (courseId: string) =>
        saveSelection((enabled) =>
            enabled.includes(courseId) ? enabled.filter((id) => id !== courseId) : [...enabled, courseId]
        );

    const handleToggleTerm = (courseIds: string[], enable: boolean) =>
        saveSelection((enabled) =>
            enable
                ? [...enabled, ...courseIds.filter((id) => !enabled.includes(id))]
                : enabled.filter((id) => !courseIds.includes(id))
        );

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
        // Selection left alone: syncs skip hidden courses, and unhiding brings the tick back.
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

    const locale = lang === 'en' ? 'en-US' : 'it-IT';
    const formatLastSyncDate = (iso: string): string =>
        new Date(iso).toLocaleString(locale, {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });

    const formatLastSync = (iso: string | null): string => {
        if (!iso) return t('never');
        const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
        const mins = Math.floor((now - Date.parse(iso)) / 60000);
        if (mins < 1) return relative.format(0, 'second');
        if (mins < 60) return relative.format(-mins, 'minute');
        if (mins < 60 * 24) return relative.format(-Math.floor(mins / 60), 'hour');
        if (mins < 60 * 24 * 7) return relative.format(-Math.floor(mins / (60 * 24)), 'day');
        return formatLastSyncDate(iso);
    };

    // The interval timer restarts with the app, so only the daily mode has a known next time.
    const autoSyncNote = (cfg: AppConfig): string => {
        if (!cfg.autoSync) return '';
        const mins = cfg.autoSyncInterval;
        return mins === 0
            ? ` · ${t('nextSyncAt')} ${cfg.autoSyncScheduledTime}`
            : ` · ${t('autoSyncEvery')} ${mins < 60 ? `${mins}m` : `${mins / 60}h`}`;
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

    const showProgress = syncing && progressVisible;
    const hasTotal = !!progress && progress.total > 0;
    const indeterminate = syncing && !hasTotal;
    const progressPct = hasTotal ? (progress!.current / progress!.total) * 100 : 0;

    let phaseText = '';
    if (!progress) {
        phaseText = t('syncingPhaseConnecting');
    } else if (progress.phase === 'scanning') {
        phaseText = progress.total > 0
            ? `${t('syncingPhaseScanning')} (${progress.current}/${progress.total})`
            : t('syncingPhaseScanning');
    } else if (progress.phase === 'downloading') {
        phaseText = `${progress.currentFile || t('syncingPhaseDownloading')} (${progress.current}/${progress.total})`;
    }

    // The bar keeps its last content while it slides shut, instead of emptying first.
    if (showProgress || syncing) {
        lastProgress.current = { indeterminate, progressPct, phaseText };
    }
    const bar = lastProgress.current;

    return (
        <div className="sync-view">
            <Header
                lang={lang}
                userName={`${user.name.given} ${user.name.family}`}
                matricola={user.userName}
                lastSync={formatLastSync(config.lastSync)}
                lastSyncTitle={
                    (config.lastSync ? formatLastSyncDate(config.lastSync) : t('never')) + autoSyncNote(config)
                }
                syncing={syncing}
                syncDir={config.syncDir}
                onSync={handleSync}
                onAbort={handleAbortSync}
                onLogout={() => setLogoutConfirm(true)}
                onSettings={openSettings}
                onRecent={() => setRecentOpen(true)}
                onOpenFolder={() => window.api.openFolder(config.syncDir)}
                onChangeFolder={handleChangeFolder}
            />

            {/* Always mounted, so it can slide open and shut. */}
            <div className={`sync-progress-wrap ${showProgress ? 'open' : ''}`}>
                <div className="sync-progress">
                    <div className="progress-bar">
                        {/* Stays at 0 while connecting, so it grows forward with no snap-back. */}
                        <div
                            className="progress-fill"
                            style={{ width: `${bar.progressPct}%` }}
                        />
                        {/* Fades out once a real total arrives, masking the hand-off. */}
                        <div
                            className={`progress-indeterminate ${bar.indeterminate ? 'visible' : ''}`}
                            aria-hidden="true"
                        />
                    </div>
                    <p className="progress-text" aria-live="polite">
                        <span className="progress-text-label">{bar.phaseText}</span>
                    </p>
                </div>
            </div>

            {/* A sync that ends during the tour keeps its summary for after. */}
            {syncResult && !tutorialOpen && (
                <SyncResultModal
                    lang={lang}
                    result={syncResult}
                    onClose={() => setSyncResult(null)}
                />
            )}

            {recentOpen && (
                <RecentDownloadsModal lang={lang} onClose={() => setRecentOpen(false)} />
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
                onToggleTerm={handleToggleTerm}
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

            {logoutConfirm && (
                <ConfirmDialog
                    icon="signOut"
                    title={t('logoutConfirmTitle')}
                    text={t('logoutConfirmText')}
                    subtext={t('logoutConfirmSubtext')}
                    cancelLabel={t('cancel')}
                    confirmLabel={t('logout')}
                    onCancel={() => setLogoutConfirm(false)}
                    onConfirm={() => onLogout('all')}
                />
            )}
        </div>
    );
};

export default SyncView;
