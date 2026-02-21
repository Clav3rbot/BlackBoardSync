# BlackBoard Sync

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/electron-28-47848F?style=flat-square&logo=electron" />
  <img src="https://img.shields.io/badge/typescript-5.3-3178C6?style=flat-square&logo=typescript" />
  <img src="https://img.shields.io/badge/license-GPL--3.0-green?style=flat-square" />
</p>

App desktop per sincronizzare automaticamente i file dei corsi dalla piattaforma Blackboard dell'**Università Bocconi** direttamente sul tuo computer.

---

## Funzionalità

- **Login SSO Bocconi** — autenticazione SAML2 tramite Shibboleth IDP, le credenziali vengono salvate in modo sicuro con `safeStorage` di Electron
- **Sincronizzazione file** — scansiona tutti i corsi e scarica automaticamente gli allegati mancanti con controllo della concorrenza
- **Nomi docenti** — mostra i professori e i direttori di corso accanto a ogni insegnamento
- **Filtro per semestre** — filtra i corsi per semestre con pill selezionabili
- **Rinomina corsi** — assegna alias personalizzati alle cartelle dei corsi
- **Selezione corsi** — scegli quali corsi sincronizzare
- **Sincronizzazione automatica** — intervallo configurabile (default: 30 minuti)
- **Riepilogo sync** — modale con dettaglio dei file scaricati per ogni corso
- **Portabile** — nessuna installazione richiesta, basta estrarre lo zip

## Screenshot

<p align="center">
  <i>Login → Sync → Corsi</i>
</p>

## Installazione

1. Scarica l'ultima release dalla pagina [Releases](../../releases)
2. Estrai lo zip in una cartella qualsiasi
3. Avvia `BlackBoard Sync.exe`

> **Nota:** Windows potrebbe mostrare un avviso SmartScreen al primo avvio. Clicca su "Ulteriori informazioni" → "Esegui comunque".

## Sviluppo

### Prerequisiti

- [Node.js](https://nodejs.org/) 18+
- npm 9+

### Setup

```bash
git clone https://github.com/Clav3rbot/BlackBoardSync.git
cd BlackBoardSync
npm install
```

### Comandi

| Comando | Descrizione |
|---------|-------------|
| `npm start` | Avvia l'app in modalità sviluppo |
| `npm run make` | Crea il pacchetto distribuibile (.zip) |

### Struttura progetto

```
src/
├── index.ts                    # Main process (Electron)
├── preload.ts                  # Context bridge (IPC)
├── renderer.tsx                # Entry point renderer
├── types.d.ts                  # Tipi TypeScript condivisi
├── index.html                  # HTML template
├── client/
│   ├── App.tsx                 # Root component
│   └── components/
│       ├── LoginView.tsx       # Schermata di login
│       ├── SyncView.tsx        # Schermata principale
│       ├── Header.tsx          # Header con avatar e sync
│       ├── CourseList.tsx       # Lista corsi con filtri
│       └── SyncResultModal.tsx # Modale risultato sync
├── modules/
│   ├── blackboard.ts           # Client API Blackboard REST
│   ├── download.ts             # Download manager con concorrenza
│   ├── login.ts                # Flusso SSO SAML2 Bocconi
│   └── store.ts                # Persistenza configurazione
└── styles/
    └── main.scss               # Stili (dark theme, glassmorphism)
```

## Stack tecnologico

- **Electron 28** + Electron Forge 7
- **TypeScript 5.3**
- **React 18** — UI dichiarativa
- **SCSS** — dark theme con glassmorphism e gradient
- **Webpack** — bundling
- **axios** — chiamate HTTP
- **cheerio** — parsing HTML per il flusso SAML

## Licenza

[GPL-3.0](LICENSE)
