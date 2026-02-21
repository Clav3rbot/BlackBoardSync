import * as fs from 'fs';
import * as path from 'path';
import { app, safeStorage } from 'electron';
import { AppConfig } from '../types.d';

const DEFAULT_CONFIG: AppConfig = {
    syncDir: '',
    autoSync: false,
    autoSyncInterval: 30,
    enabledCourses: [],
    courseAliases: {},
    lastSync: null,
    minimizeToTray: true,
};

export class AppStore {
    private configPath: string;
    private credentialsPath: string;
    private config: AppConfig;

    constructor() {
        const userDataPath = app.getPath('userData');
        this.configPath = path.join(userDataPath, 'config.json');
        this.credentialsPath = path.join(userDataPath, 'credentials.dat');

        // Set default syncDir after app paths are available
        DEFAULT_CONFIG.syncDir = path.join(app.getPath('documents'), 'BlackBoard Sync');
        this.config = this.loadConfig();
    }

    private loadConfig(): AppConfig {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf-8');
                return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
            }
        } catch (err) {
            console.error('Failed to load config:', err);
        }
        return { ...DEFAULT_CONFIG };
    }

    private saveConfig(): void {
        try {
            const dir = path.dirname(this.configPath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (err) {
            console.error('Failed to save config:', err);
        }
    }

    getConfig(): AppConfig {
        return { ...this.config };
    }

    updateConfig(partial: Partial<AppConfig>): AppConfig {
        this.config = { ...this.config, ...partial };
        this.saveConfig();
        return this.getConfig();
    }

    saveCredentials(username: string, password: string): void {
        try {
            if (safeStorage.isEncryptionAvailable()) {
                const data = JSON.stringify({ username, password });
                const encrypted = safeStorage.encryptString(data);
                fs.writeFileSync(this.credentialsPath, encrypted);
            }
        } catch (err) {
            console.error('Failed to save credentials:', err);
        }
    }

    loadCredentials(): { username: string; password: string } | null {
        try {
            if (fs.existsSync(this.credentialsPath) && safeStorage.isEncryptionAvailable()) {
                const encrypted = fs.readFileSync(this.credentialsPath);
                const decrypted = safeStorage.decryptString(encrypted);
                return JSON.parse(decrypted);
            }
        } catch (err) {
            console.error('Failed to load credentials:', err);
        }
        return null;
    }

    clearCredentials(): void {
        try {
            if (fs.existsSync(this.credentialsPath)) {
                fs.unlinkSync(this.credentialsPath);
            }
        } catch (err) {
            console.error('Failed to clear credentials:', err);
        }
    }
}
