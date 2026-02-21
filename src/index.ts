import {
    app,
    BrowserWindow,
    ipcMain,
    dialog,
    shell,
    Tray,
    Menu,
    nativeImage,
} from 'electron';
import * as path from 'path';
import { LoginManager } from './modules/login';
import { BlackboardAPI } from './modules/blackboard';
import { DownloadManager } from './modules/download';
import { AppStore } from './modules/store';
import { SyncProgress, Course, SyncResult } from './types.d';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: AppStore;
let bbApi: BlackboardAPI | null = null;
let downloadManager: DownloadManager | null = null;
let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
let sessionCookies: string[] = [];

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 440,
        height: 680,
        minWidth: 380,
        minHeight: 520,
        resizable: true,
        frame: false,
        backgroundColor: '#0d1117',
        webPreferences: {
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

    mainWindow.on('close', (e) => {
        if (store.getConfig().minimizeToTray && tray) {
            e.preventDefault();
            mainWindow?.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createTray(): void {
    const icon = nativeImage.createFromBuffer(
        Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAADklEQVQ4jWNgGAWDEwAAAhAAARqr7OAAAAAASUVORK5CYII=',
            'base64'
        )
    );

    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Apri BlackBoard Sync', click: () => mainWindow?.show() },
        { label: 'Sincronizza ora', click: () => triggerSync() },
        { type: 'separator' },
        {
            label: 'Esci',
            click: () => {
                tray?.destroy();
                app.quit();
            },
        },
    ]);

    tray.setToolTip('BlackBoard Sync');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => mainWindow?.show());
}

function setupAutoSync(): void {
    if (autoSyncTimer) {
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
    }

    const config = store.getConfig();
    if (config.autoSync && config.autoSyncInterval > 0) {
        autoSyncTimer = setInterval(() => {
            triggerSync();
        }, config.autoSyncInterval * 60 * 1000);
    }
}

async function triggerSync(): Promise<void> {
    if (!bbApi || !mainWindow) return;

    try {
        const config = store.getConfig();
        const user = await bbApi.getCurrentUser();
        const allCourses = await bbApi.getCourses(user.id);

        let courses: Course[];
        if (config.enabledCourses.length > 0) {
            courses = allCourses.filter((c) => config.enabledCourses.includes(c.id));
        } else {
            courses = allCourses;
        }

        downloadManager = new DownloadManager(bbApi, config.syncDir, config.courseAliases);
        downloadManager.on('progress', (progress: SyncProgress) => {
            mainWindow?.webContents.send('sync-progress', progress);
        });

        const result: SyncResult = await downloadManager.syncAll(courses);

        store.updateConfig({ lastSync: new Date().toISOString() });
        mainWindow.webContents.send('sync-complete', result);
    } catch (err: any) {
        mainWindow.webContents.send('sync-progress', {
            phase: 'error',
            current: 0,
            total: 0,
            error: err.message,
        } as SyncProgress);
    }
}

function setupIPC(): void {
    ipcMain.handle('login', async (_event, username: string, password: string) => {
        const loginManager = new LoginManager();
        const result = await loginManager.login(username, password);

        if (result.success) {
            sessionCookies = result.cookies;
            bbApi = new BlackboardAPI(sessionCookies);
            store.saveCredentials(username, password);

            try {
                const user = await bbApi.getCurrentUser();
                return { success: true, user };
            } catch {
                return {
                    success: false,
                    error: 'Login riuscito ma impossibile ottenere il profilo utente.',
                };
            }
        }

        return { success: result.success, error: result.error };
    });

    ipcMain.handle('auto-login', async () => {
        const creds = store.loadCredentials();
        if (!creds) return { success: false, error: 'no-credentials' };

        const loginManager = new LoginManager();
        const result = await loginManager.login(creds.username, creds.password);

        if (result.success) {
            sessionCookies = result.cookies;
            bbApi = new BlackboardAPI(sessionCookies);

            try {
                const user = await bbApi.getCurrentUser();
                return { success: true, user };
            } catch {
                return { success: false, error: 'Sessione scaduta' };
            }
        }

        return { success: result.success, error: result.error };
    });

    ipcMain.handle('logout', async () => {
        store.clearCredentials();
        bbApi = null;
        sessionCookies = [];
        return { success: true };
    });

    ipcMain.handle('get-courses', async () => {
        if (!bbApi) return { success: false, error: 'Non autenticato' };

        try {
            const user = await bbApi.getCurrentUser();
            const courses = await bbApi.getCourses(user.id);
            return { success: true, courses };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('sync', async () => {
        await triggerSync();
        return { success: true };
    });

    ipcMain.handle('abort-sync', async () => {
        downloadManager?.abort();
        return { success: true };
    });

    ipcMain.handle('get-config', () => {
        return store.getConfig();
    });

    ipcMain.handle('update-config', (_event, partial: any) => {
        const config = store.updateConfig(partial);
        setupAutoSync();
        return config;
    });

    ipcMain.handle('select-folder', async () => {
        if (!mainWindow) return null;
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            title: 'Seleziona cartella di sincronizzazione',
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
    });

    ipcMain.handle('open-folder', async (_event, folderPath: string) => {
        const fs = await import('fs');
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }
        shell.openPath(folderPath);
    });

    ipcMain.handle('window-minimize', () => mainWindow?.minimize());
    ipcMain.handle('window-maximize', () => {
        if (mainWindow?.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow?.maximize();
        }
    });
    ipcMain.handle('window-close', () => mainWindow?.close());
}

app.whenReady().then(() => {
    store = new AppStore();
    createWindow();
    createTray();
    setupIPC();
    setupAutoSync();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
