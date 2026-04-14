// Stub di window.api per il dev-server browser (no Electron)
// Modifica i dati qui sotto per vedere stati diversi dell'UI.

import type { AppConfig, SyncProgress, SyncResult } from '../types';

const noop = () => () => {};

const MOCK_CONFIG: AppConfig = {
    syncDir: 'C:\\Utenti\\Studente\\Documenti\\Blackboard',
    autoSync: true,
    autoSyncInterval: 60,
    autoSyncScheduledTime: '00:00',
    enabledCourses: [],
    courseAliases: { '_course3': 'Corporate Finance (Rinominato)' },
    collapsedTerms: [],
    hiddenCourses: ['_course5'],
    hiddenTerms: ['_term3'],
    lastSync: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    minimizeToTray: true,
    startAtLogin: false,
    notifications: true,
    syncOnStartup: false,
};

const MOCK_COURSES = [
    { id: '_course1', courseId: 'BECO30001', name: 'Macroeconomics', instructor: 'Prof. Rossi', term: { id: '_term1', name: '2025/2026 FIRST SEMESTER' } },
    { id: '_course2', courseId: 'BFIN20002', name: 'Financial Accounting', instructor: 'Prof. Bianchi', term: { id: '_term1', name: '2025/2026 FIRST SEMESTER' } },
    { id: '_course3', courseId: 'BFIN30003', name: 'Corporate Finance', instructor: 'Prof. Verdi', term: { id: '_term1', name: '2025/2026 FIRST SEMESTER' } },
    { id: '_course4', courseId: 'BECO20004', name: 'Microeconomics', instructor: 'Prof. Neri', term: { id: '_term2', name: '2025/2026 SECOND SEMESTER' } },
    { id: '_course5', courseId: 'BMAT10005', name: 'Mathematics (nascosto)', instructor: 'Prof. Blu', term: { id: '_term2', name: '2025/2026 SECOND SEMESTER' } },
    { id: '_course6', courseId: 'BSTA10006', name: 'Statistics', instructor: 'Prof. Gialli', term: { id: '_term2', name: '2025/2026 SECOND SEMESTER' } },
    { id: '_course7', courseId: 'BEXT10007', name: 'Leadership Workshop', term: { id: '_term3', name: 'EXTRACURRICULAR COURSES' } },
    { id: '_course8', courseId: 'BEXT10008', name: 'Career Development', term: { id: '_term3', name: 'EXTRACURRICULAR COURSES' } },
    { id: '_course9', courseId: 'BONE10009', name: 'Online Exam Resources', term: { id: '_term4', name: 'ONLINE EXAMS' } },
];

let config = { ...MOCK_CONFIG };

window.api = {
    login: async () => ({ success: true, user: { id: '1', userName: 'mario.rossi', name: { given: 'Mario', family: 'Rossi' } } }),
    autoLogin: async () => ({ success: true, user: { id: '1', userName: 'mario.rossi', name: { given: 'Mario', family: 'Rossi' } } }),
    logout: async () => ({ success: true }),
    getCourses: async () => ({ success: true, courses: MOCK_COURSES }),
    sync: async () => ({ success: true }),
    abortSync: async () => ({ success: true }),
    getConfig: async () => ({ ...config }),
    updateConfig: async (partial) => { config = { ...config, ...partial }; return { ...config }; },
    selectFolder: async () => 'C:\\Utenti\\Studente\\Documenti\\Blackboard',
    openFolder: async () => {},
    minimize: async () => {},
    maximize: async () => {},
    close: async () => {},
    getAppVersion: async () => '1.0.4',
    checkForUpdates: async () => {},
    restartForUpdate: async () => {},
    onSyncProgress: noop as any,
    onSyncStart: noop as any,
    onSyncComplete: noop as any,
    onUpdateStatus: noop as any,
    onUpdateDownloadProgress: noop as any,
    onUpdateReady: noop as any,
};
