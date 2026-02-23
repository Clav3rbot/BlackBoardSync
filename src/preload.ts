import { contextBridge, ipcRenderer } from 'electron';

const api = {
    login: (username: string, password: string) =>
        ipcRenderer.invoke('login', username, password),
    autoLogin: () => ipcRenderer.invoke('auto-login'),
    logout: () => ipcRenderer.invoke('logout'),
    getCourses: () => ipcRenderer.invoke('get-courses'),
    sync: () => ipcRenderer.invoke('sync'),
    abortSync: () => ipcRenderer.invoke('abort-sync'),
    getConfig: () => ipcRenderer.invoke('get-config'),
    updateConfig: (partial: any) => ipcRenderer.invoke('update-config', partial),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    openFolder: (folderPath: string) => ipcRenderer.invoke('open-folder', folderPath),
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    close: () => ipcRenderer.invoke('window-close'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    restartForUpdate: () => ipcRenderer.invoke('restart-for-update'),
    onSyncProgress: (callback: (progress: any) => void) => {
        const listener = (_event: any, progress: any) => callback(progress);
        ipcRenderer.on('sync-progress', listener);
        return () => {
            ipcRenderer.removeListener('sync-progress', listener);
        };
    },
    onSyncStart: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on('sync-start', listener);
        return () => {
            ipcRenderer.removeListener('sync-start', listener);
        };
    },
    onSyncComplete: (callback: (result: any) => void) => {
        const listener = (_event: any, result: any) => callback(result);
        ipcRenderer.on('sync-complete', listener);
        return () => {
            ipcRenderer.removeListener('sync-complete', listener);
        };
    },
    onUpdateStatus: (callback: (status: { status: string; message: string }) => void) => {
        const listener = (_event: any, status: any) => callback(status);
        ipcRenderer.on('update-status', listener);
        return () => {
            ipcRenderer.removeListener('update-status', listener);
        };
    },
    onUpdateReady: (callback: (info: { releaseName: string }) => void) => {
        const listener = (_event: any, info: any) => callback(info);
        ipcRenderer.on('update-ready', listener);
        return () => {
            ipcRenderer.removeListener('update-ready', listener);
        };
    },
};

contextBridge.exposeInMainWorld('api', api);
