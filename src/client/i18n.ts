export interface TranslationKeys {
    // General / Common
    appName: string;
    loading: string;
    connecting: string;
    offline: string;
    offlineHint: string;
    logout: string;
    settings: string;
    openFolder: string;
    changeFolder: string;
    lastSync: string;
    never: string;
    close: string;
    reset: string;
    error: string;
    retry: string;

    // Login View
    loginTitle: string;
    loginSubtitle: string;
    usernameLabel: string;
    passwordLabel: string;
    usernamePlaceholder: string;
    passwordPlaceholder: string;
    loginButton: string;
    loggingIn: string;
    bocconiLabel: string;
    polimiLabel: string;
    webeepConnect: string;
    webeepConnecting: string;
    webeepDisconnect: string;
    accountsTitle: string;
    accountNotConnected: string;
    coursesLoadError: string;
    loginError: string;
    maxLenError: string;
    emptyFieldsError: string;
    loginFooterCredentials: string;
    loginFooterDisclaimer1: string;
    loginFooterDisclaimer2: string;
    loginFooterDisclaimer3: string;

    // Sync View
    syncNowButton: string;
    abortSyncButton: string;
    syncingPhaseConnecting: string;
    syncingPhaseScanning: string;
    syncingPhaseDownloading: string;
    syncingPhaseError: string;
    syncingPhaseComplete: string;

    // Settings View
    settingsTitle: string;
    syncFolderGroup: string;
    autoSyncGroup: string;
    autoSyncInfoFrequency: string;
    autoSyncDaily: string;
    autoSyncDailyAt: string;
    generalGroup: string;
    minimizeToTrayLabel: string;
    minimizeToTrayDesc: string;
    startAtLoginLabelMac: string;
    startAtLoginLabelWin: string;
    startAtLoginDesc: string;
    heatmapLabel: string;
    heatmapDesc: string;
    syncOnStartupLabel: string;
    syncOnStartupDesc: string;
    notificationsLabel: string;
    notificationsDesc: string;
    windowSizeLabel: string;
    windowSizeDesc: string;
    updatesGroup: string;
    updatesDesc: string;
    checkingUpdates: string;
    checkUpdates: string;
    updateAvailable: string;
    updateNotAvailable: string;
    updateReadyTitle: string;
    updateReadyText: string;
    updateReadySubtext: string;
    updateLater: string;
    updateRestart: string;
    languageLabel: string;
    languageDesc: string;
    themeLabel: string;
    themeDesc: string;
    themeDark: string;
    themeLight: string;
    tutorialSkip: string;
    webeepPaused: string;
    webeepToggle: string;
    tutorialBack: string;
    tutorialNext: string;
    tutorialStart: string;
    tutorialWelcomeTitle: string;
    tutorialWelcomeBody: string;
    tutorialSyncTitle: string;
    tutorialSyncBody: string;
    tutorialFolderTitle: string;
    tutorialFolderBody: string;
    tutorialCoursesTitle: string;
    tutorialCoursesBody: string;
    tutorialFiltersTitle: string;
    tutorialFiltersBody: string;
    tutorialSettingsTitle: string;
    tutorialSettingsBody: string;
    tutorialPolimiTitle: string;
    tutorialPolimiBody: string;

    // Course List
    coursesHeader: string;
    coursesSelected: string;
    coursesEmpty: string;
    coursesEmptyHint: string;
    loadingCourses: string;
    termFilterAll: string;
    hideTermTooltip: string;
    showHiddenTermsTooltip: string;
    hideHiddenTermsTooltip: string;
    restoreTermTooltip: string;
    hiddenCoursesCount: string;
    actionsTooltip: string;
    actionRename: string;
    actionHide: string;
    actionUnhide: string;
    termOther: string;

    // Sync Result Modal
    resultTitle: string;
    resultTotalDownloaded: string;
    resultTotalScanned: string;
    resultDuration: string;
    resultNoNewFiles: string;
    resultDownloadedFiles: string;
}

