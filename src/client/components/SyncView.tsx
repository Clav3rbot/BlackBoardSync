import React, { useState, useEffect } from 'react';
import Header from './Header';
import CourseList from './CourseList';
import SyncResultModal from './SyncResultModal';

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
    enabledCourses: string[];
    courseAliases: Record<string, string>;
    lastSync: string | null;
    minimizeToTray: boolean;
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

        return () => {
            unsubProgress();
            unsubComplete();
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

    const handleSelectFolder = async () => {
        const folder = await window.api.selectFolder();
        if (folder) {
            const newConfig = await window.api.updateConfig({ syncDir: folder });
            setConfig(newConfig);
        }
    };

    const handleOpenFolder = () => {
        if (config?.syncDir) {
            window.api.openFolder(config.syncDir);
        }
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

    const handleToggleAutoSync = async () => {
        if (!config) return;
        const newConfig = await window.api.updateConfig({ autoSync: !config.autoSync });
        setConfig(newConfig);
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
                onSync={handleSync}
                onAbort={handleAbortSync}
                onLogout={onLogout}
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

            <div className="section folder-section">
                <div className="section-header">
                    <span className="section-label">Cartella di sincronizzazione</span>
                </div>
                <div className="folder-row">
                    <span className="folder-path" title={config.syncDir}>
                        {config.syncDir}
                    </span>
                    <div className="folder-actions">
                        <button
                            className="btn-icon"
                            onClick={handleOpenFolder}
                            title="Apri cartella"
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M1.5 2A1.5 1.5 0 000 3.5v9A1.5 1.5 0 001.5 14h13a1.5 1.5 0 001.5-1.5V5a1.5 1.5 0 00-1.5-1.5H7.707l-1.854-1.854A.5.5 0 005.5 1.5H1.5z" />
                            </svg>
                        </button>
                        <button
                            className="btn-icon"
                            onClick={handleSelectFolder}
                            title="Cambia cartella"
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M12.146.146a.5.5 0 01.708 0l3 3a.5.5 0 010 .708l-10 10a.5.5 0 01-.168.11l-5 2a.5.5 0 01-.65-.65l2-5a.5.5 0 01.11-.168l10-10zM11.207 2.5L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.293l6.5-6.5z" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            <div className="section auto-sync-section">
                <div className="toggle-row" onClick={handleToggleAutoSync}>
                    <span className="toggle-label">Sincronizzazione automatica</span>
                    <div className={`toggle ${config.autoSync ? 'active' : ''}`}>
                        <div className="toggle-thumb" />
                    </div>
                </div>
                {config.autoSync && (
                    <span className="auto-sync-info">
                        Ogni {config.autoSyncInterval} minuti
                    </span>
                )}
            </div>

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
                loading={loadingCourses}
                onToggle={handleToggleCourse}
                onRename={handleRenameCourse}
            />
        </div>
    );
};

export default SyncView;
