export {};

declare module '*.png' {
    const src: string;
    export default src;
}

export interface UserInfo {
    id: string;
    userName: string;
    name: { given: string; family: string };
}

export interface Course {
    id: string;
    courseId: string;
    name: string;
    term?: { id: string; name: string };
    instructor?: string;
}

export interface ContentItem {
    id: string;
    title: string;
    contentHandler?: { id: string };
    hasChildren?: boolean;
    body?: string;
}

export interface Attachment {
    id: string;
    fileName: string;
    mimeType: string;
}

export interface AppConfig {
    syncDir: string;
    autoSync: boolean;
    autoSyncInterval: number;
    enabledCourses: string[];
    courseAliases: Record<string, string>;
    lastSync: string | null;
    minimizeToTray: boolean;
}

export interface SyncProgress {
    phase: 'scanning' | 'downloading' | 'complete' | 'error';
    current: number;
    total: number;
    currentFile?: string;
    error?: string;
}

export interface SyncResultCourse {
    courseName: string;
    files: string[];
}

export interface SyncResult {
    totalDownloaded: number;
    totalScanned: number;
    courses: SyncResultCourse[];
    duration: number; // seconds
}

export interface LoginResult {
    success: boolean;
    cookies: string[];
    error?: string;
}

export interface ApiResult<T = any> {
    success: boolean;
    error?: string;
    user?: UserInfo;
    courses?: Course[];
    data?: T;
}

declare global {
    interface Window {
        api: {
            login: (username: string, password: string) => Promise<ApiResult>;
            autoLogin: () => Promise<ApiResult>;
            logout: () => Promise<ApiResult>;
            getCourses: () => Promise<ApiResult>;
            sync: () => Promise<ApiResult>;
            abortSync: () => Promise<ApiResult>;
            getConfig: () => Promise<AppConfig>;
            updateConfig: (partial: Partial<AppConfig>) => Promise<AppConfig>;
            selectFolder: () => Promise<string | null>;
            openFolder: (folderPath: string) => Promise<void>;
            minimize: () => Promise<void>;
            maximize: () => Promise<void>;
            close: () => Promise<void>;
            onSyncProgress: (callback: (progress: SyncProgress) => void) => () => void;
            onSyncComplete: (callback: (result: SyncResult) => void) => () => void;
        };
    }
}
