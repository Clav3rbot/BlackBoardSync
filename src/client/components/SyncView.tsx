import React, { useState, useEffect } from 'react';
import Header from './Header';
import CourseList from './CourseList';
import SyncResultModal from './SyncResultModal';
import SettingsView from './SettingsView';

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
}

interface SyncResult {
    totalDownloaded: number;
    totalScanned: number;
    courses: SyncResultCourse[];
    duration: number;
}

interface SyncViewProps {
    user: { id: string; userName: string; name: { given: string; family: string } };
    onLogout: () => void;
}

const SyncView: React.FC<SyncViewProps> = ({ user, onLogout }) => {
    const [courses, setCourses] = useState<Course[]>([]);
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [progress, setProgress] = useState<SyncProgress | null>(null);
    const [loadingCourses, setLoadingCourses] = useState(true);
    const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [coursesError, setCoursesError] = useState(false);
    const [updateReady, setUpdateReady] = useState<{ releaseName: string } | null>(null);
    const [progressVisible, setProgressVisible] = useState(false);

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
        await Promise.all([loadCourses(), loadConfig()]);
    };

    const loadCourses = async () => {
        setLoadingCourses(true);
        setCoursesError(false);
        try {
            const result = await window.api.getCourses();
            if (result.success && result.courses) {
                const list = result.courses;
                // Show the list as soon as we have courses + terms (fast).
                setCourses(list);
                // Instructor names are the slow part — fetch them after and
                // merge them in progressively, so the list isn't blocked on them.
                loadInstructors(list.map((c) => c.id));
            } else {
                setCoursesError(true);
            }
        } catch (err) {
            console.error('Failed to load courses:', err);
            setCoursesError(true);
        } finally {
            setLoadingCourses(false);
        }
    };

    const loadInstructors = async (courseIds: string[]) => {
        if (courseIds.length === 0) return;

        // Instant: load from disk cache (no HTTP calls)
        try {
            const cached = await window.api.getCachedInstructors();
            if (cached && Object.keys(cached).length > 0) {
                setCourses((prev) =>
                    prev.map((c) => (cached[c.id] ? { ...c, instructor: cached[c.id] } : c))
                );
            }
        } catch {
            /* cache miss is fine */
        }

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
        }
    };

    const loadConfig = async () => {
        try {
            const cfg = await window.api.getConfig();
            setConfig(cfg);
        } catch (err) {
            console.error('Failed to load config:', err);
        }
    };

    const handleSync = async () => {
        setSyncing(true);
        await window.api.sync();
    };

    const handleAbortSync = async () => {
        await window.api.abortSync();
        setSyncing(false);
        setProgress(null);
    };

    const handleToggleCourse = async (courseId: string) => {
        if (!config) return;
        let enabled = [...config.enabledCourses];
        if (enabled.includes(courseId)) {
            enabled = enabled.filter((id) => id !== courseId);
        } else {
            enabled.push(courseId);
        }
        const newConfig = await window.api.updateConfig({ enabledCourses: enabled });
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
        if (!iso) return 'Mai';
        const date = new Date(iso);
        return date.toLocaleString('it-IT', {
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
        phaseText = `Errore: ${progress?.error ?? 'sincronizzazione non riuscita'}`;
    } else if (!progress) {
        phaseText = 'Connessione a Blackboard';
    } else if (progress.phase === 'scanning') {
        phaseText = progress.total > 0
            ? `Scansione corsi (${progress.current}/${progress.total})`
            : 'Scansione corsi';
    } else if (progress.phase === 'downloading') {
        phaseText = `${progress.currentFile || 'Download in corso'} (${progress.current}/${progress.total})`;
    }

    return (
        <div className="sync-view">
            <Header
                userName={`${user.name.given} ${user.name.family}`}
                lastSync={formatLastSync(config.lastSync)}
                syncing={syncing}
                syncDir={config.syncDir}
                onSync={handleSync}
                onAbort={handleAbortSync}
                onLogout={onLogout}
                onSettings={() => setSettingsOpen(true)}
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

            {syncResult && (
                <SyncResultModal
                    result={syncResult}
                    onClose={() => setSyncResult(null)}
                />
            )}

            {coursesError && !loadingCourses && (
                <div className="error-message" style={{ margin: '0 18px 12px' }}>
                    Impossibile caricare i corsi.{' '}
                    <a href="#" onClick={(e) => { e.preventDefault(); loadCourses(); }}>Riprova</a>
                </div>
            )}

            <CourseList
                courses={courses}
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
            />

            {settingsOpen && (
                <SettingsView
                    config={config}
                    onConfigChange={setConfig}
                    onClose={() => setSettingsOpen(false)}
                />
            )}

            {updateReady && (
                <div className="update-dialog-overlay" onClick={() => setUpdateReady(null)}>
                    <div className="update-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="update-dialog-icon">
                            <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M4.406 1.342A5.53 5.53 0 018 0c2.69 0 4.923 2 5.166 4.579C14.758 4.804 16 6.137 16 7.773 16 9.569 14.502 11 12.687 11H10a.5.5 0 010-1h2.688C13.979 10 15 8.988 15 7.773c0-1.216-1.02-2.228-2.313-2.228h-.5v-.5C12.188 2.825 10.328 1 8 1a4.53 4.53 0 00-2.941 1.1c-.757.652-1.153 1.438-1.153 2.055v.448l-.445.049C2.064 4.805 1 5.952 1 7.318 1 8.785 2.23 10 3.781 10H6a.5.5 0 010 1H3.781C1.708 11 0 9.366 0 7.318c0-1.763 1.266-3.223 2.942-3.593.143-.863.698-1.723 1.464-2.383z" />
                                <path d="M7.646 15.854a.5.5 0 00.708 0l3-3a.5.5 0 00-.708-.708L8.5 14.293V5.5a.5.5 0 00-1 0v8.793l-2.146-2.147a.5.5 0 00-.708.708l3 3z" />
                            </svg>
                        </div>
                        <h3 className="update-dialog-title">Aggiornamento pronto</h3>
                        <p className="update-dialog-text">
                            {updateReady.releaseName
                                ? `La versione ${updateReady.releaseName} è stata scaricata.`
                                : 'Una nuova versione è stata scaricata.'}
                        </p>
                        <p className="update-dialog-subtext">Riavvia l'app per installare l'aggiornamento.</p>
                        <div className="update-dialog-actions">
                            <button className="btn-update-later" onClick={() => setUpdateReady(null)}>Dopo</button>
                            <button className="btn-update-restart" onClick={() => window.api.restartForUpdate()}>Riavvia ora</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SyncView;
