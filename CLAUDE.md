# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BlackBoard Sync is a cross-platform Electron desktop app that synchronizes course files from Blackboard Learn for Università Bocconi. Built with TypeScript, React, and Webpack via Electron Forge.

## Commands

```bash
npm install           # Install dependencies
npm start             # Dev mode (Electron with auto-reload)
npm run lint          # ESLint on src/ (.ts, .tsx)
npm run make          # Build installers (Windows .exe/.zip, macOS .dmg)
npm run package       # Package without signing
npm run publish       # Publish to GitHub Releases (requires GH_TOKEN)
```

There is no test suite — the project has no test runner configured.

## Architecture

### Process Model

The app follows the standard Electron architecture with context isolation:

- **Main process** (`src/index.ts`): Node.js runtime. Owns IPC handlers, BrowserWindow lifecycle, tray, auto-sync scheduler, auto-updater (GitHub API), and platform-specific logic (Squirrel, startup).
- **Preload bridge** (`src/preload.ts`): Exposes `window.api` to the renderer via `contextBridge`. All renderer↔main communication goes through this 21-method API.
- **Renderer** (`src/renderer.tsx` → `src/client/App.tsx`): React SPA. No direct Node access — everything through `window.api`.

### Core Modules (`src/modules/`)

- **`login.ts`** — `LoginManager` class: handles the Bocconi SAML2 SSO flow using a custom `CookieJar`, following up to 25 redirect hops and extracting SAML assertions from HTML form responses.
- **`blackboard.ts`** — `BlackboardAPI` class: wraps axios for the Blackboard REST API (`https://blackboard.unibocconi.it/learn/api/public/v1`). Fetches users, courses (paginated), and content trees recursively. Filters instructor-role memberships.
- **`download.ts`** — `DownloadManager` (extends EventEmitter): orchestrates full sync. Phases: `scanning → downloading → complete | error`. Runs 3 concurrent downloads, skips existing files, supports abort. Emits progress events consumed by the renderer via IPC.
- **`store.ts`** — Config persistence using `userData/config.json`. Credentials encrypted via `Electron.safeStorage` to `userData/credentials.dat`.

### React Components (`src/client/`)

State machine in `App.tsx`: `loading → LoginView | SyncView`. `SyncView` composes `Header` + `CourseList` + `SettingsView` + `SyncResultModal`.

### Build System

Electron Forge with Webpack plugin. Two separate Webpack configs:
- `webpack.main.config.js`: bundles main process, injects `BUILD_COMMIT_HASH`, copies icons.
- `webpack.renderer.config.js`: bundles React renderer.

Post-package hooks in `forge.config.js` strip unused Electron locales and DX compiler DLLs to reduce binary size (~30MB saved).

### IPC Patterns

All renderer → main calls follow: `renderer calls window.api.method()` → preload calls `ipcRenderer.invoke('channel')` → main handles via `ipcMain.handle('channel', handler)`.

Progress events flow in reverse: main emits via `mainWindow.webContents.send('sync-progress', data)`, preload registers via `ipcRenderer.on`, renderer subscribes via `window.api.onSyncProgress(callback)`.

### Memory Optimizations

- Hardware acceleration disabled (saves ~40MB).
- Window object destroyed on minimize-to-tray (saves ~80MB); recreated on tray click.
- Old Squirrel version directories cleaned on startup (Windows).
- Chromium cache cleared on startup.

## TypeScript Notes

- Strict mode enabled.
- Path alias `"*": ["src/*"]` — use absolute imports from `src/`.
- All shared types are in `src/types.d.ts` (global declarations, no import needed).
- `window.api` interface is declared globally in `types.d.ts`.
