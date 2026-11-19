//! OpenTenant chart server.
//!
//! - `GET /helm/{repo}/{name}`  static, cached chart page (generated on first request)
//! - `GET /chart.html?repo=&name=`  308 redirect to the clean route (or the client-side page without params)
//! - `GET /sitemap.xml`  rebuilt from the cached pages whenever one is created, refreshed or removed
//! - everything else is served from `PUBLIC_DIR` (index.html, builder.css, builder.js, ...)
//!
//! Env: BIND (0.0.0.0:8080), PUBLIC_DIR (public), CACHE_DIR (cache),
//!      BASE_URL (https://opentenant.org), CACHE_TTL_SECS (86400)

mod hub;
mod render;

use std::{
    collections::{BTreeMap, HashMap},
    net::SocketAddr,
    path::PathBuf,
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
use hub::HubError;
use tower_http::{compression::CompressionLayer, services::ServeDir};

const RETRY: Duration = Duration::from_secs(300);
const NEGATIVE_TTL: Duration = Duration::from_secs(600);
const MAX_SITEMAP_URLS: usize = 50_000;
const STATIC_URLS: &[&str] = &["/"];
const CACHE_OK: &str = "public, max-age=300, stale-while-revalidate=3600";

type Key = (String, String);

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

struct App {
    cfg: Config,
    http: reqwest::Client,
    index: RwLock<BTreeMap<Key, Entry>>,
    locks: Mutex<HashMap<Key, Arc<tokio::sync::Mutex<()>>>>,
    missing: Mutex<HashMap<Key, Instant>>,
    sitemap_lock: tokio::sync::Mutex<()>,
}

fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && !s.starts_with('.')
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
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

fn not_found_chart() -> Response {
    html_response(
        StatusCode::NOT_FOUND,
        render::message_page(
            "Chart not found",
            "Artifact Hub has no Helm chart with that name. Try one of these.",
        ),
        "public, max-age=60",
    )
}

/// Reads every `cache/helm/{repo}/{name}.html` into the index.
async fn scan_cache(cache_dir: &std::path::Path, ttl: Duration) -> BTreeMap<Key, Entry> {
    let mut out = BTreeMap::new();
    let Ok(mut repos) = tokio::fs::read_dir(cache_dir.join("helm")).await else {
        return out;
    };
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
            let Ok(meta) = f.metadata().await else { continue };
            let m = meta.modified().unwrap_or_else(|_| SystemTime::now());
            out.insert((repo.clone(), name.to_string()), Entry { lastmod: m, next_check: m + ttl });
        }
    }
    out
}

