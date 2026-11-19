//! OpenTenant chart server.
//!
//! Generated pages (cached on disk, refreshed in the background, listed in the sitemap):
//! - `GET /marketplace`          popular publishers and charts
//! - `GET /helm/{repo}`          one repository / author (bitnami, hashicorp, ...)
//! - `GET /helm/{repo}/{name}`   one chart
//!
//! Also:
//! - `GET /chart.html?repo=&name=`  308 redirect to the clean chart route (or the client-side page without params)
//! - `GET /sitemap.xml`             rebuilt from the cached pages and `public/articles`
//! - `/` and `/articles/...`        static files from `PUBLIC_DIR`; everything else in `PUBLIC_DIR` is the fallback
//!
//! Env: BIND (0.0.0.0:8080), PUBLIC_DIR (public), CACHE_DIR (cache),
//!      BASE_URL (https://opentenant.org), CACHE_TTL_SECS (86400)

mod hub;
mod render;

use std::{
    collections::{BTreeMap, HashMap},
    net::SocketAddr,
    path::{Path as FsPath, PathBuf},
    sync::{Arc, Mutex, RwLock},
    time::{Duration, Instant, SystemTime},
};

use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::get,
    Router,
};
use chrono::{DateTime, Utc};
use hub::{valid_id, HubError};
use tower_http::{compression::CompressionLayer, services::ServeDir};

const RETRY: Duration = Duration::from_secs(300);
const NEGATIVE_TTL: Duration = Duration::from_secs(600);
const MAX_SITEMAP_URLS: usize = 50_000;
const STATIC_URLS: &[&str] = &["/"];
const CACHE_OK: &str = "public, max-age=300, stale-while-revalidate=3600";
/// How many publisher pages the marketplace pre-generates so they show up in the sitemap.
const WARM_REPOS: usize = 12;

/// Everything that is generated and cached.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
enum Page {
    Market,
    Repo(String),
    Chart(String, String),
}

impl Page {
    /// Cache file, relative to CACHE_DIR.
    fn file(&self) -> PathBuf {
        match self {
            Page::Market => PathBuf::from("marketplace.html"),
            Page::Repo(r) => PathBuf::from("repo").join(format!("{r}.html")),
            Page::Chart(r, n) => PathBuf::from("helm").join(r).join(format!("{n}.html")),
        }
    }

    fn url_path(&self) -> String {
        match self {
            Page::Market => "/marketplace".to_string(),
            Page::Repo(r) => format!("/helm/{r}"),
            Page::Chart(r, n) => format!("/helm/{r}/{n}"),
        }
    }
}

struct Config {
    bind: SocketAddr,
    public_dir: PathBuf,
    cache_dir: PathBuf,
    base_url: String,
    ttl: Duration,
}

impl Config {
    fn from_env() -> Self {
        let get = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
        Config {
            bind: get("BIND", "0.0.0.0:8080").parse().expect("BIND must be host:port"),
            public_dir: PathBuf::from(get("PUBLIC_DIR", "public")),
            cache_dir: PathBuf::from(get("CACHE_DIR", "cache")),
            base_url: get("BASE_URL", "https://opentenant.org").trim_end_matches('/').to_string(),
            ttl: Duration::from_secs(get("CACHE_TTL_SECS", "86400").parse().expect("CACHE_TTL_SECS must be a number")),
        }
    }
}

struct Entry {
    /// When the page content last changed (sitemap <lastmod>).
    lastmod: SystemTime,
    /// Earliest time a background refresh may run.
    next_check: SystemTime,
}

/// A freshly built page plus related pages worth pre-generating.
struct Built {
    html: String,
    warm: Vec<Page>,
}

enum Outcome {
    Ok(String),
    NotFound,
    Upstream,
}

struct App {
    cfg: Config,
    http: reqwest::Client,
    index: RwLock<BTreeMap<Page, Entry>>,
    locks: Mutex<HashMap<Page, Arc<tokio::sync::Mutex<()>>>>,
    missing: Mutex<HashMap<Page, Instant>>,
    sitemap_lock: tokio::sync::Mutex<()>,
}

fn xml_esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn html_response(status: StatusCode, body: String, cache: &'static str) -> Response {
    (
        status,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, cache),
        ],
        body,
    )
        .into_response()
}

