use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value;

static COMPLETED: AtomicBool = AtomicBool::new(false);
const MAX_REPORT_BYTES: usize = 64 * 1024;

pub(crate) fn claim_completion() -> bool {
    !COMPLETED.swap(true, Ordering::AcqRel)
}

pub(crate) fn validate(label: &str, report: &Value) -> Result<(), String> {
    if !matches!(label, "main" | "peer" | "denied") {
        return Err("finish requires a fixed harness window".into());
    }
    if !report.is_object() || report.get("ok").and_then(Value::as_bool).is_none() {
        return Err("report must be an object with boolean ok".into());
    }
    let mut remaining = 2048;
    if !bounded(report, 0, &mut remaining) {
        return Err("report exceeds structural limits".into());
    }
    let bytes = serde_json::to_vec(report).map_err(|_| "report serialization failed")?;
    if bytes.len() > MAX_REPORT_BYTES {
        return Err("report exceeds 65536 bytes".into());
    }
    Ok(())
}

fn bounded(value: &Value, depth: usize, remaining: &mut usize) -> bool {
    if depth > 12 || *remaining == 0 {
        return false;
    }
    *remaining -= 1;
    match value {
        Value::String(text) => text.len() <= 8192,
        Value::Array(items) => items
            .iter()
            .all(|value| bounded(value, depth + 1, remaining)),
        Value::Object(fields) => fields
            .iter()
            .all(|(key, value)| key.len() <= 128 && bounded(value, depth + 1, remaining)),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_window_and_report_shape() {
        assert!(validate(
            "main",
            &json!({"ok": true, "cases": [{"name": "esm", "ok": true}]})
        )
        .is_ok());
        for value in [Value::Null, json!([]), json!({}), json!({"ok": "true"})] {
            assert!(validate("main", &value).is_err());
        }
        assert!(validate("foreign", &json!({"ok": true})).is_err());
        for label in ["peer", "denied"] {
            assert!(validate(label, &json!({"ok": true})).is_ok());
        }
    }

    #[test]
    fn bounds_strings_nodes_depth_keys_and_serialized_size() {
        assert!(validate("main", &json!({"ok": false, "error": "x".repeat(8193)})).is_err());
        assert!(validate("main", &json!({"ok": true, "items": vec![0; 2048]})).is_err());
        let mut nested = Value::Null;
        for _ in 0..13 {
            nested = json!([nested]);
        }
        assert!(validate("main", &json!({"ok": true, "items": nested})).is_err());
        let mut fields = serde_json::Map::new();
        fields.insert("ok".into(), Value::Bool(true));
        fields.insert("x".repeat(129), Value::Null);
        assert!(validate("main", &Value::Object(fields)).is_err());
        assert!(validate(
            "main",
            &json!({"ok": true, "items": vec!["x".repeat(8192); 9]})
        )
        .is_err());
    }
}
