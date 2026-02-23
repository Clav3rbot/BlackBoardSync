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
    lastSync: string | null;
    minimizeToTray: boolean;
    startAtLogin: boolean;
    notifications: boolean;
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
    const [updateReady, setUpdateReady] = useState<{ releaseName: string } | null>(null);

    useEffect(() => {
        loadData();

        const unsubProgress = window.api.onSyncProgress((p: SyncProgress) => {
            setProgress(p);
            if (p.phase === 'complete') {
                setSyncing(false);
                loadConfig();
            } else if (p.phase === 'error') {
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

    const loadData = async () => {
        await Promise.all([loadCourses(), loadConfig()]);
    };

    const loadCourses = async () => {
        setLoadingCourses(true);
        try {
            const result = await window.api.getCourses();
            if (result.success && result.courses) {
                setCourses(result.courses);
            }
        } catch (err) {
            console.error('Failed to load courses:', err);
        } finally {
            setLoadingCourses(false);
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
        setProgress(null);
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

            {syncing && progress && (
                <div className="sync-progress">
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{
                                width:
                                    progress.total > 0
                                        ? `${(progress.current / progress.total) * 100}%`
                                        : '0%',
                            }}
                        />
                    </div>
                    <p className="progress-text">
                        {progress.phase === 'scanning' &&
                            `Scansione corsi... (${progress.current}/${progress.total})`}
                        {progress.phase === 'downloading' &&
                            `Download: ${progress.currentFile} (${progress.current}/${progress.total})`}
                        {progress.phase === 'error' && `Errore: ${progress.error}`}
                    </p>
                </div>
            )}

            {syncResult && (
                <SyncResultModal
                    result={syncResult}
                    onClose={() => setSyncResult(null)}
                />
            )}

            <CourseList
                courses={courses}
                enabledCourses={config.enabledCourses}
                courseAliases={config.courseAliases}
                collapsedTerms={config.collapsedTerms || []}
                loading={loadingCourses}
                onToggle={handleToggleCourse}
                onRename={handleRenameCourse}
                onCollapsedTermsChange={handleCollapsedTermsChange}
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