fn not_found(page: &Page) -> Response {
    let (title, text) = match page {
        Page::Repo(_) => (
            "Repository not found",
            "Artifact Hub has no Helm repository with that name, or it has no charts. Try one of these charts.",
        ),
        _ => (
            "Chart not found",
            "Artifact Hub has no Helm chart with that name. Try one of these.",
        ),
    };
    html_response(StatusCode::NOT_FOUND, render::message_page(title, text), "public, max-age=60")
}

fn bad_gateway() -> Response {
    html_response(
        StatusCode::BAD_GATEWAY,
        render::message_page(
            "Could not load this page",
            "Artifact Hub could not be reached. Please try again in a moment.",
        ),
        "no-store",
    )
}

fn invalid_link() -> Response {
    html_response(
        StatusCode::NOT_FOUND,
        render::message_page(
            "That link is not valid",
            "Chart and repository names only use letters, numbers, dots, dashes and underscores.",
        ),
        "public, max-age=60",
    )
}

async fn mtime(path: &FsPath) -> Option<SystemTime> {
    tokio::fs::metadata(path).await.ok().and_then(|m| m.modified().ok())
}

/// Reads every cached page into the index.
async fn scan_cache(cache_dir: &FsPath, ttl: Duration) -> BTreeMap<Page, Entry> {
    let mut out = BTreeMap::new();
    let entry = |m: SystemTime| Entry { lastmod: m, next_check: m + ttl };

    if let Some(m) = mtime(&cache_dir.join("marketplace.html")).await {
        out.insert(Page::Market, entry(m));
    }

    if let Ok(mut files) = tokio::fs::read_dir(cache_dir.join("repo")).await {
        while let Ok(Some(f)) = files.next_entry().await {
            let fname = f.file_name().to_string_lossy().into_owned();
            let Some(repo) = fname.strip_suffix(".html") else { continue };
            if !valid_id(repo) {
                continue;
            }
            if let Some(m) = mtime(&f.path()).await {
                out.insert(Page::Repo(repo.to_string()), entry(m));
            }
        }
    }

    if let Ok(mut repos) = tokio::fs::read_dir(cache_dir.join("helm")).await {
        while let Ok(Some(r)) = repos.next_entry().await {
            if !r.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let repo = r.file_name().to_string_lossy().into_owned();
            if !valid_id(&repo) {
                continue;
            }
            let Ok(mut files) = tokio::fs::read_dir(r.path()).await else { continue };
            while let Ok(Some(f)) = files.next_entry().await {
                let fname = f.file_name().to_string_lossy().into_owned();
                let Some(name) = fname.strip_suffix(".html") else { continue };
                if !valid_id(name) {
                    continue;
                }
                if let Some(m) = mtime(&f.path()).await {
                    out.insert(Page::Chart(repo.clone(), name.to_string()), entry(m));
                }
            }
        }
    }
    out
}

