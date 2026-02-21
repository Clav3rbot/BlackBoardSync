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
    onSyncProgress: (callback: (progress: any) => void) => {
        const listener = (_event: any, progress: any) => callback(progress);
        ipcRenderer.on('sync-progress', listener);
        return () => {
            ipcRenderer.removeListener('sync-progress', listener);
        };
    },
    onSyncComplete: (callback: (result: any) => void) => {
        const listener = (_event: any, result: any) => callback(result);
        ipcRenderer.on('sync-complete', listener);
        return () => {
            ipcRenderer.removeListener('sync-complete', listener);
        };
    },
};

contextBridge.exposeInMainWorld('api', api);
