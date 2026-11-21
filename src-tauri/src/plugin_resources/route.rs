//! Native-only response primitives. This module registers no runtime routes.

use super::{SnapshotError, SnapshotId, SnapshotPool, WebViewHandle};
use crate::plugin_integrity::{validate_path, IntegrityLimits};
use std::fmt;
use tauri::http::{header, HeaderValue, Method, Request, Response, StatusCode, Uri};

pub(crate) struct ResourceRoute {
    resource_origin: String,
    shell_origin: HeaderValue,
    path_limits: IntegrityLimits,
    max_encoded_path: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RouteError {
    InvalidOrigin,
    InvalidPath,
}

impl fmt::Display for RouteError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidOrigin => "expected distinct, exact resource and shell origins",
            Self::InvalidPath => "invalid verified resource path",
        })
    }
}

impl std::error::Error for RouteError {}

impl ResourceRoute {
    pub(crate) fn new(
        resource_origin: &str,
        shell_origin: &str,
        path_limits: IntegrityLimits,
    ) -> Result<Self, RouteError> {
        validate_origin(resource_origin)?;
        let shell_header = validate_origin(shell_origin)?;
        if same_origin(resource_origin, shell_origin) {
            return Err(RouteError::InvalidOrigin);
        }
        let max_encoded_path = path_limits
            .max_path_bytes
            .checked_mul(3)
            .and_then(|length| length.checked_add("/snapshots/".len() + 64 + 1))
            .ok_or(RouteError::InvalidPath)?;
        Ok(Self {
            resource_origin: resource_origin.to_owned(),
            shell_origin: shell_header,
            path_limits,
            max_encoded_path,
        })
    }

