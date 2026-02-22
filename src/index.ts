import {
    app,
    BrowserWindow,
    ipcMain,
    dialog,
    shell,
    Tray,
    Menu,
    nativeImage,
    Notification,
    autoUpdater,
} from 'electron';

// Handle Squirrel events (install, update, uninstall shortcuts)
// This must be at the very top before any other code runs
if (require('electron-squirrel-startup')) app.quit();

import * as path from 'path';
import * as fs from 'fs';
import { LoginManager } from './modules/login';
import { BlackboardAPI } from './modules/blackboard';
import { DownloadManager } from './modules/download';
import { AppStore } from './modules/store';
import { SyncProgress, Course, SyncResult } from './types.d';

// GitHub repo for auto-update feed
const GITHUB_RELEASES_URL = 'https://github.com/Clav3rbot/BlackBoardSync/releases/latest/download';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: AppStore;
let bbApi: BlackboardAPI | null = null;
let downloadManager: DownloadManager | null = null;
let autoSyncTimer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null = null;
let sessionCookies: string[] = [];
let isQuitting = false;

function getIconPath(): string {
    // In production (packaged), icons live next to the asar
    // In dev (webpack), CopyPlugin copies them to .webpack/main/static/icons
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'static', 'icons');
    }
    return path.join(__dirname, 'static', 'icons');
}

function getAppIcon(): Electron.NativeImage {
    const iconsDir = getIconPath();
    const icoPath = path.join(iconsDir, 'win', 'icon.ico');
    const pngPath = path.join(iconsDir, 'png', '128x128.png');

    if (process.platform === 'win32') {
        try {
            const icon = nativeImage.createFromPath(icoPath);
            if (!icon.isEmpty()) return icon;
        } catch { /* fallback to png */ }
    }

    try {
        const icon = nativeImage.createFromPath(pngPath);
        if (!icon.isEmpty()) return icon;
    } catch { /* empty fallback */ }

    return nativeImage.createEmpty();
}