/// Every `.html` file under `public/articles` as (`/articles/...` URL path, mtime).
async fn scan_articles(root: &std::path::Path) -> Vec<(String, SystemTime)> {
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
    fn page_path(&self, key: &Key) -> PathBuf {
        self.cfg.cache_dir.join("helm").join(&key.0).join(format!("{}.html", key.1))
    }

    fn sitemap_path(&self) -> PathBuf {
        self.cfg.cache_dir.join("sitemap.xml")
    }

    async fn read_cached(&self, key: &Key) -> Option<String> {
        if !self.index.read().unwrap().contains_key(key) {
            return None;
        }
        match tokio::fs::read_to_string(self.page_path(key)).await {
            Ok(s) => Some(s),
            Err(_) => {
                // file vanished: forget it so it gets regenerated
                self.index.write().unwrap().remove(key);
                None
            }
        }
    }

    fn lock_for(&self, key: &Key) -> Arc<tokio::sync::Mutex<()>> {
        self.locks.lock().unwrap().entry(key.clone()).or_default().clone()
    }

    fn release_lock(&self, key: &Key) {
        let mut m = self.locks.lock().unwrap();
        if let Some(l) = m.get(key) {
            if Arc::strong_count(l) == 1 {
                m.remove(key);
            }
        }
    }

    fn is_missing(&self, key: &Key) -> bool {
        let mut m = self.missing.lock().unwrap();
        match m.get(key) {
            Some(until) if *until > Instant::now() => true,
            Some(_) => {
                m.remove(key);
                false
            }
            None => false,
        }
    }

    fn mark_missing(&self, key: &Key) {
        let mut m = self.missing.lock().unwrap();
        if m.len() >= 10_000 {
            m.clear();
        }
        m.insert(key.clone(), Instant::now() + NEGATIVE_TTL);
    }

    async fn store(&self, key: &Key, html: &str) -> std::io::Result<()> {
        let path = self.page_path(key);
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

    fn remember(&self, key: &Key) {
        let now = SystemTime::now();
        self.index
            .write()
            .unwrap()
            .insert(key.clone(), Entry { lastmod: now, next_check: now + self.cfg.ttl });
    }

    /// Rebuilds sitemap.xml from the index (atomic write).
    async fn write_sitemap(&self) {
        let _g = self.sitemap_lock.lock().await;
        let entries: Vec<(Key, SystemTime)> = {
            let idx = self.index.read().unwrap();
            idx.iter().map(|(k, e)| (k.clone(), e.lastmod)).collect()
        };
        let mut xml = String::from(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n",
        );
        for p in STATIC_URLS {
            xml.push_str(&format!("  <url><loc>{}{}</loc></url>\n", xml_esc(&self.cfg.base_url), p));
        }
        let articles = scan_articles(&self.cfg.public_dir.join("articles")).await;
        for (path, lm) in &articles {
            let date = DateTime::<Utc>::from(*lm).format("%Y-%m-%d");
            xml.push_str(&format!(
                "  <url><loc>{}{}</loc><lastmod>{}</lastmod></url>\n",
                xml_esc(&self.cfg.base_url),
                xml_esc(path),
                date
            ));
        }
        let budget = MAX_SITEMAP_URLS.saturating_sub(STATIC_URLS.len() + articles.len());
        for ((repo, name), lm) in entries.iter().take(budget) {
            let date = DateTime::<Utc>::from(*lm).format("%Y-%m-%d");
            xml.push_str(&format!(
                "  <url><loc>{}/helm/{}/{}</loc><lastmod>{}</lastmod></url>\n",
                xml_esc(&self.cfg.base_url),
                xml_esc(repo),
                xml_esc(name),
                date
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

    /// Serve a cached page; start a background refresh when it is past its TTL.
    fn maybe_refresh(self: &Arc<Self>, key: &Key) {
        let now = SystemTime::now();
        let due = {
            let mut idx = self.index.write().unwrap();
            match idx.get_mut(key) {
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
        let key = key.clone();
        tokio::spawn(async move { st.refresh(&key).await });
    }

    async fn refresh(self: &Arc<Self>, key: &Key) {
        match hub::fetch_chart(&self.http, &key.0, &key.1).await {
            Ok(chart) => {
                let html = render::page(&chart, &self.cfg.base_url);
                let old = tokio::fs::read_to_string(self.page_path(key)).await.ok();
                if old.as_deref() == Some(html.as_str()) {
                    if let Some(e) = self.index.write().unwrap().get_mut(key) {
                        e.next_check = SystemTime::now() + self.cfg.ttl;
                    }
                    return;
                }
                match self.store(key, &html).await {
                    Ok(()) => {
                        self.remember(key);
                        self.spawn_sitemap();
                        tracing::info!("refreshed {}/{}", key.0, key.1);
                    }
                    Err(e) => tracing::error!("store {}/{} failed: {e}", key.0, key.1),
                }
            }
            Err(HubError::NotFound) => {
                // chart was removed upstream: drop the page and its sitemap entry
                tracing::warn!("{}/{} no longer exists on Artifact Hub, removing", key.0, key.1);
                let _ = tokio::fs::remove_file(self.page_path(key)).await;
                self.index.write().unwrap().remove(key);
                self.mark_missing(key);
                self.spawn_sitemap();
            }
            Err(HubError::Upstream(e)) => {
                tracing::warn!("refresh {}/{} failed, keeping stale page: {e}", key.0, key.1);
            }
        }
    }

    async fn serve(self: Arc<Self>, key: Key) -> Response {
        if let Some(html) = self.read_cached(&key).await {
            self.maybe_refresh(&key);
            return html_response(StatusCode::OK, html, CACHE_OK);
        }
        if self.is_missing(&key) {
            return not_found_chart();
        }

        // single-flight: concurrent first requests for the same chart share one upstream fetch
        let lock = self.lock_for(&key);
        let guard = lock.clone().lock_owned().await;
        let resp = self.generate(&key).await;
        drop(guard);
        drop(lock);
        self.release_lock(&key);
        resp
    }

    async fn generate(self: &Arc<Self>, key: &Key) -> Response {
        if let Some(html) = self.read_cached(key).await {
            return html_response(StatusCode::OK, html, CACHE_OK);
        }
        match hub::fetch_chart(&self.http, &key.0, &key.1).await {
            Ok(chart) => {
                let html = render::page(&chart, &self.cfg.base_url);
                match self.store(key, &html).await {
                    Ok(()) => {
                        self.remember(key);
                        self.spawn_sitemap();
                        tracing::info!("generated {}/{}", key.0, key.1);
                    }
                    Err(e) => tracing::error!("store {}/{} failed: {e}", key.0, key.1),
                }
                html_response(StatusCode::OK, html, CACHE_OK)
            }
            Err(HubError::NotFound) => {
                self.mark_missing(key);
                not_found_chart()
            }
            Err(HubError::Upstream(e)) => {
                tracing::warn!("fetch {}/{} failed: {e}", key.0, key.1);
                html_response(
                    StatusCode::BAD_GATEWAY,
                    render::message_page(
                        "Could not load this chart",
                        "Artifact Hub could not be reached. Please try again in a moment.",
                    ),
                    "no-store",
                )
            }
        }
    }
}

/* ---------------- handlers ---------------- */

async fn chart_route(State(st): State<Arc<App>>, Path((repo, name)): Path<(String, String)>) -> Response {
    if !valid_id(&repo) || !valid_id(&name) {
        return html_response(
            StatusCode::NOT_FOUND,
            render::message_page(
                "That chart link is not valid",
                "Chart and repository names only use letters, numbers, dots, dashes and underscores.",
            ),
            "public, max-age=60",
        );
    }
    st.serve((repo, name)).await
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
    tracing::info!("{} cached chart pages found", index.len());

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

    let articles_dir = public_dir.join("articles");
    let app = Router::new()
        .route("/", get(index_route))
        .nest_service("/articles", ServeDir::new(articles_dir).append_index_html_on_directories(true))
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