use crate::plugin_registry::{
    command_resource_settings::SettingsSnapshot, CommandResourceRevision, CommandResourceSettings,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub type Reply<T> = Result<T, Value>;
pub fn error(code: &str, message: &str) -> Value {
    json!({"code":code,"message":message.chars().take(512).collect::<String>()})
}
pub fn invalid() -> Value {
    error("invalid-message", "Invalid or oversized fixture request")
}
pub fn parse<T: for<'a> Deserialize<'a>>(raw: &str) -> Reply<T> {
    if raw.len() > 4096 || !raw.trim_start().starts_with('{') {
        return Err(invalid());
    }
    serde_json::from_str(raw).map_err(|_| invalid())
}
pub fn decimal(text: &str, positive: bool) -> Reply<i64> {
    let value = text.parse::<i64>().map_err(|_| invalid())?;
    if value < 0 || (positive && value == 0) || value.to_string() != text {
        return Err(invalid());
    }
    Ok(value)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Base {
    pub version: u8,
    pub session: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Attach {
    pub version: u8,
    pub session: String,
    pub challenge: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Identity {
    pub version: u8,
    pub session: String,
    pub epoch: String,
    pub attachment: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Renew {
    pub version: u8,
    pub session: String,
    pub epoch: String,
    pub attachment: String,
    pub challenge: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ack {
    pub version: u8,
    pub session: String,
    pub epoch: String,
    pub attachment: String,
    pub sequence: String,
    pub revision: CommandResourceRevision,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PayloadLimits {
    pub max_bytes: u64,
    pub max_depth: u64,
    pub max_entries: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Limits {
    #[serde(deserialize_with = "object")]
    pub payload: PayloadLimits,
    pub max_component_bytes: u64,
    pub max_window_bytes: u64,
    pub max_caller_pending: u64,
    pub max_provider_pending: u64,
    pub max_window_pending: u64,
}
impl From<&CommandResourceSettings> for Limits {
    fn from(s: &CommandResourceSettings) -> Self {
        Self {
            payload: PayloadLimits {
                max_bytes: s.max_payload_bytes,
                max_depth: s.max_payload_depth,
                max_entries: s.max_payload_entries,
            },
            max_component_bytes: s.max_component_bytes,
            max_window_bytes: s.max_window_bytes,
            max_caller_pending: s.max_caller_pending,
            max_provider_pending: s.max_provider_pending,
            max_window_pending: s.max_window_pending,
        }
    }
}
impl Limits {
    pub(crate) fn native(&self) -> Reply<CommandResourceSettings> {
        let s = CommandResourceSettings {
            max_payload_bytes: self.payload.max_bytes,
            max_payload_depth: self.payload.max_depth,
            max_payload_entries: self.payload.max_entries,
            max_component_bytes: self.max_component_bytes,
            max_window_bytes: self.max_window_bytes,
            max_caller_pending: self.max_caller_pending,
            max_provider_pending: self.max_provider_pending,
            max_window_pending: self.max_window_pending,
        };
        s.validate().map_err(|_| invalid())?;
        Ok(s)
    }
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Save {
    pub version: u8,
    pub session: String,
    pub request_id: String,
    pub expected_revision: CommandResourceRevision,
    #[serde(deserialize_with = "object")]
    pub settings: Limits,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResultRequest {
    pub version: u8,
    pub session: String,
    pub request_id: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Case {
    pub name: String,
    pub ok: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Report {
    pub version: u8,
    pub session: String,
    #[serde(deserialize_with = "cases")]
    pub cases: Vec<Case>,
}
fn object<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<T, D::Error> {
    struct Visitor<T>(std::marker::PhantomData<T>);
    impl<'de, T: Deserialize<'de>> serde::de::Visitor<'de> for Visitor<T> {
        type Value = T;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("JSON object")
        }
        fn visit_map<M: serde::de::MapAccess<'de>>(self, map: M) -> Result<T, M::Error> {
            T::deserialize(serde::de::value::MapAccessDeserializer::new(map))
        }
    }
    deserializer.deserialize_map(Visitor(std::marker::PhantomData))
}
fn cases<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Vec<Case>, D::Error> {
    #[derive(Deserialize)]
    struct ObjectCase(#[serde(deserialize_with = "object")] Case);
    let values = Vec::<ObjectCase>::deserialize(deserializer)?;
    if values.len() > 32 {
        return Err(serde::de::Error::custom("case limit"));
    }
    Ok(values.into_iter().map(|v| v.0).collect())
}
pub(crate) fn snapshot(epoch: &str, s: &SettingsSnapshot) -> Value {
    json!({"epoch":epoch,"revision":s.saved.revision,"settings":Limits::from(&s.saved.settings)})
}
pub fn challenge(text: &str) -> Reply<()> {
    if text.len() != 36
        || !text.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
    {
        return Err(invalid());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_raw_boundary() {
        assert!(parse::<Base>(&" ".repeat(4097)).is_err());
        assert!(parse::<Base>(r#"[1,"session"]"#).is_err());
        assert!(parse::<Report>(r#"{"version":1,"session":"x","cases":[["name",true]]}"#).is_err());
        assert!(parse::<Base>(r#"{"version":1,"session":"x","role":"manager"}"#).is_err());
        assert!(parse::<Base>(r#"{"version":1,"version":1,"session":"x"}"#).is_err());
        for x in ["01", "-1", "+1", "9223372036854775808", "1.0"] {
            assert!(decimal(x, false).is_err());
        }
        assert!(decimal("9223372036854775807", true).is_ok());
    }
    #[test]
    fn nested_limits_are_strict_and_safe() {
        let mut s = Limits::from(&CommandResourceSettings::default());
        assert!(s.native().is_ok());
        s.payload.max_bytes = 0;
        assert!(s.native().is_err());
        s.payload.max_bytes = 9_007_199_254_740_992;
        assert!(s.native().is_err());
        let mut v = serde_json::to_value(s).unwrap();
        v["payload"]["extra"] = json!(1);
        assert!(serde_json::from_value::<Limits>(v).is_err());
    }
}
