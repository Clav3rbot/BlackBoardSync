//! Rules about where things live, checked on the sources.

const SOURCES: &[(&str, &str)] = &[
    ("blackboard.rs", include_str!("blackboard.rs")),
    ("commands.rs", include_str!("commands.rs")),
    ("download.rs", include_str!("download.rs")),
    ("http.rs", include_str!("http.rs")),
    ("login.rs", include_str!("login.rs")),
    ("main.rs", include_str!("main.rs")),
    ("model.rs", include_str!("model.rs")),
    ("paths.rs", include_str!("paths.rs")),
    ("state.rs", include_str!("state.rs")),
    ("store.rs", include_str!("store.rs")),
    ("tray.rs", include_str!("tray.rs")),
    ("updater.rs", include_str!("updater.rs")),
    ("webeep.rs", include_str!("webeep.rs")),
    ("window.rs", include_str!("window.rs")),
];

#[test]
fn every_module_is_checked() {
    let mut on_disk: Vec<String> = std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/src"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".rs") && name != "rules.rs")
        .collect();
    on_disk.sort();
    let listed: Vec<&str> = SOURCES.iter().map(|(name, _)| *name).collect();
    assert_eq!(on_disk, listed);
}

#[test]
fn the_university_clients_do_not_depend_on_each_other() {
    let source = |name: &str| SOURCES.iter().find(|(n, _)| *n == name).unwrap().1;
    assert!(!source("webeep.rs").contains("crate::blackboard"));
    assert!(!source("blackboard.rs").contains("webeep"));
    // download.rs drives both clients; they must not reach back into it.
    assert!(!source("webeep.rs").contains("crate::download"));
    assert!(!source("blackboard.rs").contains("crate::download"));
}

#[test]
fn each_fact_has_one_home() {
    for (needle, homes) in [
        ("BlackBoardSync/1.0", &["http.rs"][..]),
        ("Client::builder", &["http.rs"]),
        ("keyring::", &["store.rs"]),
        ("unibocconi.it", &["blackboard.rs"]),
        ("polimi.it", &["webeep.rs"]),
        ("\"main\"", &["tray.rs", "window.rs"]),
        ("\"sync-progress\"", &["download.rs"]),
        // Error prefix of a university that failed to open: only `download::Sources::open`.
        ("\"Bocconi: {}\"", &["download.rs"]),
        ("\"PoliMi: {}\"", &["download.rs"]),
        // Paused PoliMi: read only by `webeep::active_token`.
        ("webeep_enabled", &["store.rs", "webeep.rs"]),
    ] {
        let found: Vec<&str> =
            SOURCES.iter().filter(|(_, src)| src.contains(needle)).map(|(name, _)| *name).collect();
        assert_eq!(found, homes, "{needle:?}");
    }
}
