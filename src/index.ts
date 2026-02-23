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
    net,
} from 'electron';

// Handle Squirrel events (install, update, uninstall shortcuts)
// This must be at the very top before any other code runs
if (require('electron-squirrel-startup')) app.quit();

// Enforce single instance — if another instance is already running, quit immediately
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    process.exit(0);
} else {
    app.on('second-instance', () => {
        // When a second instance is launched, focus the existing window
        if (mainWindow) {
            if (!mainWindow.isVisible()) mainWindow.show();
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

import * as path from 'path';
import * as fs from 'fs';
import { LoginManager } from './modules/login';
import { BlackboardAPI } from './modules/blackboard';
import { DownloadManager } from './modules/download';
import { AppStore } from './modules/store';
import { SyncProgress, Course, SyncResult } from './types.d';

// GitHub API endpoint for latest release
const GITHUB_API_LATEST = 'https://api.github.com/repos/Clav3rbot/BlackBoardSync/releases/latest';
let pendingSetupPath: string | null = null;

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const BUILD_COMMIT_HASH: string;

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

function wasLaunchedAtLogin(): boolean {
    return process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;
}

function createWindow(): void {
    const icon = getAppIcon();
    const startHidden = wasLaunchedAtLogin();

    mainWindow = new BrowserWindow({
        width: 480,
        height: 780,
        minWidth: 380,
        minHeight: 520,
        resizable: true,
        frame: false,
        show: false,
        icon,
        backgroundColor: '#0d1117',
        webPreferences: {
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

    // Show window only once content is fully loaded — avoids flash of Electron default page
    mainWindow.once('ready-to-show', () => {
        if (!startHidden) {
            mainWindow?.show();
        }
    });

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

    // Notify renderer that sync has started (e.g. from tray)
    mainWindow.webContents.send('sync-start');

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
                args: ['--hidden'],
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
    ipcMain.handle('restart-for-update', () => {
        if (!pendingSetupPath || !fs.existsSync(pendingSetupPath)) return;
        // Launch the downloaded installer and quit
        const { spawn } = require('child_process');
        spawn(pendingSetupPath, [], { detached: true, stdio: 'ignore' }).unref();
        isQuitting = true;
        if (tray) { tray.destroy(); tray = null; }
        app.quit();
    });
}

/**
 * Clean up Chromium cache folders in userData (Roaming AppData).
 * These grow over time and are safe to delete — Chromium recreates them as needed.
 */
function cleanupChromiumCaches() {
    const userDataPath = app.getPath('userData');
    const cacheDirs = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Shared Dictionary'];

    for (const dir of cacheDirs) {
        const dirPath = path.join(userDataPath, dir);
        try {
            if (fs.existsSync(dirPath)) {
                fs.rmSync(dirPath, { recursive: true, force: true });
                console.log(`Cleaned cache: ${dir}`);
            }
        } catch {
            // May be locked on first run, ignore
        }
    }
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

/**
 * Compare two semver strings. Returns true if remote > local.
 */
function isNewerVersion(remote: string, local: string): boolean {
    const r = remote.replace(/^v/, '').split('.').map(Number);
    const l = local.split('.').map(Number);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
        const rv = r[i] || 0;
        const lv = l[i] || 0;
        if (rv > lv) return true;
        if (rv < lv) return false;
    }
    return false;
}

/**
 * Custom auto-update using GitHub API.
 * Checks for newer releases, downloads the Setup .exe, and prompts user to restart.
 */
function setupAutoUpdate() {
    if (!app.isPackaged) return;

    async function checkForUpdates() {
        mainWindow?.webContents.send('update-status', {
            status: 'checking',
            message: 'Controllo aggiornamenti...',
        });

        try {
            // Fetch latest release info from GitHub API
            const response = await net.fetch(GITHUB_API_LATEST, {
                headers: { 'User-Agent': 'BlackBoardSync' },
            });
            if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);

            const release = await response.json() as {
                tag_name: string;
                assets: { name: string; browser_download_url: string }[];
            };

            const remoteVersion = release.tag_name.replace(/^v/, '');
            const localVersion = app.getVersion();

            // Compare versions first
            const newerVersion = isNewerVersion(remoteVersion, localVersion);

            // If same version, compare commit hashes via the Git tag API
            let sameVersionNewBuild = false;
            if (!newerVersion && remoteVersion === localVersion) {
                const localCommit = typeof BUILD_COMMIT_HASH !== 'undefined' ? BUILD_COMMIT_HASH : '';
                if (localCommit) {
                    try {
                        const tagRef = await net.fetch(
                            `https://api.github.com/repos/Clav3rbot/BlackBoardSync/git/ref/tags/${release.tag_name}`,
                            { headers: { 'User-Agent': 'BlackBoardSync' } },
                        );
                        if (tagRef.ok) {
                            const refData = await tagRef.json() as { object: { sha: string; type: string; url: string } };
                            let remoteCommit = refData.object.sha;

                            // If the tag points to a tag object (annotated tag), resolve to the commit
                            if (refData.object.type === 'tag') {
                                const tagObj = await net.fetch(refData.object.url, {
                                    headers: { 'User-Agent': 'BlackBoardSync' },
                                });
                                if (tagObj.ok) {
                                    const tagData = await tagObj.json() as { object: { sha: string } };
                                    remoteCommit = tagData.object.sha;
                                }
                            }

                            sameVersionNewBuild = remoteCommit !== localCommit;
                        }
                    } catch {
                        // If we can't resolve the tag, skip hash comparison
                    }
                }
            }

            if (!newerVersion && !sameVersionNewBuild) {
                mainWindow?.webContents.send('update-status', {
                    status: 'not-available',
                    message: 'Nessun aggiornamento disponibile',
                });
                return;
            }

            // Find the Setup .exe asset
            const setupAsset = release.assets.find(a => a.name.endsWith('.exe'));
            if (!setupAsset) {
                mainWindow?.webContents.send('update-status', {
                    status: 'error',
                    message: 'Installer non trovato nella release',
                });
                return;
            }

            mainWindow?.webContents.send('update-status', {
                status: 'available',
                message: `Aggiornamento v${remoteVersion} disponibile! Download in corso...`,
            });

            // Download the Setup .exe to temp with progress tracking
            const tmpDir = app.getPath('temp');
            const setupPath = path.join(tmpDir, setupAsset.name);
            const dlResponse = await net.fetch(setupAsset.browser_download_url);
            if (!dlResponse.ok) throw new Error(`Download failed: ${dlResponse.status}`);

            const contentLength = parseInt(dlResponse.headers.get('content-length') || '0', 10);
            const reader = dlResponse.body?.getReader();
            if (!reader) throw new Error('No response body');

            const chunks: Uint8Array[] = [];
            let received = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                received += value.length;

                if (contentLength > 0) {
                    const percent = Math.round((received / contentLength) * 100);
                    mainWindow?.webContents.send('update-download-progress', {
                        percent,
                        received,
                        total: contentLength,
                    });
                }
            }

            const buffer = Buffer.concat(chunks);
            fs.writeFileSync(setupPath, buffer);

            pendingSetupPath = setupPath;

            mainWindow?.webContents.send('update-status', {
                status: 'downloaded',
                message: 'Aggiornamento scaricato. Riavvia per installare.',
            });

            mainWindow?.webContents.send('update-ready', {
                releaseName: `v${remoteVersion}`,
            });
        } catch (err: any) {
            mainWindow?.webContents.send('update-status', {
                status: 'error',
                message: `Errore aggiornamento: ${err?.message || 'sconosciuto'}`,
            });
        }
    }

    // Initial check after 10 seconds
    setTimeout(() => checkForUpdates(), 10_000);

    // Check every 4 hours
    setInterval(() => checkForUpdates(), 4 * 60 * 60 * 1000);

    // Manual check from renderer
    ipcMain.removeHandler('check-for-updates');
    ipcMain.handle('check-for-updates', () => checkForUpdates());
}

app.whenReady().then(() => {
    store = new AppStore();
    cleanupOldVersions();
    cleanupChromiumCaches();
    createWindow();

    // Always create tray when minimize-to-tray is on, or when launched hidden
    if (store.getConfig().minimizeToTray || wasLaunchedAtLogin()) {
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
        args: ['--hidden'],
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
