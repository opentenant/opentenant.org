//! Static HTML rendering for a chart page.

use crate::hub::{Chart, Market, RepoPage, Summary};
use chrono::DateTime;
use pulldown_cmark::{html, CowStr, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

const TEMPLATE: &str = include_str!("../templates/chart.html");
const LIST_TEMPLATE: &str = include_str!("../templates/list.html");

pub fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&#39;"),
            _ => o.push(c),
        }
    }
    o
}

pub fn safe_url(u: &str) -> bool {
    let l = u.trim_start().to_ascii_lowercase();
    l.starts_with("http://") || l.starts_with("https://")
}

fn fmt_stars(n: i64) -> String {
    if n < 1000 {
        return n.to_string();
    }
    let v = n as f64 / 1000.0;
    let s = if n >= 10_000 { format!("{v:.0}") } else { format!("{v:.2}") };
    let s = if s.contains('.') {
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    } else {
        s
    };
    format!("{s}K")
}

/// Single-pass `{{KEY}}` substitution. Values are inserted verbatim and never re-scanned.
fn fill(tpl: &str, vars: &[(&str, String)]) -> String {
    let mut out = String::with_capacity(tpl.len() + 8192);
    let mut rest = tpl;
    while let Some(i) = rest.find("{{") {
        out.push_str(&rest[..i]);
        let after = &rest[i + 2..];
        match after.find("}}") {
            Some(j) => {
                let key = &after[..j];
                match vars.iter().find(|(k, _)| *k == key) {
                    Some((_, v)) => out.push_str(v),
                    None => {
                        out.push_str("{{");
                        out.push_str(key);
                        out.push_str("}}");
                    }
                }
                rest = &after[j + 2..];
            }
            None => {
                out.push_str(&rest[i..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// Markdown to HTML with raw HTML and images dropped, only http(s) links kept.
fn render_markdown(src: &str) -> String {
    let src: String = src.chars().take(14_000).collect();
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);

    let mut events: Vec<Event> = Vec::new();
    let mut link_stack: Vec<bool> = Vec::new();
    let mut in_image = 0usize;

    for ev in Parser::new_ext(&src, opts) {
        match ev {
            Event::Html(_) | Event::InlineHtml(_) => {}
            Event::Start(Tag::Image { .. }) => in_image += 1,
            Event::End(TagEnd::Image) => in_image = in_image.saturating_sub(1),
            _ if in_image > 0 => {}
            Event::Start(Tag::Link { dest_url, .. }) => {
                let ok = safe_url(&dest_url);
                link_stack.push(ok);
                if ok {
                    events.push(Event::Html(CowStr::from(format!(
                        r#"<a href="{}" target="_blank" rel="noopener noreferrer nofollow ugc">"#,
                        esc(&dest_url)
                    ))));
                }
            }
            Event::End(TagEnd::Link) => {
                if link_stack.pop().unwrap_or(false) {
                    events.push(Event::Html(CowStr::Borrowed("</a>")));
                }
            }
            // Keep one <h1> per page: README h1 becomes h2, the rest h3.
            Event::Start(Tag::Heading { level, .. }) => {
                let t = if level == HeadingLevel::H1 { "<h2>" } else { "<h3>" };
                events.push(Event::Html(CowStr::Borrowed(t)));
            }
            Event::End(TagEnd::Heading(level)) => {
                let t = if level == HeadingLevel::H1 { "</h2>" } else { "</h3>" };
                events.push(Event::Html(CowStr::Borrowed(t)));
            }
            other => events.push(other),
        }
    }
    let mut out = String::new();
    html::push_html(&mut out, events.into_iter());
    out
}

fn row(k: &str, v: &str, href: Option<&str>) -> String {
    if v.is_empty() {
        return String::new();
    }
    let dd = match href {
        Some(h) if safe_url(h) => format!(
            r#"<a href="{}" target="_blank" rel="noopener noreferrer">{}</a>"#,
            esc(h),
            esc(v)
        ),
        _ => esc(v),
    };
    format!("<dt>{}</dt><dd>{}</dd>", esc(k), dd)
}

fn token(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric() || "._+-".contains(*c))
        .collect()
}

fn script_json(v: &serde_json::Value) -> String {
    v.to_string()
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

pub fn page(c: &Chart, base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let canonical = format!("{base}/helm/{}/{}", c.repo, c.name);
    let title = format!("{} Helm chart: deploy with OpenTenant", c.name);
    let short_desc: String = c.description.chars().take(200).collect();
    let desc = format!(
        "{}Deploy {} as an isolated per-tenant release with OpenTenant.",
        if short_desc.is_empty() { String::new() } else { format!("{short_desc} ") },
        c.name
    );
    let publisher = if !c.publisher.is_empty() {
        c.publisher.as_str()
    } else if !c.repo.is_empty() {
        c.repo.as_str()
    } else {
        "unknown publisher"
    };

    // badges
    let mut bd: Vec<String> = vec![r#"<span class="bdg hc">Helm chart</span>"#.to_string()];
    let mut badge = |t: String| bd.push(format!(r#"<span class="bdg">{}</span>"#, esc(&t)));
    if c.stars > 0 {
        badge(format!("\u{2605} {}", fmt_stars(c.stars)));
    }
    if !c.version.is_empty() {
        badge(format!("v{}", c.version));
    }
    if !c.app_version.is_empty() {
        badge(format!("App {}", c.app_version));
    }
    if !c.license.is_empty() {
        badge(c.license.clone());
    }
    if c.verified {
        badge("Verified publisher".into());
    }
    if c.official {
        badge("Official".into());
    }
    if c.deprecated {
        badge("Deprecated".into());
    }
    let badges = bd.concat();

    let lede = if c.description.is_empty() {
        String::new()
    } else {
        format!(r#"<p class="lede">{}</p>"#, esc(&c.description))
    };

    let readme = if c.readme.trim().is_empty() {
        "<p>This chart has no README on Artifact Hub.</p>".to_string()
    } else {
        render_markdown(&c.readme)
    };

    // details
    let mut kv = String::new();
    kv.push_str(&row("Repository", &c.repo, if c.repo_url.is_empty() { None } else { Some(&c.repo_url) }));
    if !c.version.is_empty() {
        kv.push_str(&row("Chart version", &format!("v{}", c.version), None));
    }
    kv.push_str(&row("App version", &c.app_version, None));
    kv.push_str(&row("License", &c.license, None));
    if c.ts > 0 {
        if let Some(d) = DateTime::from_timestamp(c.ts, 0) {
            kv.push_str(&row("Updated", &d.format("%b %-d, %Y").to_string(), None));
        }
    }
    kv.push_str(&row("Maintainers", &c.maintainers.join(", "), None));
    if !c.home_url.is_empty() {
        let shown = c
            .home_url
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/');
        kv.push_str(&row("Homepage", shown, Some(&c.home_url)));
    }
    kv.push_str(&row(
        "Artifact Hub",
        "View listing",
        Some(&format!("https://artifacthub.io/packages/helm/{}/{}", c.repo, c.name)),
    ));
    for (name, url) in &c.links {
        let label = if name.is_empty() { "Link" } else { name.as_str() };
        let source = if name.is_empty() { url } else { name };
        let shown: String = source.chars().take(40).collect();
        kv.push_str(&row(label, &shown, Some(url)));
    }

    let tags: String = c.keywords.iter().map(|k| format!("<span>{}</span>", esc(k))).collect();

    // plain helm
    let rp = token(&c.repo);
    let nm = token(&c.name);
    let vr = token(&c.version);
    let helm_card = if !c.repo_url.is_empty() && !rp.is_empty() && !nm.is_empty() {
        let url: String = c
            .repo_url
            .chars()
            .filter(|ch| ch.is_ascii_alphanumeric() || "_:/.-~%?=&+@#".contains(*ch))
            .collect();
        let cmd = format!(
            "helm repo add {rp} '{url}'\nhelm repo update\nhelm install {nm} {rp}/{nm}{}",
            if vr.is_empty() { String::new() } else { format!(" --version {vr}") }
        );
        format!(
            r#"<aside class="glass" id="helmcard" aria-labelledby="h-helm"><h2 id="h-helm">Install with plain Helm</h2><div class="cmd"><pre id="helmcmd">{}</pre><button type="button" class="pl" id="helmcopy">Copy</button></div></aside>"#,
            esc(&cmd)
        )
    } else {
        String::new()
    };

    let deploy_p = format!(
        "Each tenant gets its own release of this chart, with its own namespace, secrets and domain. The builder below already has {} on a Hetzner server. Change the host, add apps from the marketplace, then copy the generated files. Providers and prices are samples, and nothing here is sent anywhere.",
        c.name
    );
    let pinned = if c.version.is_empty() {
        format!("{} is pinned", c.name)
    } else {
        format!("{} is pinned at v{}", c.name, c.version)
    };
    let steps_data = [
        ("Pick a server", "Connect Hetzner, OVHcloud or AWS. The builder starts on Hetzner, the cheapest sample rate.".to_string()),
        ("Place the chart", format!("{pinned} in opentenant.yaml. Drag more apps from the marketplace onto a rack.")),
        ("Apply", "Save opentenant.yaml and main.tf from the console, then run the commands below.".to_string()),
    ];
    let steps: String = steps_data
        .iter()
        .map(|(h, t)| format!("<li><b>{}</b>{}</li>", esc(h), esc(t)))
        .collect();

    let json = script_json(&serde_json::json!({
        "n": c.name, "repo": c.repo, "ver": c.version, "pub": publisher, "d": c.description
    }));

    fill(
        TEMPLATE,
        &[
            ("TITLE", esc(&title)),
            ("DESC", esc(&desc)),
            ("CANON", esc(&canonical)),
            ("NAME", esc(&c.name)),
            ("REPO", esc(&c.repo)),
            ("PUB", esc(publisher)),
            ("BADGES", badges),
            ("LEDE", lede),
            ("README", readme),
            ("DETAILS", kv),
            ("TAGS", tags),
            ("HELMCARD", helm_card),
            ("DEPLOY_P", esc(&deploy_p)),
            ("STEPS", steps),
            ("JSON", json),
        ],
    )
}

/* ---------------- listing pages ---------------- */

fn card(c: &Summary) -> String {
    let mut meta = vec![];
    if !c.publisher.is_empty() {
        meta.push(c.publisher.clone());
    }
    if c.stars > 0 {
        meta.push(format!("\u{2605} {}", fmt_stars(c.stars)));
    }
    if !c.version.is_empty() {
        meta.push(format!("v{}", c.version));
    }
    let mut desc: String = c.description.chars().take(140).collect();
    if c.description.chars().count() > 140 {
        desc.push('\u{2026}');
    }
    format!(
        r#"<a class="card" href="/helm/{r}/{n}"><span data-logo="{n}"></span><span class="ct"><b>{n}</b><em>{m}</em><span>{d}</span></span></a>"#,
        r = esc(&c.repo),
        n = esc(&c.name),
        m = esc(&meta.join(" \u{b7} ")),
        d = esc(&desc)
    )
}

fn badge(t: &str) -> String {
    format!(r#"<span class="bdg">{}</span>"#, esc(t))
}

struct ListPage<'a> {
    title: String,
    desc: String,
    canon: String,
    crumb: String,
    h1: &'a str,
    by: String,
    badges: String,
    lede: String,
    body: String,
    item_urls: Vec<String>,
    name: String,
}

fn list_page(p: ListPage) -> String {
    let jsonld = script_json(&serde_json::json!({
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": p.name,
        "url": p.canon,
        "description": p.desc,
        "mainEntity": {
            "@type": "ItemList",
            "itemListElement": p.item_urls.iter().enumerate().map(|(i, u)| serde_json::json!({
                "@type": "ListItem", "position": i + 1, "url": u
            })).collect::<Vec<_>>()
        }
    }));
    fill(
        LIST_TEMPLATE,
        &[
            ("TITLE", esc(&p.title)),
            ("DESC", esc(&p.desc)),
            ("CANON", esc(&p.canon)),
            ("JSONLD", jsonld),
            ("CRUMB", p.crumb),
            ("H1", esc(p.h1)),
            ("BY", esc(&p.by)),
            ("BADGES", p.badges),
            ("LEDE", esc(&p.lede)),
            ("BODY", p.body),
        ],
    )
}

const CRUMB_HOME: &str = r#"<a href="/">OpenTenant</a><span>/</span>"#;

/// Page for one repository (bitnami, hashicorp, ...).
pub fn repo_page(r: &RepoPage, base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let total = r.total.max(r.charts.len());
    let canon = format!("{base}/helm/{}", r.repo);

    let mut badges = badge("Helm repository");
    badges.push_str(&badge(&format!("{total} chart{}", if total == 1 { "" } else { "s" })));
    if r.verified {
        badges.push_str(&badge("Verified publisher"));
    }
    if r.official {
        badges.push_str(&badge("Official"));
    }

    let mut body = String::from(r#"<section class="sec"><h2>Charts</h2><div class="grid">"#);
    for c in &r.charts {
        body.push_str(&card(c));
    }
    body.push_str("</div>");
    let hub = format!("https://artifacthub.io/packages/search?repo={}", r.repo);
    let mut note = String::new();
    if total > r.charts.len() {
        note.push_str(&format!("Showing the {} most starred of {} charts. ", r.charts.len(), total));
    }
    note.push_str(&format!(r#"See the full listing on <a href="{}" target="_blank" rel="noopener noreferrer">Artifact Hub</a>"#, esc(&hub)));
    if safe_url(&r.repo_url) {
        note.push_str(&format!(
            r#" or browse the <a href="{}" target="_blank" rel="noopener noreferrer">chart repository</a>"#,
            esc(&r.repo_url)
        ));
    }
    note.push('.');
    body.push_str(&format!(r#"<p class="note">{note}</p></section>"#));

    list_page(ListPage {
        title: format!("{} Helm charts: deploy with OpenTenant", r.publisher),
        desc: format!(
            "Browse {total} Helm charts from {} and deploy any of them as an isolated per-tenant release with OpenTenant.",
            r.publisher
        ),
        canon,
        crumb: format!(
            r#"{CRUMB_HOME}<a href="/marketplace">Marketplace</a><span>/</span><span>{}</span>"#,
            esc(&r.repo)
        ),
        h1: &r.publisher,
        by: format!("Helm repository {}", r.repo),
        badges,
        lede: format!(
            "{total} Helm charts from {} on Artifact Hub. Pick one to read about it and deploy it as its own release for every tenant.",
            r.publisher
        ),
        body,
        item_urls: r.charts.iter().map(|c| format!("{base}/helm/{}/{}", c.repo, c.name)).collect(),
        name: format!("{} Helm charts", r.publisher),
    })
}

/// Page for the whole marketplace: popular publishers and charts.
pub fn market_page(m: &Market, base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');

    let mut body = String::from(r#"<section class="sec"><h2>Popular publishers</h2><div class="pubs">"#);
    for p in &m.publishers {
        body.push_str(&format!(
            r#"<a class="pub" href="/helm/{r}"><span data-logo="{n}"></span><b>{n}</b><em>{c} top chart{s}</em></a>"#,
            r = esc(&p.repo),
            n = esc(&p.name),
            c = p.charts,
            s = if p.charts == 1 { "" } else { "s" }
        ));
    }
    body.push_str(r#"</div></section><section class="sec"><h2>Popular charts</h2><div class="grid">"#);
    for c in &m.charts {
        body.push_str(&card(c));
    }
    body.push_str("</div></section>");

    let total = m.total.max(m.charts.len());
    list_page(ListPage {
        title: "Helm chart marketplace: deploy with OpenTenant".to_string(),
        desc: format!(
            "Browse {total} Helm charts from Artifact Hub, from Bitnami to HashiCorp, and deploy any of them as an isolated per-tenant release with OpenTenant."
        ),
        canon: format!("{base}/marketplace"),
        crumb: format!("{CRUMB_HOME}<span>Marketplace</span>"),
        h1: "Marketplace",
        by: "Helm charts from Artifact Hub".to_string(),
        badges: badge(&format!("{total} charts")),
        lede: "Pick a chart, read what it does and deploy it as its own release for every tenant. The most starred charts and publishers are listed here.".to_string(),
        body,
        item_urls: m.charts.iter().map(|c| format!("{base}/helm/{}/{}", c.repo, c.name)).collect(),
        name: "OpenTenant Helm chart marketplace".to_string(),
    })
}

/// Small standalone page for 404 / 502 / invalid links.
pub fn message_page(title: &str, text: &str) -> String {
    let examples = [
        ("kube-prometheus-stack", "prometheus-community"),
        ("redis", "bitnami"),
        ("postgresql", "bitnami"),
        ("cert-manager", "cert-manager"),
    ];
    let links: String = examples
        .iter()
        .map(|(n, r)| format!(r#"<a href="/helm/{r}/{n}">{n}</a>"#))
        .collect();
    format!(
        r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{t} | OpenTenant</title><meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="/builder.css">
<style>.ex{{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}}.ex a{{padding:8px 16px;border-radius:999px;background:#fff;color:#0b2fb8;font-weight:800;text-decoration:none}}</style>
</head><body>
<nav class="onav" aria-label="Main"><div class="onav-in"><a href="/" class="onav-brand"><img src="/favicon.svg" width="34" height="34" alt="">OpenTenant</a></div></nav>
<main class="page"><h1 class="chero" style="font-size:clamp(2rem,5.5vw,3.8rem);margin:0">{t}</h1><p class="lede">{x}</p><div class="ex">{links}</div></main>
</body></html>"#,
        t = esc(title),
        x = esc(text),
        links = links
    )
}