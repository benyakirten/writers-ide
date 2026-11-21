pub(crate) const MAX_PATH: usize = 1024;

// Build-time filesystem paths are literal names, not encoded resource URLs.
pub(crate) fn portable_path(path: &str) -> bool {
    if path.is_empty()
        || path.len() > MAX_PATH
        || path
            .chars()
            .any(|c| c.is_control() || matches!(c, '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*'))
    {
        return false;
    }
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() > 16 {
        return false;
    }
    parts.into_iter().all(|part| {
        if part.is_empty() || part == "." || part == ".." || part.ends_with([' ', '.']) {
            return false;
        }
        let stem = part.split('.').next().unwrap_or_default().to_uppercase();
        let port = stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"));
        !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            && !port.is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
    })
}
