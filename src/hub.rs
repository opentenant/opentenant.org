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

pub fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && !s.starts_with('.')
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/* ---------------- search: repository and marketplace listings ---------------- */

const HUB: &str = "https://artifacthub.io/api/v1";
const PAGE: usize = 60; // Artifact Hub's maximum page size
const MAX_REPO_CHARTS: usize = 300;

#[derive(Debug, Deserialize, Default)]
struct SearchResp {
    packages: Option<Vec<SearchPkg>>,
}

#[derive(Debug, Deserialize, Default)]
struct SearchPkg {
    name: Option<String>,
    version: Option<String>,
    stars: Option<i64>,
    description: Option<String>,
    repository: Option<Repository>,
}

/// One chart in a listing.
#[derive(Debug, Clone)]
pub struct Summary {
    pub name: String,
    pub repo: String,
    pub repo_url: String,
    pub publisher: String,
    pub verified: bool,
    pub official: bool,
    pub version: String,
    pub stars: i64,
    pub description: String,
}

#[derive(Debug, Clone)]
pub struct RepoPage {
    pub repo: String,
    pub publisher: String,
    pub repo_url: String,
    pub verified: bool,
    pub official: bool,
    /// Total charts in the repository (may exceed `charts.len()`).
    pub total: usize,
    pub charts: Vec<Summary>,
}

#[derive(Debug, Clone)]
pub struct Publisher {
    pub repo: String,
    pub name: String,
    pub verified: bool,
    pub official: bool,
    pub charts: usize,
    pub stars: i64,
}

#[derive(Debug, Clone)]
pub struct Market {
    pub total: usize,
    pub charts: Vec<Summary>,
    pub publishers: Vec<Publisher>,
}

fn publisher_of(r: &Repository) -> String {
    [&r.organization_display_name, &r.user_alias, &r.display_name, &r.name]
        .into_iter()
        .filter_map(|s| s.as_ref())
        .find(|s| !s.is_empty())
        .cloned()
        .unwrap_or_default()
}

/// Most starred Helm charts, optionally limited to one repository.
/// `repo` must already be validated. Returns the page and the total match count.
async fn search(
    http: &reqwest::Client,
    repo: Option<&str>,
    offset: usize,
    limit: usize,
) -> Result<(Vec<Summary>, usize), HubError> {
    let mut url = format!("{HUB}/packages/search?kind=0&sort=stars&limit={limit}&offset={offset}");
    if let Some(r) = repo {
        url.push_str("&repo=");
        url.push_str(r);
    }
    let resp = http
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| HubError::Upstream(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(HubError::Upstream(format!("HTTP {}", resp.status())));
    }
    let total = resp
        .headers()
        .get("pagination-total-count")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<usize>().ok())
        .unwrap_or(0);
    let body: SearchResp = resp.json().await.map_err(|e| HubError::Upstream(e.to_string()))?;

    let items = body
        .packages
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| {
            let name = p.name?;
            let r = p.repository?;
            let repo = r.name.clone()?;
            // only list charts we can route to
            if !valid_id(&name) || !valid_id(&repo) {
                return None;
            }
            Some(Summary {
                publisher: publisher_of(&r),
                repo_url: http_url(r.url.clone()),
                verified: r.verified_publisher.unwrap_or(false),
                official: r.official.unwrap_or(false),
                name,
                repo,
                version: p.version.unwrap_or_default(),
                stars: p.stars.unwrap_or(0),
                description: p.description.unwrap_or_default(),
            })
        })
        .collect();
    Ok((items, total))
}

/// All (up to 300) Helm charts of one repository, most starred first.
pub async fn fetch_repo(http: &reqwest::Client, repo: &str) -> Result<RepoPage, HubError> {
    let mut charts: Vec<Summary> = Vec::new();
    let mut total = 0usize;
    let mut offset = 0usize;
    loop {
        let (items, t) = search(http, Some(repo), offset, PAGE).await?;
        if offset == 0 {
            total = t;
        }
        let empty = items.is_empty();
        charts.extend(items.into_iter().filter(|c| c.repo == repo));
        offset += PAGE;
        if empty || offset >= total || offset >= MAX_REPO_CHARTS {
            break;
        }
    }
    let first = charts.first().cloned().ok_or(HubError::NotFound)?;
    Ok(RepoPage {
        repo: repo.to_string(),
        publisher: if first.publisher.is_empty() { repo.to_string() } else { first.publisher },
        repo_url: first.repo_url,
        verified: first.verified,
        official: first.official,
        total: total.max(charts.len()),
        charts,
    })
}

/// Repository names ranked by the stars of their charts among the 300 most starred charts.
pub async fn top_repos(http: &reqwest::Client, n: usize) -> Result<Vec<String>, HubError> {
    let mut stars: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
    for page in 0..5 {
        let items = match search(http, None, page * PAGE, PAGE).await {
            Ok((items, _)) => items,
            Err(e) if page == 0 => return Err(e),
            Err(_) => break, // keep what we have
        };
        if items.is_empty() {
            break;
        }
        for c in items {
            *stars.entry(c.repo).or_default() += c.stars;
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }
    let mut v: Vec<(String, i64)> = stars.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    Ok(v.into_iter().take(n).map(|(r, _)| r).collect())
}

/// Top charts and the publishers behind the 120 most starred charts.
pub async fn fetch_market(http: &reqwest::Client) -> Result<Market, HubError> {
    let (mut charts, total) = search(http, None, 0, PAGE).await?;
    if charts.is_empty() {
        return Err(HubError::Upstream("empty search result".into()));
    }
    // a failed second page only shrinks the publisher list
    let more = search(http, None, PAGE, PAGE).await.map(|x| x.0).unwrap_or_default();

    let mut by_repo: std::collections::BTreeMap<String, Publisher> = std::collections::BTreeMap::new();
    for c in charts.iter().chain(more.iter()) {
        let p = by_repo.entry(c.repo.clone()).or_insert_with(|| Publisher {
            repo: c.repo.clone(),
            name: if c.publisher.is_empty() { c.repo.clone() } else { c.publisher.clone() },
            verified: false,
            official: false,
            charts: 0,
            stars: 0,
        });
        p.verified |= c.verified;
        p.official |= c.official;
        p.charts += 1;
        p.stars += c.stars;
    }
    let mut publishers: Vec<Publisher> = by_repo.into_values().collect();
    publishers.sort_by(|a, b| b.stars.cmp(&a.stars).then_with(|| a.repo.cmp(&b.repo)));
    publishers.truncate(24);
    charts.truncate(PAGE);
    Ok(Market { total: total.max(charts.len()), charts, publishers })
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