function createWindow(): void {
    const icon = getAppIcon();

    mainWindow = new BrowserWindow({
        width: 480,
        height: 780,
        minWidth: 380,
        minHeight: 520,
        resizable: true,
        frame: false,
        icon,
        backgroundColor: '#0d1117',
        webPreferences: {
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

    mainWindow.on('close', (e) => {
        if (!isQuitting && store.getConfig().minimizeToTray && tray) {
            e.preventDefault();
            mainWindow?.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createTray(): void {
    const icon = getAppIcon();

    // Resize for tray (16x16 on Windows)
    const trayIcon = process.platform === 'win32'
        ? icon.resize({ width: 16, height: 16 })
        : icon;

    tray = new Tray(trayIcon);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Apri BlackBoard Sync', click: () => mainWindow?.show() },
        { label: 'Sincronizza ora', click: () => triggerSync() },
        { type: 'separator' },
        {
            label: 'Esci',
            click: () => {
                isQuitting = true;
                tray?.destroy();
                tray = null;
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
        clearInterval(autoSyncTimer as ReturnType<typeof setInterval>);
        clearTimeout(autoSyncTimer as ReturnType<typeof setTimeout>);
        autoSyncTimer = null;
    }

    const config = store.getConfig();
    if (!config.autoSync) return;

    if (config.autoSyncInterval === 0) {
        // Scheduled mode: sync daily at the configured time
        scheduleNextSync(config.autoSyncScheduledTime);
    } else if (config.autoSyncInterval > 0) {
        // Interval mode
        autoSyncTimer = setInterval(() => {
            triggerSync();
        }, config.autoSyncInterval * 60 * 1000);
    }
}

function scheduleNextSync(timeStr: string): void {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const now = new Date();
    const next = new Date();
    next.setHours(hours, minutes, 0, 0);

    // If the scheduled time already passed today, target tomorrow
    if (next.getTime() <= now.getTime()) {
        next.setDate(next.getDate() + 1);
    }

    const delay = next.getTime() - now.getTime();
    autoSyncTimer = setTimeout(() => {
        triggerSync();
        // After triggering, schedule the next one
        scheduleNextSync(timeStr);
    }, delay);
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

        // Show notification if enabled and window is not visible
        if (config.notifications && !mainWindow.isVisible()) {
            const n = new Notification({
                title: 'BlackBoard Sync',
                body: result.totalDownloaded > 0
                    ? `Scaricati ${result.totalDownloaded} file nuovi`
                    : 'Nessun file nuovo trovato',
                icon: getAppIcon(),
            });
            n.on('click', () => mainWindow?.show());
            n.show();
        }
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

        // Handle start-at-login changes
        if ('startAtLogin' in partial) {
            app.setLoginItemSettings({
                openAtLogin: partial.startAtLogin,
                path: app.getPath('exe'),
            });
        }

        // Handle minimize-to-tray changes: create/destroy tray dynamically
        if ('minimizeToTray' in partial) {
            if (partial.minimizeToTray && !tray) {
                createTray();
            } else if (!partial.minimizeToTray && tray) {
                tray.destroy();
                tray = null;
            }
        }

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
        const normalizedPath = path.resolve(folderPath);
        const syncDir = path.resolve(store.getConfig().syncDir);
        if (!normalizedPath.startsWith(syncDir)) return;
        const fs = await import('fs');
        if (!fs.existsSync(normalizedPath)) {
            fs.mkdirSync(normalizedPath, { recursive: true });
        }
        shell.openPath(normalizedPath);
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
    ipcMain.handle('get-app-version', () => app.getVersion());
    ipcMain.handle('check-for-updates', () => {
        try {
            autoUpdater.checkForUpdates();
        } catch (e) {
            mainWindow?.webContents.send('update-status', {
                status: 'error',
                message: 'Impossibile controllare gli aggiornamenti',
            });
        }
    });
    ipcMain.handle('restart-for-update', () => {
        // Force quit even if minimize-to-tray is enabled
        isQuitting = true;
        if (tray) {
            tray.destroy();
            tray = null;
        }
        autoUpdater.quitAndInstall();
    });
}

/**
 * Clean up old Squirrel.Windows version folders.
 * Squirrel keeps previous app-x.y.z directories under %LOCALAPPDATA%\BlackBoardSync.
 * After an update, we remove all but the currently running version to save disk space.
 */
function cleanupOldVersions() {
    if (process.platform !== 'win32' || !app.isPackaged) return;

    try {
        const appDir = path.dirname(path.dirname(app.getPath('exe'))); // up from app-x.y.z
        const currentVersion = app.getVersion();
        const currentFolder = `app-${currentVersion}`;

        const entries = fs.readdirSync(appDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (!entry.name.startsWith('app-')) continue;
            if (entry.name === currentFolder) continue;

            const oldPath = path.join(appDir, entry.name);
            try {
                fs.rmSync(oldPath, { recursive: true, force: true });
                console.log(`Cleaned up old version: ${entry.name}`);
            } catch {
                // May be locked, ignore
            }
        }

        // Also clean up old nupkg files (staging)
        const packagesDir = path.join(appDir, 'packages');
        if (fs.existsSync(packagesDir)) {
            const pkgs = fs.readdirSync(packagesDir);
            for (const pkg of pkgs) {
                if (pkg.endsWith('.nupkg') && !pkg.includes(currentVersion)) {
                    try {
                        fs.unlinkSync(path.join(packagesDir, pkg));
                        console.log(`Cleaned up old package: ${pkg}`);
                    } catch {}
                }
            }
        }
    } catch (err) {
        console.error('Cleanup old versions failed:', err);
    }
}

function setupAutoUpdate() {
    // Set feed URL directly to GitHub Releases (Squirrel.Windows)
    // Squirrel appends /RELEASES?id=...&localVersion=...&arch=... to this URL
    try {
        autoUpdater.setFeedURL({ url: GITHUB_RELEASES_URL });
    } catch {
        // Not available in dev mode
        return;
    }

    // Event listeners for update status feedback
    autoUpdater.on('checking-for-update', () => {
        mainWindow?.webContents.send('update-status', {
            status: 'checking',
            message: 'Controllo aggiornamenti...',
        });
    });

    autoUpdater.on('update-available', () => {
        mainWindow?.webContents.send('update-status', {
            status: 'available',
            message: 'Aggiornamento disponibile! Download in corso...',
        });
    });

    autoUpdater.on('update-not-available', () => {
        mainWindow?.webContents.send('update-status', {
            status: 'not-available',
            message: 'Nessun aggiornamento disponibile',
        });
    });

    autoUpdater.on('update-downloaded', (_event, releaseNotes, releaseName) => {
        mainWindow?.webContents.send('update-status', {
            status: 'downloaded',
            message: 'Aggiornamento scaricato. Riavvia per installare.',
        });

        // Send event to renderer for in-app update dialog
        mainWindow?.webContents.send('update-ready', {
            releaseName: releaseName || '',
        });
    });

    autoUpdater.on('error', (err) => {
        mainWindow?.webContents.send('update-status', {
            status: 'error',
            message: `Errore aggiornamento: ${err?.message || 'sconosciuto'}`,
        });
    });

    // Initial check after 10 seconds
    setTimeout(() => {
        try { autoUpdater.checkForUpdates(); } catch {}
    }, 10_000);

    // Check every 4 hours
    setInterval(() => {
        try { autoUpdater.checkForUpdates(); } catch {}
    }, 4 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
    store = new AppStore();
    cleanupOldVersions();
    createWindow();
    if (store.getConfig().minimizeToTray) {
        createTray();
    }
    setupIPC();
    setupAutoSync();
    setupAutoUpdate();

    // Sync start-at-login setting on launch
    const config = store.getConfig();
    app.setLoginItemSettings({
        openAtLogin: config.startAtLogin,
        path: app.getPath('exe'),
    });
});

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return;
    // If tray exists and minimize-to-tray is on, keep running; otherwise quit
    if (store?.getConfig().minimizeToTray && tray) return;
    if (tray) {
        tray.destroy();
        tray = null;
    }
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