export const translations: Record<'it' | 'en', TranslationKeys> = {
    it: {
        appName: "BlackBoard Sync",
        loading: "Caricamento...",
        connecting: "Connessione in corso...",
        offline: "Nessuna connessione a Internet",
        offlineHint: "Riprovo appena torni online…",
        logout: "Disconnetti",
        settings: "Impostazioni",
        openFolder: "Apri cartella",
        changeFolder: "Cambia cartella",
        lastSync: "Ultima sincronizzazione",
        never: "Mai",
        close: "Chiudi",
        reset: "Ripristina",
        error: "Errore",
        retry: "Riprova",

        loginTitle: "Accedi a Blackboard",
        loginSubtitle: "Accedi con le credenziali dell'Università Bocconi",
        usernameLabel: "Email / Matricola",
        passwordLabel: "Password",
        usernamePlaceholder: "Matricola o email",
        passwordPlaceholder: "Password",
        loginButton: "Accedi",
        bocconiLabel: "Università Bocconi",
        polimiLabel: "Politecnico di Milano",
        webeepConnect: "Collega",
        webeepConnecting: "Attendo l'accesso...",
        webeepDisconnect: "Scollega",
        accountsTitle: "Account",
        accountNotConnected: "Non collegato",
        coursesLoadError: "Impossibile caricare i corsi.",
        loggingIn: "Accesso in corso...",
        loginError: "Credenziali non valide o errore di connessione",
        maxLenError: "Le credenziali superano la lunghezza massima (256 caratteri)",
        emptyFieldsError: "Inserisci sia la matricola che la password",
        loginFooterCredentials: "Le credenziali vengono salvate in modo sicuro sul tuo dispositivo.",
        loginFooterDisclaimer1: "Questa app non è affiliata, associata o approvata dall'Università Bocconi.",
        loginFooterDisclaimer2: "È uno strumento indipendente per velocizzare il download dei documenti.",
        loginFooterDisclaimer3: "Il creatore non è in alcun modo responsabile dell'uso delle credenziali inserite.",

        syncNowButton: "Sincronizza ora",
        abortSyncButton: "Interrompi",
        syncingPhaseConnecting: "Connessione a Blackboard",
        syncingPhaseScanning: "Scansione corsi",
        syncingPhaseDownloading: "Download in corso",
        syncingPhaseError: "Sincronizzazione non riuscita",
        syncingPhaseComplete: "Sincronizzazione completata",

        settingsTitle: "Impostazioni",
        syncFolderGroup: "Cartella di sincronizzazione",
        autoSyncGroup: "Sincronizzazione automatica",
        autoSyncInfoFrequency: "Frequenza",
        autoSyncDaily: "Giornaliero",
        autoSyncDailyAt: "Ogni giorno alle",
        generalGroup: "Generali",
        minimizeToTrayLabel: "Minimizza nel tray",
        minimizeToTrayDesc: "Resta attiva chiudendo la finestra",
        startAtLoginLabelMac: "Avvia con Mac",
        startAtLoginLabelWin: "Avvia con Windows",
        startAtLoginDesc: "Avvia l'app all'accesso del sistema",
        heatmapLabel: "Effetto termico",
        heatmapDesc: "Scia a mappa di calore dietro l'elenco dei corsi",
        syncOnStartupLabel: "Sincronizza all'avvio",
        syncOnStartupDesc: "Sincronizza all'apertura dell'app",
        notificationsLabel: "Notifiche",
        notificationsDesc: "Notifica al completamento del sync",
        windowSizeLabel: "Dimensioni finestra",
        windowSizeDesc: "Ripristina le dimensioni di default",
        updatesGroup: "Aggiornamenti",
        updatesDesc: "Verifica automatica aggiornamenti",
        checkingUpdates: "Controllo aggiornamenti...",
        checkUpdates: "Controlla aggiornamenti",
        updateAvailable: "Aggiornamento disponibile!",
        updateNotAvailable: "Nessun aggiornamento disponibile",
        updateReadyTitle: "Aggiornamento pronto",
        updateReadyText: "Una nuova versione è stata scaricata.",
        updateReadySubtext: "Riavvia l'app per installare l'aggiornamento.",
        updateLater: "Più tardi",
        updateRestart: "Riavvia ora",
        languageLabel: "Lingua",
        languageDesc: "Seleziona la lingua dell'app",
        themeLabel: "Tema",
        themeDesc: "Aspetto scuro o chiaro dell'app",
        themeDark: "Scuro",
        themeLight: "Chiaro",
        tutorialSkip: "Salta",
        webeepPaused: "In pausa, i corsi non vengono sincronizzati",
        webeepToggle: "Sincronizza i corsi del Politecnico",
        tutorialBack: "Indietro",
        tutorialNext: "Avanti",
        tutorialStart: "Inizia",
        tutorialWelcomeTitle: "Benvenuto in BlackBoard Sync",
        tutorialWelcomeBody: "L'app scarica sul tuo computer i materiali dei corsi Bocconi e PoliMi.\nEcco come funziona, in pochi passi.",
        tutorialSyncTitle: "Sincronizza",
        tutorialSyncBody: "Scarica i file nuovi di tutti i corsi selezionati.\nQuelli già scaricati vengono saltati, e puoi interrompere in qualsiasi momento.",
        tutorialFolderTitle: "Cartella dei file",
        tutorialFolderBody: "Ogni corso ha la sua cartella qui dentro.\n- Clicca il percorso per aprirla\n- Premi [icon:pencil] per sceglierne un'altra",
        tutorialCoursesTitle: "I tuoi corsi",
        tutorialCoursesBody: "La spunta decide quali corsi sincronizzare.\nDal menu [icon:dots] puoi:\n- rinominare un corso\n- aprirne la cartella\n- nasconderlo dalla lista",
        tutorialFiltersTitle: "Filtri per semestre",
        tutorialFiltersBody: "Mostra un solo semestre alla volta.\nPassa sopra un filtro e premi [icon:close] per nasconderlo.",
        tutorialSettingsTitle: "Impostazioni",
        tutorialSettingsBody: "Qui trovi:\n- sincronizzazione automatica\n- tema chiaro o scuro\n- lingua\n- account Bocconi e PoliMi",
        tutorialPolimiTitle: "Politecnico di Milano",
        tutorialPolimiBody: "Studi anche al PoliMi? Collega qui WeBeep.\nCon l'interruttore lo metti in pausa senza scollegarti.",

        coursesHeader: "Corsi",
        coursesSelected: "selezionati",
        coursesEmpty: "Nessun corso trovato",
        coursesEmptyHint: "Controlla la connessione o riesegui la sincronizzazione.",
        loadingCourses: "Caricamento corsi...",
        termFilterAll: "Tutti",
        hideTermTooltip: "Nascondi categoria",
        showHiddenTermsTooltip: "Mostra categorie nascoste",
        hideHiddenTermsTooltip: "Nascondi categorie nascoste",
        restoreTermTooltip: "Ripristina categoria",
        hiddenCoursesCount: "nascosti",
        actionsTooltip: "Azioni",
        actionRename: "Rinomina",
        actionHide: "Nascondi",
        actionUnhide: "Mostra",
        termOther: "Altro",

        resultTitle: "Sincronizzazione Completata",
        resultTotalDownloaded: "File scaricati",
        resultTotalScanned: "File scansionati",
        resultDuration: "Durata",
        resultNoNewFiles: "Nessun nuovo file da scaricare.",
        resultDownloadedFiles: "File scaricati:"
    },
    en: {
        appName: "BlackBoard Sync",
        loading: "Loading...",
        connecting: "Connecting...",
        offline: "No internet connection",
        offlineHint: "Retrying as soon as you are back online…",
        logout: "Logout",
        settings: "Settings",
        openFolder: "Open folder",
        changeFolder: "Change folder",
        lastSync: "Last sync",
        never: "Never",
        close: "Close",
        reset: "Reset",
        error: "Error",
        retry: "Retry",

        loginTitle: "Log in to Blackboard",
        loginSubtitle: "Sign in with your Bocconi University credentials",
        usernameLabel: "Email / Student ID",
        passwordLabel: "Password",
        usernamePlaceholder: "Student ID or email",
        passwordPlaceholder: "Password",
        loginButton: "Log In",
        bocconiLabel: "Bocconi University",
        polimiLabel: "Politecnico di Milano",
        webeepConnect: "Connect",
        webeepConnecting: "Waiting for sign-in...",
        webeepDisconnect: "Disconnect",
        accountsTitle: "Accounts",
        accountNotConnected: "Not connected",
        coursesLoadError: "Unable to load courses.",
        loggingIn: "Logging in...",
        loginError: "Invalid credentials or connection error",
        maxLenError: "Credentials exceed maximum length (256 characters)",
        emptyFieldsError: "Please enter both Student ID and password",
        loginFooterCredentials: "Credentials are saved securely on your device.",
        loginFooterDisclaimer1: "This app is not affiliated, associated, or endorsed by Università Bocconi.",
        loginFooterDisclaimer2: "It is an independent tool to speed up document downloads.",
        loginFooterDisclaimer3: "The creator is in no way responsible for the use of the credentials entered.",

        syncNowButton: "Sync now",
        abortSyncButton: "Stop",
        syncingPhaseConnecting: "Connecting to Blackboard",
        syncingPhaseScanning: "Scanning courses",
        syncingPhaseDownloading: "Downloading files",
        syncingPhaseError: "Synchronization failed",
        syncingPhaseComplete: "Synchronization completed",

        settingsTitle: "Settings",
        syncFolderGroup: "Synchronization Folder",
        autoSyncGroup: "Automatic Sync",
        autoSyncInfoFrequency: "Frequency",
        autoSyncDaily: "Daily",
        autoSyncDailyAt: "Every day at",
        generalGroup: "General",
        minimizeToTrayLabel: "Minimize to tray",
        minimizeToTrayDesc: "Keep app active when closing window",
        startAtLoginLabelMac: "Start with Mac",
        startAtLoginLabelWin: "Start with Windows",
        startAtLoginDesc: "Start the app automatically at login",
        heatmapLabel: "Heat effect",
        heatmapDesc: "Heatmap trail behind the course list",
        syncOnStartupLabel: "Sync on startup",
        syncOnStartupDesc: "Sync automatically on startup",
        notificationsLabel: "Notifications",
        notificationsDesc: "Notify when sync is completed",
        windowSizeLabel: "Window dimensions",
        windowSizeDesc: "Reset window size to default",
        updatesGroup: "Updates",
        updatesDesc: "Automatically check for updates",
        checkingUpdates: "Checking for updates...",
        checkUpdates: "Check for updates",
        updateAvailable: "Update available!",
        updateNotAvailable: "No update available",
        updateReadyTitle: "Update ready",
        updateReadyText: "A new version has been downloaded.",
        updateReadySubtext: "Restart the app to install the update.",
        updateLater: "Later",
        updateRestart: "Restart now",
        languageLabel: "Language",
        languageDesc: "Select the application language",
        themeLabel: "Theme",
        themeDesc: "Dark or light appearance",
        themeDark: "Dark",
        themeLight: "Light",
        tutorialSkip: "Skip",
        webeepPaused: "Paused, courses are not synced",
        webeepToggle: "Sync Politecnico courses",
        tutorialBack: "Back",
        tutorialNext: "Next",
        tutorialStart: "Get started",
        tutorialWelcomeTitle: "Welcome to BlackBoard Sync",
        tutorialWelcomeBody: "The app downloads your Bocconi and PoliMi course materials to your computer.\nHere is how it works, in a few steps.",
        tutorialSyncTitle: "Sync",
        tutorialSyncBody: "Downloads the new files of every selected course.\nFiles you already have are skipped, and you can stop at any time.",
        tutorialFolderTitle: "Files folder",
        tutorialFolderBody: "Every course gets its own folder in here.\n- Click the path to open it\n- Press [icon:pencil] to pick another one",
        tutorialCoursesTitle: "Your courses",
        tutorialCoursesBody: "The tick decides which courses are synced.\nFrom the [icon:dots] menu you can:\n- rename a course\n- open its folder\n- hide it from the list",
        tutorialFiltersTitle: "Semester filters",
        tutorialFiltersBody: "Show one semester at a time.\nHover a filter and press [icon:close] to hide it.",
        tutorialSettingsTitle: "Settings",
        tutorialSettingsBody: "Here you will find:\n- automatic sync\n- light or dark theme\n- language\n- your Bocconi and PoliMi accounts",
        tutorialPolimiTitle: "Politecnico di Milano",
        tutorialPolimiBody: "Also at PoliMi? Connect WeBeep here.\nThe switch pauses it without signing you out.",

        coursesHeader: "Courses",
        coursesSelected: "selected",
        coursesEmpty: "No courses found",
        coursesEmptyHint: "Check your connection or run the sync again.",
        loadingCourses: "Loading courses...",
        termFilterAll: "All",
        hideTermTooltip: "Hide category",
        showHiddenTermsTooltip: "Show hidden categories",
        hideHiddenTermsTooltip: "Hide hidden categories",
        restoreTermTooltip: "Restore category",
        hiddenCoursesCount: "hidden",
        actionsTooltip: "Actions",
        actionRename: "Rename",
        actionHide: "Hide",
        actionUnhide: "Show",
        termOther: "Other",

        resultTitle: "Synchronization Completed",
        resultTotalDownloaded: "Files downloaded",
        resultTotalScanned: "Files scanned",
        resultDuration: "Duration",
        resultNoNewFiles: "No new files to download.",
        resultDownloadedFiles: "Downloaded files:"
    }
};

// Simple helper to get the translation function
export function getT(lang: string) {
    const activeLang = (lang === 'en' || lang === 'it') ? lang : 'it';
    return (key: keyof TranslationKeys) => translations[activeLang][key] || translations['it'][key];
}
