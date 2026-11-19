//! Artifact Hub client. Mirrors `normalizePkg` from builder.js.

use serde::Deserialize;

#[derive(Debug, Deserialize, Default)]
struct Repository {
    name: Option<String>,
    url: Option<String>,
    organization_display_name: Option<String>,
    user_alias: Option<String>,
    display_name: Option<String>,
    verified_publisher: Option<bool>,
    official: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
struct Maintainer {
    name: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct Link {
    name: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct Package {
    name: Option<String>,
    version: Option<String>,
    app_version: Option<String>,
    stars: Option<i64>,
    description: Option<String>,
    readme: Option<String>,
    home_url: Option<String>,
    license: Option<String>,
    keywords: Option<Vec<String>>,
    maintainers: Option<Vec<Maintainer>>,
    links: Option<Vec<Link>>,
    deprecated: Option<bool>,
    ts: Option<i64>,
    repository: Option<Repository>,
}

/// Flat, ready-to-render chart data.
#[derive(Debug, Clone)]
pub struct Chart {
    pub name: String,
    pub repo: String,
    pub repo_url: String,
    pub publisher: String,
    pub verified: bool,
    pub official: bool,
    pub version: String,
    pub app_version: String,
    pub stars: i64,
    pub description: String,
    pub readme: String,
    pub home_url: String,
    pub license: String,
    pub keywords: Vec<String>,
    pub maintainers: Vec<String>,
    /// (label, url)
    pub links: Vec<(String, String)>,
    pub deprecated: bool,
    pub ts: i64,
}

#[derive(Debug)]
pub enum HubError {
    NotFound,
    Upstream(String),
}

fn http_url(u: Option<String>) -> String {
    match u {
        Some(u) if u.to_ascii_lowercase().starts_with("http://") || u.to_ascii_lowercase().starts_with("https://") => u,
        _ => String::new(),
    }
}

fn non_empty(s: Option<String>) -> Option<String> {
    s.filter(|s| !s.is_empty())
}

pub async fn fetch_chart(http: &reqwest::Client, repo: &str, name: &str) -> Result<Chart, HubError> {
    // `repo` and `name` are validated by the caller (letters, digits, . _ -), so no encoding is needed.
    let url = format!("https://artifacthub.io/api/v1/packages/helm/{repo}/{name}");
    let resp = http
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| HubError::Upstream(e.to_string()))?;

    let status = resp.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(HubError::NotFound);
    }
    if !status.is_success() {
        return Err(HubError::Upstream(format!("HTTP {status}")));
    }
    let p: Package = resp.json().await.map_err(|e| HubError::Upstream(e.to_string()))?;

    let got_name = p.name.clone().unwrap_or_default();
    let r = p.repository.unwrap_or_default();
    let got_repo = r.name.clone().unwrap_or_default();

    // If the hub matched case-insensitively, refuse to create a duplicate page under another URL.
    if (!got_name.is_empty() && got_name != name && got_name.eq_ignore_ascii_case(name))
        || (!got_repo.is_empty() && got_repo != repo && got_repo.eq_ignore_ascii_case(repo))
    {
        return Err(HubError::NotFound);
    }

    let publisher = non_empty(r.organization_display_name)
        .or_else(|| non_empty(r.user_alias))
        .or_else(|| non_empty(r.display_name))
        .or_else(|| non_empty(r.name))
        .unwrap_or_default();

    Ok(Chart {
        // Always use the requested, validated identifiers so every URL we emit is safe.
        name: name.to_string(),
        repo: repo.to_string(),
        repo_url: http_url(r.url),
        publisher,
        verified: r.verified_publisher.unwrap_or(false),
        official: r.official.unwrap_or(false),
        version: p.version.unwrap_or_default(),
        app_version: p.app_version.unwrap_or_default(),
        stars: p.stars.unwrap_or(0),
        description: p.description.unwrap_or_default(),
        readme: p.readme.unwrap_or_default(),
        home_url: http_url(p.home_url),
        license: p.license.unwrap_or_default(),
        keywords: p.keywords.unwrap_or_default().into_iter().take(12).collect(),
        maintainers: p
            .maintainers
            .unwrap_or_default()
            .into_iter()
            .filter_map(|m| non_empty(m.name))
            .take(6)
            .collect(),
        links: p
            .links
            .unwrap_or_default()
            .into_iter()
            .filter_map(|l| {
                let url = http_url(l.url);
                if url.is_empty() {
                    None
                } else {
                    Some((l.name.unwrap_or_default(), url))
                }
            })
            .take(6)
            .collect(),
        deprecated: p.deprecated.unwrap_or(false),
        ts: p.ts.unwrap_or(0),
    })
}