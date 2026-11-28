use serde::Deserialize;
use std::{fs, path::PathBuf};

pub const MARKER: &str = ".application-integration-owner.json";
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Marker {
    schema: u8,
    run_id: String,
}
#[derive(Clone)]
pub struct OwnedParent {
    pub parent: PathBuf,
    pub run_id: String,
    pub inspect: bool,
    pub resource_denial_policy: bool,
}
impl OwnedParent {
    pub fn arguments() -> Result<Self, String> {
        let mut args = std::env::args().skip(1);
        let (mut parent, mut run_id, mut inspect) = (None, None, false);
        let mut resource_denial_policy = false;
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--parent" if parent.is_none() => parent = args.next().map(PathBuf::from),
                "--run-id" if run_id.is_none() => run_id = args.next(),
                "--inspect-ownership" if !inspect => inspect = true,
                "--resource-denial-policy" if !resource_denial_policy => {
                    resource_denial_policy = true
                }
                _ => return Err("unknown or repeated fixture argument".into()),
            }
        }
        let mut owned = Self::validate(
            parent.ok_or("--parent required")?,
            run_id.ok_or("--run-id required")?,
            inspect,
        )?;
        owned.resource_denial_policy = resource_denial_policy;
        Ok(owned)
    }
    pub fn validate(parent: PathBuf, run_id: String, inspect: bool) -> Result<Self, String> {
        if !crate::owned::marker(&run_id) || !parent.is_absolute() || parent.parent().is_none() {
            return Err("absolute owned parent and lowercase 32-hex run ID required".into());
        }
        let metadata = fs::symlink_metadata(&parent).map_err(|_| "parent missing")?;
        if !metadata.is_dir()
            || metadata.is_symlink()
            || fs::canonicalize(&parent).map_err(|_| "canonical parent")? != parent
        {
            return Err("parent must be an existing canonical non-link directory".into());
        }
        let path = parent.join(MARKER);
        let metadata = fs::symlink_metadata(&path).map_err(|_| "ownership marker missing")?;
        if !metadata.is_file() || metadata.is_symlink() || metadata.len() > 256 {
            return Err("invalid ownership marker metadata".into());
        }
        let value: Marker = serde_json::from_slice(&fs::read(path).map_err(|_| "marker read")?)
            .map_err(|_| "invalid ownership marker")?;
        if value.schema != 1 || value.run_id != run_id {
            return Err("ownership marker mismatch".into());
        }
        Ok(Self {
            parent,
            run_id,
            inspect,
            resource_denial_policy: false,
        })
    }
    pub fn root(&self) -> PathBuf {
        self.parent.join("registry")
    }
    pub fn replacement_root(&self) -> PathBuf {
        self.parent.join("replacement-registry")
    }
}
pub fn marker(text: &str) -> bool {
    text.len() == 32
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn random_marker() -> String {
    let mut bytes = [0; 16];
    getrandom::fill(&mut bytes).expect("fixture requires system randomness");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn owned_marker_is_mandatory_and_exact() {
        let dir = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(dir.path()).unwrap();
        let id = "a".repeat(32);
        assert!(OwnedParent::validate(path.clone(), id.clone(), false).is_err());
        fs::write(
            path.join(MARKER),
            format!("{{\"schema\":1,\"runId\":\"{id}\"}}"),
        )
        .unwrap();
        assert!(OwnedParent::validate(path.clone(), id, false).is_ok());
        assert!(OwnedParent::validate(path, "b".repeat(32), false).is_err());
    }
}