    pub(crate) fn file_url(&self, id: SnapshotId, path: &str) -> Result<String, RouteError> {
        validate_path(path, &self.path_limits).map_err(|_| RouteError::InvalidPath)?;
        let mut url = format!("{}/snapshots/{}/", self.resource_origin, id.to_hex());
        const HEX: &[u8; 16] = b"0123456789ABCDEF";
        for byte in path.bytes() {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'/') {
                url.push(char::from(byte));
            } else {
                url.push('%');
                url.push(char::from(HEX[usize::from(byte >> 4)]));
                url.push(char::from(HEX[usize::from(byte & 15)]));
            }
        }
        Ok(url)
    }

    /// The caller can enforce delivery budgets before copying these borrowed bytes.
    pub(crate) fn respond<'a>(
        &self,
        pool: &'a SnapshotPool,
        view: &WebViewHandle,
        request: &Request<Vec<u8>>,
    ) -> Response<&'a [u8]> {
        // Validate the real host handle before exposing even failure metadata.
        if pool.check_view(view).is_err() {
            return self.error(StatusCode::FORBIDDEN);
        }
        if request.method() != Method::GET && request.method() != Method::HEAD {
            return self.error(StatusCode::METHOD_NOT_ALLOWED);
        }
        let (id, path) = match self.request_path(request.uri()) {
            Ok(target) => target,
            Err(_) => return self.error(StatusCode::BAD_REQUEST),
        };
        let bytes = match pool.file(view, id, &path) {
            Ok(bytes) => bytes,
            Err(SnapshotError::AccessDenied | SnapshotError::WebViewUnavailable) => {
                return self.error(StatusCode::FORBIDDEN);
            }
            Err(SnapshotError::SnapshotUnavailable | SnapshotError::FileNotFound) => {
                return self.error(StatusCode::NOT_FOUND);
            }
            Err(_) => return self.error(StatusCode::INTERNAL_SERVER_ERROR),
        };
        if !request.body().is_empty() {
            return self.error(StatusCode::BAD_REQUEST);
        }
        let mut response = self.error(StatusCode::OK);
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static(mime_type(&path)),
        );
        response.headers_mut().insert(
            header::CONTENT_LENGTH,
            HeaderValue::from_str(&bytes.len().to_string()).expect("decimal content length"),
        );
        if request.method() == Method::GET {
            *response.body_mut() = bytes;
        }
        response
    }

    pub(crate) fn error(&self, status: StatusCode) -> Response<&'static [u8]> {
        let mut response = Response::new(&[][..]);
        *response.status_mut() = status;
        let headers = response.headers_mut();
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("0"));
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        headers.insert(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            self.shell_origin.clone(),
        );
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
        headers.insert(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            HeaderValue::from_static(
                "Content-Type, Content-Length, Cache-Control, X-Content-Type-Options, Access-Control-Allow-Origin, Allow",
            ),
        );
        if status == StatusCode::METHOD_NOT_ALLOWED {
            headers.insert(header::ALLOW, HeaderValue::from_static("GET, HEAD"));
        }
        response
    }

    fn request_path(&self, uri: &Uri) -> Result<(SnapshotId, String), RouteError> {
        let invalid = RouteError::InvalidPath;
        // Inspect borrowed components before allocating decoded strings. Queries
        // are rejected even when empty, so their size never drives allocation.
        if uri.query().is_some() || uri.path().len() > self.max_encoded_path {
            return Err(invalid);
        }
        let (scheme, authority) = self
            .resource_origin
            .split_once("://")
            .expect("validated origin");
        if uri.scheme_str() != Some(scheme)
            || uri.authority().map(|value| value.as_str()) != Some(authority)
        {
            return Err(invalid);
        }
        let target = uri.path().strip_prefix("/snapshots/").ok_or(invalid)?;
        let (id, encoded) = target.split_once('/').ok_or(invalid)?;
        let id = SnapshotId::from_hex(id).ok_or(invalid)?;
        let mut decoded = Vec::with_capacity(encoded.len().min(self.path_limits.max_path_bytes));
        let input = encoded.as_bytes();
        let mut index = 0;
        while index < input.len() {
            let byte = input[index];
            index += 1;
            let byte = if byte == b'%' {
                let high = hex_digit(*input.get(index).ok_or(invalid)?).ok_or(invalid)?;
                let low = hex_digit(*input.get(index + 1).ok_or(invalid)?).ok_or(invalid)?;
                index += 2;
                let value = high * 16 + low;
                if matches!(value, b'/' | b'\\') {
                    return Err(invalid);
                }
                value
            } else {
                // Raw URI delimiters and non-ASCII bytes are not filename encoding.
                if !byte.is_ascii() || matches!(byte, b'#' | b'\\') {
                    return Err(invalid);
                }
                byte
            };
            if decoded.len() >= self.path_limits.max_path_bytes {
                return Err(invalid);
            }
            decoded.push(byte);
        }
        let path = String::from_utf8(decoded).map_err(|_| invalid)?;
        validate_path(&path, &self.path_limits).map_err(|_| invalid)?;
        Ok((id, path))
    }
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn validate_origin(origin: &str) -> Result<HeaderValue, RouteError> {
    let invalid = RouteError::InvalidOrigin;
    let (scheme, authority) = origin.split_once("://").ok_or(invalid)?;
    if authority.is_empty()
        || origin
            .bytes()
            .any(|byte| !byte.is_ascii() || byte.is_ascii_whitespace())
        || authority.contains(['/', '?', '#', '@', '*', '\\', '%'])
    {
        return Err(invalid);
    }
    let uri: Uri = origin.parse().map_err(|_| invalid)?;
    if uri.scheme_str() != Some(scheme)
        || uri.authority().map(|value| value.as_str()) != Some(authority)
        || uri.host().is_none_or(str::is_empty)
        || uri.query().is_some()
    {
        return Err(invalid);
    }
    let host = uri.host().ok_or(invalid)?;
    if host.starts_with('[') {
        host.strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
            .ok_or(invalid)?
            .parse::<std::net::Ipv6Addr>()
            .map_err(|_| invalid)?;
    } else if !host
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.'))
    {
        return Err(invalid);
    }
    let suffix = authority.strip_prefix(host).ok_or(invalid)?;
    if !suffix.is_empty() {
        let port = suffix.strip_prefix(':').ok_or(invalid)?;
        if port.is_empty() || !port.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(invalid);
        }
        port.parse::<u16>().map_err(|_| invalid)?;
    }
    HeaderValue::from_str(origin).map_err(|_| invalid)
}

fn same_origin(left: &str, right: &str) -> bool {
    let left: Uri = left.parse().expect("validated origin");
    let right: Uri = right.parse().expect("validated origin");
    let port = |uri: &Uri| {
        uri.port_u16().or(match uri.scheme_str() {
            Some("http") => Some(80),
            Some("https") => Some(443),
            _ => None,
        })
    };
    left.scheme_str() == right.scheme_str()
        && left
            .host()
            .unwrap()
            .eq_ignore_ascii_case(right.host().unwrap())
        && port(&left) == port(&right)
}

fn mime_type(path: &str) -> &'static str {
    let extension = path
        .rsplit('/')
        .next()
        .unwrap_or("")
        .rsplit_once('.')
        .map(|(_, extension)| extension);
    match extension.unwrap_or("") {
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "txt" => "text/plain",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}
