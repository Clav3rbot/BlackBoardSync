//! How remote names become local paths, and the check that keeps every path inside the
//! sync folder.

use std::path::{Path, PathBuf};

pub fn sanitize_path(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || (c.is_control() && !c.is_whitespace()) { '_' } else { c })
        .collect();
    let sanitized = sanitized.split_whitespace().collect::<Vec<_>>().join(" ");
    // Windows drops trailing dots and spaces, so "x.docm." would be saved as "x.docm" while its
    // Mark-of-the-Web stream lands on a separate "x.docm." entry. Also rules out "." and "..".
    let sanitized = sanitized.trim_end_matches(['.', ' ']);

    if sanitized.is_empty() {
        return "_".to_string();
    }

    // Windows refuses device names as a stem, whatever the extension.
    let stem = sanitized.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        format!("_{}", sanitized)
    } else {
        sanitized.to_string()
    }
}

/// Resolves `.` and `..` lexically, so it works on paths that don't exist yet.
pub fn normalize_path(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut components: Vec<Component> = Vec::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                // Ignore `..` that would escape
                if let Some(Component::Normal(_)) = components.last() {
                    components.pop();
                }
            }
            Component::CurDir => {} // Skip `.`
            other => components.push(other),
        }
    }
    components.iter().collect()
}

/// The sync folder, resolved once, to keep every path the app writes or opens inside it.
#[derive(Clone)]
pub struct SyncRoot {
    canon: Option<PathBuf>,
    lex: PathBuf,
}

impl SyncRoot {
    pub fn new(dir: &Path) -> Self {
        Self { canon: dir.canonicalize().ok(), lex: normalize_path(dir) }
    }

    pub fn contains(&self, path: &Path) -> bool {
        is_inside_resolved(path, self.canon.as_deref(), &self.lex)
    }
}

/// Compares canonical with canonical, or lexical with lexical when `path` can't be
/// canonicalized (not created yet), so a `\\?\` prefix never causes a mismatch.
fn is_inside_resolved(path: &Path, canon_base: Option<&Path>, lex_base: &Path) -> bool {
    match (path.canonicalize(), canon_base) {
        (Ok(resolved), Some(base)) => resolved.as_path() == base || resolved.starts_with(base),
        _ => {
            let resolved = normalize_path(path);
            resolved.as_path() == lex_base || resolved.starts_with(lex_base)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_handles_windows_invalid_names() {
        assert_eq!(sanitize_path("con.pdf"), "_con.pdf");
        assert_eq!(sanitize_path("LPT1"), "_LPT1");
        assert_eq!(sanitize_path("Console.pdf"), "Console.pdf");
        assert_eq!(sanitize_path("a\u{7}b\nc"), "a_b c");
        assert_eq!(sanitize_path("Slides..pdf"), "Slides..pdf");
        assert_eq!(sanitize_path(" .. "), "_");
        assert_eq!(sanitize_path("../x"), ".._x");
        assert_eq!(sanitize_path("Syllabus.docm."), "Syllabus.docm");
        assert_eq!(sanitize_path("Finance. ."), "Finance");
        assert_eq!(sanitize_path("CON."), "_CON");
    }

    #[test]
    fn normalize_path_resolves_dots_without_escaping_the_root() {
        assert_eq!(normalize_path(Path::new("/sync/a/./b/../c")), PathBuf::from("/sync/a/c"));
        assert_eq!(normalize_path(Path::new("/sync/../../etc")), PathBuf::from("/etc"));
        assert_eq!(normalize_path(Path::new("a/../../b")), PathBuf::from("b"));
    }

    #[test]
    fn paths_that_do_not_exist_are_checked_lexically() {
        let base = std::env::temp_dir().join(format!("bbsync-missing-{}", std::process::id()));
        let lex = normalize_path(&base);
        assert!(is_inside_resolved(&base.join("Corso/slide.pdf"), None, &lex));
        assert!(is_inside_resolved(&base, None, &lex));
        assert!(is_inside_resolved(&base.join("a/../b.pdf"), None, &lex));
        assert!(!is_inside_resolved(&base.join("../fuori.pdf"), None, &lex));
        assert!(!is_inside_resolved(&base.join("a/../../fuori.pdf"), None, &lex));
        let sibling = base.with_file_name(format!("{}2", base.file_name().unwrap().to_string_lossy()));
        assert!(!is_inside_resolved(&sibling.join("x.pdf"), None, &lex));
    }

    #[test]
    fn existing_paths_are_checked_canonically() {
        let root = std::env::temp_dir().join(format!("bbsync-canon-{}", std::process::id()));
        let base = root.join("sync");
        let outside = root.join("altro");
        std::fs::create_dir_all(base.join("Corso")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(base.join("Corso/slide.pdf"), b"x").unwrap();
        std::fs::write(outside.join("segreto.txt"), b"x").unwrap();
        let canon = base.canonicalize().unwrap();
        let lex = normalize_path(&base);

        assert!(is_inside_resolved(&base.join("Corso/slide.pdf"), Some(&canon), &lex));
        assert!(is_inside_resolved(&base, Some(&canon), &lex));
        assert!(!is_inside_resolved(&base.join("../altro/segreto.txt"), Some(&canon), &lex));
        assert!(!is_inside_resolved(&outside.join("segreto.txt"), Some(&canon), &lex));
        assert!(is_inside_resolved(&base.join("Corso/nuovo.pdf"), Some(&canon), &lex));

        let _ = std::fs::remove_dir_all(root);
    }
}