/// Every `.html` file under `public/articles` as (`/articles/...` URL path, mtime).
async fn scan_articles(root: &FsPath) -> Vec<(String, SystemTime)> {
    let mut out = Vec::new();
    let mut stack = vec![(root.to_path_buf(), String::from("/articles"))];
    while let Some((dir, url)) = stack.pop() {
        let Ok(mut rd) = tokio::fs::read_dir(&dir).await else { continue };
        while let Ok(Some(e)) = rd.next_entry().await {
            let fname = e.file_name().to_string_lossy().into_owned();
            let plain = fname.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
            if fname.starts_with('.') || !plain {
                continue; // hidden files and names that would need URL-encoding
            }
            let Ok(ft) = e.file_type().await else { continue };
            let child = format!("{url}/{fname}");
            if ft.is_dir() {
                stack.push((e.path(), child));
            } else if fname.ends_with(".html") {
                let m = e.metadata().await.ok().and_then(|m| m.modified().ok()).unwrap_or_else(SystemTime::now);
                out.push((child, m));
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

impl App {
    fn page_path(&self, page: &Page) -> PathBuf {
        self.cfg.cache_dir.join(page.file())
    }

    fn sitemap_path(&self) -> PathBuf {
        self.cfg.cache_dir.join("sitemap.xml")
    }

    async fn read_cached(&self, page: &Page) -> Option<String> {
        if !self.index.read().unwrap().contains_key(page) {
            return None;
        }
        match tokio::fs::read_to_string(self.page_path(page)).await {
            Ok(s) => Some(s),
            Err(_) => {
                // file vanished: forget it so it gets regenerated
                self.index.write().unwrap().remove(page);
                None
            }
        }
    }

    fn is_cached(&self, page: &Page) -> bool {
        self.index.read().unwrap().contains_key(page)
    }

    fn lock_for(&self, page: &Page) -> Arc<tokio::sync::Mutex<()>> {
        self.locks.lock().unwrap().entry(page.clone()).or_default().clone()
    }

    fn release_lock(&self, page: &Page) {
        let mut m = self.locks.lock().unwrap();
        if let Some(l) = m.get(page) {
            if Arc::strong_count(l) == 1 {
                m.remove(page);
            }
        }
    }

    fn is_missing(&self, page: &Page) -> bool {
        let mut m = self.missing.lock().unwrap();
        match m.get(page) {
            Some(until) if *until > Instant::now() => true,
            Some(_) => {
                m.remove(page);
                false
            }
            None => false,
        }
    }

    fn mark_missing(&self, page: &Page) {
        let mut m = self.missing.lock().unwrap();
        if m.len() >= 10_000 {
            m.clear();
        }
        m.insert(page.clone(), Instant::now() + NEGATIVE_TTL);
    }

    async fn store(&self, page: &Page, html: &str) -> std::io::Result<()> {
        let path = self.page_path(page);
        if let Some(dir) = path.parent() {
            tokio::fs::create_dir_all(dir).await?;
        }
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let tmp = path.with_extension(format!("html.tmp{nanos}"));
        tokio::fs::write(&tmp, html).await?;
        tokio::fs::rename(&tmp, &path).await
    }

    fn remember(&self, page: &Page) {
        let now = SystemTime::now();
        self.index
            .write()
            .unwrap()
            .insert(page.clone(), Entry { lastmod: now, next_check: now + self.cfg.ttl });
    }

    /// Rebuilds sitemap.xml from the cached pages and the articles (atomic write).
    async fn write_sitemap(&self) {
        let _g = self.sitemap_lock.lock().await;
        let entries: Vec<(Page, SystemTime)> = {
            let idx = self.index.read().unwrap();
            idx.iter().map(|(k, e)| (k.clone(), e.lastmod)).collect()
        };
        let base = xml_esc(&self.cfg.base_url);
        let mut xml = String::from(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n",
        );
        for p in STATIC_URLS {
            xml.push_str(&format!("  <url><loc>{base}{p}</loc></url>\n"));
        }
        let articles = scan_articles(&self.cfg.public_dir.join("articles")).await;
        for (path, lm) in &articles {
            let date = DateTime::<Utc>::from(*lm).format("%Y-%m-%d");
            xml.push_str(&format!(
                "  <url><loc>{base}{}</loc><lastmod>{date}</lastmod></url>\n",
                xml_esc(path)
            ));
        }
        // Market < Repo < Chart, so the listing pages come first
        let budget = MAX_SITEMAP_URLS.saturating_sub(STATIC_URLS.len() + articles.len());
        for (page, lm) in entries.iter().take(budget) {
            let date = DateTime::<Utc>::from(*lm).format("%Y-%m-%d");
            xml.push_str(&format!(
                "  <url><loc>{base}{}</loc><lastmod>{date}</lastmod></url>\n",
                xml_esc(&page.url_path())
            ));
        }
        xml.push_str("</urlset>\n");

        let path = self.sitemap_path();
        let tmp = path.with_extension("xml.tmp");
        let res = async {
            if let Some(dir) = path.parent() {
                tokio::fs::create_dir_all(dir).await?;
            }
            tokio::fs::write(&tmp, xml).await?;
            tokio::fs::rename(&tmp, &path).await
        }
        .await;
        if let Err(e) = res {
            tracing::error!("writing sitemap failed: {e}");
        }
    }

    fn spawn_sitemap(self: &Arc<Self>) {
        let st = self.clone();
        tokio::spawn(async move { st.write_sitemap().await });
    }

    /// Fetches the data for a page and renders it.
    async fn build(&self, page: &Page) -> Result<Built, HubError> {
        let base = &self.cfg.base_url;
        match page {
            Page::Market => {
                let m = hub::fetch_market(&self.http).await?;
                let warm = m
                    .publishers
                    .iter()
                    .take(WARM_REPOS)
                    .map(|p| Page::Repo(p.repo.clone()))
                    .collect();
                Ok(Built { html: render::market_page(&m, base), warm })
            }
            Page::Repo(r) => {
                let rp = hub::fetch_repo(&self.http, r).await?;
                Ok(Built { html: render::repo_page(&rp, base), warm: Vec::new() })
            }
            Page::Chart(r, n) => {
                let c = hub::fetch_chart(&self.http, r, n).await?;
                Ok(Built { html: render::page(&c, base), warm: Vec::new() })
            }
        }
    }

    /// Generate and cache pages in the background, one at a time and politely spaced.
    fn warm(self: &Arc<Self>, pages: Vec<Page>) {
        if pages.is_empty() {
            return;
        }
        let st = self.clone();
        tokio::spawn(async move {
            // work queue: pages built here may name further pages to pre-generate (marketplace -> publishers)
            let mut queue: std::collections::VecDeque<Page> = pages.into();
            while let Some(p) = queue.pop_front() {
                if st.is_cached(&p) || st.is_missing(&p) {
                    continue;
                }
                let (_, more) = st.fill(&p).await;
                queue.extend(more);
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        });
    }

    /// Start a background refresh when a cached page is past its TTL.
    fn maybe_refresh(self: &Arc<Self>, page: &Page) {
        let now = SystemTime::now();
        let due = {
            let mut idx = self.index.write().unwrap();
            match idx.get_mut(page) {
                Some(e) if now >= e.next_check => {
                    e.next_check = now + RETRY; // claim it so concurrent requests don't pile on
                    true
                }
                _ => false,
            }
        };
        if !due {
            return;
        }
        let st = self.clone();
        let page = page.clone();
        tokio::spawn(async move { st.refresh(&page).await });
    }

    async fn refresh(self: &Arc<Self>, page: &Page) {
        let label = page.url_path();
        match self.build(page).await {
            Ok(built) => {
                let old = tokio::fs::read_to_string(self.page_path(page)).await.ok();
                if old.as_deref() == Some(built.html.as_str()) {
                    if let Some(e) = self.index.write().unwrap().get_mut(page) {
                        e.next_check = SystemTime::now() + self.cfg.ttl;
                    }
                } else {
                    match self.store(page, &built.html).await {
                        Ok(()) => {
                            self.remember(page);
                            self.spawn_sitemap();
                            tracing::info!("refreshed {label}");
                        }
                        Err(e) => tracing::error!("store {label} failed: {e}"),
                    }
                }
                self.warm(built.warm);
            }
            Err(HubError::NotFound) => {
                // gone upstream: drop the page and its sitemap entry
                tracing::warn!("{label} no longer exists on Artifact Hub, removing");
                let _ = tokio::fs::remove_file(self.page_path(page)).await;
                self.index.write().unwrap().remove(page);
                self.mark_missing(page);
                self.spawn_sitemap();
            }
            Err(HubError::Upstream(e)) => {
                tracing::warn!("refresh {label} failed, keeping stale page: {e}");
            }
        }
    }

    /// Builds and caches a page that is not cached yet. Concurrent callers share one upstream fetch.
    /// Does not spawn follow-up work itself, so it can be used from `warm`.
    async fn fill(self: &Arc<Self>, page: &Page) -> (Outcome, Vec<Page>) {
        let lock = self.lock_for(page);
        let guard = lock.clone().lock_owned().await;
        let res = self.fill_locked(page).await;
        drop(guard);
        drop(lock);
        self.release_lock(page);
        res
    }

    async fn fill_locked(self: &Arc<Self>, page: &Page) -> (Outcome, Vec<Page>) {
        if let Some(html) = self.read_cached(page).await {
            return (Outcome::Ok(html), Vec::new());
        }
        let label = page.url_path();
        match self.build(page).await {
            Ok(built) => {
                match self.store(page, &built.html).await {
                    Ok(()) => {
                        self.remember(page);
                        self.spawn_sitemap();
                        tracing::info!("generated {label}");
                    }
                    Err(e) => tracing::error!("store {label} failed: {e}"),
                }
                (Outcome::Ok(built.html), built.warm)
            }
            Err(HubError::NotFound) => {
                self.mark_missing(page);
                (Outcome::NotFound, Vec::new())
            }
            Err(HubError::Upstream(e)) => {
                tracing::warn!("fetch {label} failed: {e}");
                (Outcome::Upstream, Vec::new())
            }
        }
    }

    async fn serve(self: Arc<Self>, page: Page) -> Response {
        if let Some(html) = self.read_cached(&page).await {
            self.maybe_refresh(&page);
            return html_response(StatusCode::OK, html, CACHE_OK);
        }
        if self.is_missing(&page) {
            return not_found(&page);
        }
        let (outcome, warm) = self.fill(&page).await;
        self.warm(warm);
        match outcome {
            Outcome::Ok(html) => html_response(StatusCode::OK, html, CACHE_OK),
            Outcome::NotFound => not_found(&page),
            Outcome::Upstream => bad_gateway(),
        }
    }
}

/* ---------------- handlers ---------------- */

async fn market_route(State(st): State<Arc<App>>) -> Response {
    st.serve(Page::Market).await
}

async fn repo_route(State(st): State<Arc<App>>, Path(repo): Path<String>) -> Response {
    if !valid_id(&repo) {
        return invalid_link();
    }
    st.serve(Page::Repo(repo)).await
}

async fn chart_route(State(st): State<Arc<App>>, Path((repo, name)): Path<(String, String)>) -> Response {
    if !valid_id(&repo) || !valid_id(&name) {
        return invalid_link();
    }
    st.serve(Page::Chart(repo, name)).await
}

/// Old links (`chart.html?repo=..&name=..`) redirect to the clean route.
/// Without params the client-side page from PUBLIC_DIR is served as before.
async fn legacy_chart(State(st): State<Arc<App>>, Query(q): Query<HashMap<String, String>>) -> Response {
    if let (Some(repo), Some(name)) = (q.get("repo"), q.get("name")) {
        if valid_id(repo) && valid_id(name) {
            return Redirect::permanent(&format!("/helm/{repo}/{name}")).into_response();
        }
    }
    match tokio::fs::read_to_string(st.cfg.public_dir.join("chart.html")).await {
        Ok(html) => html_response(StatusCode::OK, html, "public, max-age=300"),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `/` is the landing page from PUBLIC_DIR/index.html.
async fn index_route(State(st): State<Arc<App>>) -> Response {
    match tokio::fs::read_to_string(st.cfg.public_dir.join("index.html")).await {
        Ok(html) => html_response(StatusCode::OK, html, "public, max-age=300"),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn sitemap_route(State(st): State<Arc<App>>) -> Response {
    let path = st.sitemap_path();
    let body = match tokio::fs::read_to_string(&path).await {
        Ok(s) => s,
        Err(_) => {
            st.write_sitemap().await;
            match tokio::fs::read_to_string(&path).await {
                Ok(s) => s,
                Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            }
        }
    };
    (
        [
            (header::CONTENT_TYPE, "application/xml; charset=utf-8"),
            (header::CACHE_CONTROL, "public, max-age=300"),
        ],
        body,
    )
        .into_response()
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let cfg = Config::from_env();

    let index = scan_cache(&cfg.cache_dir, cfg.ttl).await;
    tracing::info!("{} cached pages found", index.len());

    let http = reqwest::Client::builder()
        .user_agent("opentenant-server/0.1 (+https://opentenant.org)")
        .timeout(Duration::from_secs(15))
        .build()
        .expect("http client");

    let bind = cfg.bind;
    let public_dir = cfg.public_dir.clone();
    let state = Arc::new(App {
        cfg,
        http,
        index: RwLock::new(index),
        locks: Mutex::new(HashMap::new()),
        missing: Mutex::new(HashMap::new()),
        sitemap_lock: tokio::sync::Mutex::new(()),
    });
    state.write_sitemap().await; // make sure the file matches the cache on startup
    state.warm(vec![Page::Market]); // generate the marketplace (and its top publishers) in the background

    let articles_dir = public_dir.join("articles");
    let app = Router::new()
        .route("/", get(index_route))
        .nest_service("/articles", ServeDir::new(articles_dir).append_index_html_on_directories(true))
        .route("/marketplace", get(market_route))
        .route("/helm/{repo}", get(repo_route))
        .route("/helm/{repo}/{name}", get(chart_route))
        .route("/chart.html", get(legacy_chart))
        .route("/sitemap.xml", get(sitemap_route))
        .fallback_service(ServeDir::new(public_dir).append_index_html_on_directories(true))
        .layer(CompressionLayer::new())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(bind).await.expect("bind");
    tracing::info!("listening on http://{bind}");
    axum::serve(listener, app).await.expect("server");
}