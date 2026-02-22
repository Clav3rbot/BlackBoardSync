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
        </div>
    );
};

export default SyncView;
