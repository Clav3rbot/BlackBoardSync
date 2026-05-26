// Tauri v2 window.api shim — maps window.api.* to Tauri IPC invokes
// All React components continue to use window.api.* without any changes.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';

type UnlistenFn = () => void;

function onEvent<T>(eventName: string, callback: (payload: T) => void): UnlistenFn {
    let unlisten: UnlistenFn | undefined;
    listen<T>(eventName, (e) => callback(e.payload)).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
}

const api: Window['api'] = {
    login: (username, password) => invoke('login', { username, password }),
    autoLogin: () => invoke('auto_login'),
    logout: () => invoke('logout'),
    getCourses: () => invoke('get_courses'),
    sync: () => invoke('sync'),
    abortSync: () => invoke('abort_sync'),
    getConfig: () => invoke('get_config'),
    updateConfig: (partial) => invoke('update_config', { partial }),
    selectFolder: () => invoke('select_folder'),
    openFolder: (folderPath) => invoke('open_folder', { folderPath }),
    minimize: () => getCurrentWindow().minimize(),
    maximize: async () => {
        const win = getCurrentWindow();
        return (await win.isMaximized()) ? win.unmaximize() : win.maximize();
    },
    close: () => getCurrentWindow().close(),
    resetWindowSize: () => invoke('reset_window_size'),
    getAppVersion: () => getVersion(),
    checkForUpdates: () => invoke('check_for_updates'),
    restartForUpdate: () => invoke('restart_for_update'),

    onSyncProgress: (cb) => onEvent('sync-progress', cb),
    onSyncStart: (cb) => onEvent('sync-start', cb),
    onSyncComplete: (cb) => onEvent('sync-complete', cb),
    onUpdateStatus: (cb) => onEvent('update-status', cb),
    onUpdateDownloadProgress: (cb) => onEvent('update-download-progress', cb),
    onUpdateReady: (cb) => onEvent('update-ready', cb),
};

window.api = api;
