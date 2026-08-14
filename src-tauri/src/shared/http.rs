// URL joining for the Round Robin client on both sides. One rule, one place:
// a configured base URL may or may not carry a trailing slash, and either way
// the endpoint path lands exactly once.

/// Joins a path onto a configured base URL, tolerating a trailing slash.
pub fn endpoint(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_tolerates_a_trailing_slash() {
        assert_eq!(
            endpoint("https://rr.example/", "api/recordings"),
            "https://rr.example/api/recordings"
        );
        assert_eq!(
            endpoint("https://rr.example", "/api/recordings"),
            "https://rr.example/api/recordings"
        );
        assert_eq!(
            endpoint("https://rr.example/base/", "/api/x"),
            "https://rr.example/base/api/x"
        );
    }
}
