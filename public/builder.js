/* OpenTenant builder: 3D block background, console, rack scene, marketplace drawer, Artifact Hub search.
   Shared by index.html and chart.html. Needs builder.css.

   OpenTenantBuilder.init({ mode: 'overlay' })                                 index.html: fixed overlay that opens on scroll
   OpenTenantBuilder.init({ mode: 'inline', mount: '#builder', pin: chart })   chart.html: builder inside the page, chart pre-placed
                 optional: chartHref(repo, name) -> URL of a chart page (default: chartUrl + '?repo=..&name=..')
   OpenTenantBuilder.getChart(repo, name)  -> Promise<chart>   (Artifact Hub, falls back to the snapshot)
   OpenTenantBuilder.renderMarkdown(text)  -> DocumentFragment (safe: DOM nodes only, never innerHTML)
   OpenTenantBuilder.logo(name, size)      -> <span class="lg"> element
*/
(function () {
  'use strict';
  var OT = window.OpenTenantBuilder = {};
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches), m = reduce ? 0 : 1;
  var HUB = 'https://artifacthub.io/api/v1/packages/';

  /* ---------- helpers ---------- */
  function E(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null && txt !== '') e.textContent = txt; return e; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
  function safeId(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9._-]/g, ''); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }
  function pad(s, n) { while (s.length < n) s += ' '; return s; }
  function fmt(n) { return '$' + (n >= 100 ? Math.round(n) : n.toFixed(2)); }
  function fmtStars(n) {
    if (typeof n !== 'number') return String(n);
    if (n < 1000) return String(n);
    var s = (n / 1000).toFixed(n >= 10000 ? 0 : 2);
    return (s.indexOf('.') > -1 ? s.replace(/\.?0+$/, '') : s) + 'K';
  }
  function hashN(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; }
  OT.safeUrl = safeUrl; OT.fmtStars = fmtStars;

  /* ---------- logos (simplified marks; swap in official assets for production) ---------- */
  var LG = {
    GitHub: ['#181717', '<path fill="#fff" d="M6.5 7.5l2.6 1.8h5.8l2.6-1.8v5a5.5 5.5 0 0 1-11 0z"/><circle cx="9.7" cy="12.2" r="1" fill="#181717"/><circle cx="14.3" cy="12.2" r="1" fill="#181717"/>'],
    GitLab: ['#fc6d26', '<path fill="#fff" d="M12 20 3.5 13.8l2-6.3 2.2 5.5h8.6l2.2-5.5 2 6.3z"/>'],
    Supabase: ['#0f2a1f', '<path fill="#3ecf8e" d="M13.5 3 5 13.5h6L10.5 21 19 10.5h-6z"/>'],
    Mattermost: ['#145dbf', '<circle cx="12" cy="12" r="6" fill="none" stroke="#fff" stroke-width="2.4"/><circle cx="12" cy="12" r="1.6" fill="#fff"/>'],
    ffmpeglab: ['#7c3aed', '<rect x="5" y="6" width="14" height="12" rx="2.5" fill="none" stroke="#fff" stroke-width="2"/><path fill="#fff" d="M10.5 9.5v5l4-2.5z"/>'],
    Keycloak: ['#008aaa', '<circle cx="9" cy="12" r="3.5" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M12.5 12H20M17 12v3" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>'],
    Vault: ['#111111', '<path fill="#ffcf25" d="M4 5.5h16L12 19.5z"/>'],
    Vercel: ['#000000', '<path fill="#fff" d="M12 5.5 20 19H4z"/>'],
    Netlify: ['#00ad9f', '<path fill="#fff" d="M12 4l7 8-7 8-7-8z"/>'],
    Cloudflare: ['#f6821f', '<path fill="#fff" d="M7 17h10.2a3.6 3.6 0 0 0 .4-7.2A5.2 5.2 0 0 0 7.8 11 3.1 3.1 0 0 0 7 17z"/>'],
    AWS: ['#232f3e', '<path d="M5 14.5c4.5 3 9.5 3 14 0" fill="none" stroke="#ff9900" stroke-width="2" stroke-linecap="round"/><path d="M8 11V9.5M12 11V7M16 11V9" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'],
    'Google Cloud Run': ['#4285f4', '<path fill="#fff" d="M8 6l11 6-11 6z"/>'],
    DigitalOcean: ['#0080ff', '<circle cx="12" cy="12" r="4" fill="#fff"/><rect x="6" y="16" width="3" height="3" fill="#fff"/><rect x="4" y="13" width="2.2" height="2.2" fill="#fff"/>'],
    'Fly.io': ['#6d28d9', '<path fill="#fff" d="M4 11.5 20 5l-4.5 14-3.5-5.5z"/>'],
    Pi: ['#2b2b2b', '<path d="M6 8.5h12M9 8.5v8M15 8.5v8" stroke="#fff" stroke-width="2.2" stroke-linecap="round" fill="none"/>'],
    Terraform: ['#7b42bc', '<path fill="#fff" d="M5 5l5 3v6l-5-3z"/><path fill="#fff" opacity=".85" d="M11 8l5 3v6l-5-3z"/><path fill="#fff" opacity=".7" d="M11 1.5l5 3V10l-5-3z"/>'],
    OVHcloud: ['#123f6d', '<circle cx="12" cy="12" r="5.5" fill="none" stroke="#fff" stroke-width="2.4"/>'],
    Hetzner: ['#d50c2d', '<path d="M8 6.5v11M16 6.5v11M8 12h8" stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none"/>']
  };
  var logoNames = Object.keys(LG);
  var CATC = { 'Monitoring and logging': '#f58220', 'Security': '#e0457b', 'Integration and delivery': '#7c5cff', 'Networking': '#14b8a6', 'Database': '#3ecf8e', 'none': '#64748b' };
  var PALS = ['#7c5cff', '#14b8a6', '#f58220', '#e0457b', '#3ecf8e', '#2f6bff', '#d97706', '#64748b'];
  var KNOWN_COL = { Keycloak: '#00a5c9', Vault: '#ffcf25', vault: '#ffcf25', 'acme-web': '#64748b', 'acme-api': '#64748b', 'Cloudflare tunnel': '#f6821f' };
  function colorFor(n) { return KNOWN_COL[n] || PALS[hashN(String(n)) % PALS.length]; }
  function lgDef(n) {
    if (LG[n]) return LG[n];
    var key = Object.keys(LG).filter(function (k) { return k.toLowerCase() === String(n).toLowerCase(); })[0];
    if (key) return (LG[n] = LG[key]);
    var w = String(n).split(/[-_ .]+/).filter(Boolean), ini = (w.length > 1 ? w[0].charAt(0) + w[1].charAt(0) : String(n).slice(0, 2)).toUpperCase();
    return (LG[n] = [colorFor(n), '<text x="12" y="16" text-anchor="middle" font-size="10.5" font-weight="800" fill="#fff" font-family="system-ui,sans-serif">' + esc(ini) + '</text>']);
  }
  function logo(n, sz) {
    var d = lgDef(n), e = E('span', 'lg');
    e.style.cssText = '--s:' + sz + 'px;background:' + d[0];
    e.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + d[1] + '</svg>';
    e.setAttribute('aria-hidden', 'true'); return e;
  }
  OT.logo = logo;

  /* ---------- Artifact Hub snapshot: most popular Helm charts (kind=0), Nov 18, 2026 ---------- */
  var CHARTS = [
    { n: 'kube-prometheus-stack', pub: 'Prometheus', repo: 'prometheus-community', st: '1.24K', up: '1 day ago', ver: '93.3.1', cat: 'Monitoring and logging', d: 'Kubernetes manifests, Grafana dashboards and Prometheus rules combined into one monitoring stack.' },
    { n: 'cert-manager', pub: 'cert-manager', repo: 'cert-manager', st: '999', up: '26 days ago', ver: '1.21.3', cat: 'Security', d: 'A Helm chart for cert-manager, which issues and renews TLS certificates.' },
    { n: 'argo-cd', pub: 'Argo Project', repo: 'argo', st: '866', up: 'about 2 hours ago', ver: '10.18.1', cat: 'Integration and delivery', d: 'Declarative GitOps continuous delivery for Kubernetes.' },
    { n: 'ingress-nginx', pub: 'Kubernetes', repo: 'ingress-nginx', st: '814', up: '8 months ago', ver: '4.15.1', cat: 'Networking', d: 'Ingress controller that uses NGINX as a reverse proxy and load balancer.' },
    { n: 'prometheus', pub: 'Prometheus', repo: 'prometheus-community', st: '559', up: '7 days ago', ver: '29.47.2', cat: 'Monitoring and logging', d: 'A monitoring system and time series database.' },
    { n: 'redis', pub: 'Bitnami', repo: 'bitnami', st: '507', up: '14 days ago', ver: '28.3.12', cat: 'Database', d: 'An open source, advanced key-value store, often called a data structure server.' },
    { n: 'traefik', pub: 'Traefik Labs', repo: 'traefiklabs', st: '432', up: 'about 23 hours ago', ver: '42.4.1', cat: 'Networking', d: 'A Traefik based Kubernetes ingress controller.' },
    { n: 'postgresql', pub: 'Bitnami', repo: 'bitnami', st: '431', up: '2 days ago', ver: '18.12.20', cat: 'Database', d: 'An open source object-relational database known for reliability and data integrity.' },
    { n: 'kubernetes-dashboard', pub: 'Helm', repo: 'k8s-dashboard', st: '365', up: 'about 1 year ago', ver: '7.14.0', cat: '', d: 'General-purpose web UI for Kubernetes clusters.' },
    { n: 'loki', pub: 'Grafana', repo: 'grafana', st: '332', up: '8 days ago', ver: '7.6.0', cat: 'Monitoring and logging', d: 'Grafana Enterprise Logs chart with monolithic, simple scalable and microservices modes.' },
    { n: 'metrics-server', pub: 'Kubernetes SIGs', repo: 'metrics-server', st: '320', up: '3 months ago', ver: '3.14.0', cat: 'Monitoring and logging', d: 'A scalable, efficient source of container resource metrics for Kubernetes autoscaling.' },
    { n: 'vault', pub: 'HashiCorp', repo: 'hashicorp', st: '299', up: '3 months ago', ver: '0.34.1', cat: 'Security', d: 'The official HashiCorp Vault chart.' }
  ];
  var META = {};   /* chart name -> { repo, ver, pub, d } for everything the visitor can see or place */
  CHARTS.forEach(function (c) { KNOWN_COL[c.n] = CATC[c.cat || 'none']; META[c.n] = { repo: c.repo, ver: c.ver, pub: c.pub, d: c.d }; });
  KNOWN_COL.vault = '#ffcf25';

  /* ---------- Artifact Hub: one chart ---------- */
  function normalizePkg(p) {
    var r = p.repository || {};
    return {
      n: p.name, repo: r.name || '', repoUrl: safeUrl(r.url),
      pub: r.organization_display_name || r.user_alias || r.display_name || r.name || '',
      verified: !!r.verified_publisher, official: !!r.official,
      ver: p.version || '', appVer: p.app_version || '', st: typeof p.stars === 'number' ? p.stars : 0,
      d: p.description || '', readme: p.readme || '', home: safeUrl(p.home_url), license: p.license || '',
      keywords: Array.isArray(p.keywords) ? p.keywords.slice(0, 12) : [],
      maintainers: (p.maintainers || []).map(function (x) { return x && x.name; }).filter(Boolean).slice(0, 6),
      links: (p.links || []).filter(function (l) { return l && safeUrl(l.url); }).slice(0, 6),
      deprecated: !!p.deprecated, ts: p.ts || 0, cat: ''
    };
  }
  function snapChart(repo, name) {
    var c = CHARTS.filter(function (x) { return x.n === name && (!repo || x.repo === repo); })[0];
    if (!c) return null;
    return { n: c.n, repo: c.repo, repoUrl: '', pub: c.pub, verified: false, official: false, ver: c.ver, appVer: '', st: c.st, d: c.d, readme: '', home: '', license: '', keywords: [], maintainers: [], links: [], deprecated: false, ts: 0, cat: c.cat, offline: true };
  }
  OT.getChart = function (repo, name) {
    var url = HUB + 'helm/' + encodeURIComponent(repo) + '/' + encodeURIComponent(name);
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; } return r.json(); })
      .then(normalizePkg)
      .catch(function (err) { var s = snapChart(repo, name); if (s) return s; throw err; });
  };

  /* ---------- tiny safe markdown: builds DOM nodes, drops raw HTML and images ---------- */
  function mdInline(parent, s) {
    var re = /(`[^`]+`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)/g, last = 0, x;
    while ((x = re.exec(s))) {
      if (x.index > last) parent.appendChild(document.createTextNode(s.slice(last, x.index)));
      if (x[1]) parent.appendChild(E('code', '', x[1].slice(1, -1)));
      else if (x[2]) { var a = E('a', '', x[3]); a.href = x[4]; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.appendChild(a); }
      else parent.appendChild(E('strong', '', x[6]));
      last = re.lastIndex;
    }
    if (last < s.length) parent.appendChild(document.createTextNode(s.slice(last)));
  }
  OT.renderMarkdown = function (src) {
    var frag = document.createDocumentFragment(), lines = String(src || '').slice(0, 14000).split(/\r?\n/), para = [], list = null, fence = null, tbl = [], hn;
    function flushP() { if (para.length) { var p = E('p'); mdInline(p, para.join(' ')); frag.appendChild(p); para = []; } }
    function flushL() { list = null; }
    function flushT() { if (tbl.length) { var pre = E('pre'); pre.appendChild(E('code', '', tbl.join('\n'))); frag.appendChild(pre); tbl = []; } }
    lines.forEach(function (raw) {
      var l = raw.replace(/\s+$/, ''), mm;
      if (fence) {
        if (/^\s*```/.test(l)) { var pre = E('pre'); pre.appendChild(E('code', '', fence.join('\n'))); frag.appendChild(pre); fence = null; }
        else fence.push(l);
        return;
      }
      if (/^\s*```/.test(l)) { flushP(); flushL(); flushT(); fence = []; return; }
      if (/^\s*\|/.test(l)) { flushP(); flushL(); tbl.push(l); return; } else flushT();
      if (!l.trim()) { flushP(); flushL(); return; }
      if (/^\s*</.test(l) || /^\s*!\[/.test(l) || /^\s*\[!\[/.test(l)) return;
      if ((mm = /^(#{1,6})\s+(.*)$/.exec(l))) { flushP(); flushL(); hn = E(mm[1].length === 1 ? 'h2' : 'h3'); mdInline(hn, mm[2].replace(/#+\s*$/, '')); frag.appendChild(hn); return; }
      if ((mm = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(l))) {
        flushP();
        var ord = /\d/.test(mm[1]);
        if (!list || list.ord !== ord) { list = { el: E(ord ? 'ol' : 'ul'), ord: ord }; frag.appendChild(list.el); }
        var li = E('li'); mdInline(li, mm[2]); list.el.appendChild(li); return;
      }
      flushL(); para.push(l.trim());
    });
    if (fence) { var pf = E('pre'); pf.appendChild(E('code', '', fence.join('\n'))); frag.appendChild(pf); }
    flushP(); flushT();
    return frag;
  };

  /* ---------- sample hosting model ---------- */
  var HOSTR = { Hetzner: [3.2, .9, .05], OVHcloud: [4, 1.1, .06], AWS: [24, 3.2, .11] };   /* $ per vCPU, GB RAM, GB disk per month */
  var HRES = { Hetzner: 'hcloud_server', OVHcloud: 'ovh_cloud_project_instance', AWS: 'aws_instance' };
  var PROVS = { Hetzner: ['hcloud', 'hetznercloud/hcloud'], OVHcloud: ['ovh', 'ovh/ovh'], AWS: ['aws', 'hashicorp/aws'] };
  var PCOL = { Hetzner: '#d50c2d', OVHcloud: '#0b1f6b', AWS: '#2b3a4d' };
  var PORD = ['AWS', 'Hetzner', 'OVHcloud'];
  var PROF = { 'kube-prometheus-stack': [2, 4, 50], 'cert-manager': [.1, .2, 0], 'argo-cd': [.5, 1, 5], 'ingress-nginx': [.2, .3, 0], prometheus: [1, 2, 30], redis: [.25, .5, 8], traefik: [.2, .25, 0], postgresql: [1, 2, 40], 'kubernetes-dashboard': [.1, .2, 0], loki: [1, 2, 50], 'metrics-server': [.1, .2, 0], vault: [.5, 1, 10], Keycloak: [1, 1.5, 10], Vault: [.5, 1, 10], Otari: [.5, .5, 5], 'Cloudflare tunnel': [.1, .1, 0] };
  var PLATFORM = [{ n: 'Keycloak', pub: 'Keycloak', d: 'Single sign-on, one realm per tenant' }, { n: 'Vault', pub: 'HashiCorp', d: 'One secrets path and policy per tenant' }, { n: 'Otari', pub: 'Mozilla AI', d: 'One endpoint for your coding agent' }];
  var HIGH = 25;
  var RIP = { Hetzner: '203.0.113.10', OVHcloud: '198.51.100.20', AWS: '192.0.2.30' };   /* sample public IPs from the documentation ranges (RFC 5737) */
  var DNSP = {
    Cloudflare: { logo: 'Cloudflare', src: ['cloudflare', 'cloudflare/cloudflare'], res: 'cloudflare_record', col: '#f6821f' },
    'Route 53': { logo: 'AWS', src: ['aws', 'hashicorp/aws'], res: 'aws_route53_record', col: '#8c4fff' },
    'Hetzner DNS': { logo: 'Hetzner', src: ['hcloud', 'hetznercloud/hcloud'], res: 'hcloud_zone_rrset', col: '#d50c2d' },
    'OVHcloud DNS': { logo: 'OVHcloud', src: ['ovh', 'ovh/ovh'], res: 'ovh_domain_zone_record', col: '#123f6d' }
  };
  var DNSORD = ['Cloudflare', 'Route 53', 'Hetzner DNS', 'OVHcloud DNS'];
  function contIp(h, k) { return '10.42.' + (PORD.indexOf(h) + 1) + '.' + (10 + k); }
  function lbl(s) { return slug(s).replace(/^-+|-+$/g, '') || 'app'; }
  function cleanZone(z) { return String(z || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''); }
  function okZone(z) { return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(z); }
  function appCost(n, h) { var pf = PROF[n] || [.3, .5, 5], r = HOSTR[h]; return pf[0] * r[0] + pf[1] * r[1] + pf[2] * r[2]; }
  function cheapest(n) { var b = null; Object.keys(HOSTR).forEach(function (h) { var c = appCost(n, h); if (!b || c < b.c) b = { h: h, c: c }; }); return b; }
  function isHigh(n, h) { return appCost(n, h) > HIGH && cheapest(n).h !== h; }

  /* ---------- example files shown in the console ---------- */
  var FILES = {
    'opentenant.yaml': `# opentenant-iot-property.yaml
name: "Metropolitan Commercial Plaza"
infrastructureId: "smart-building-berlin-01"
version: "4.2.0"

# 1. CORE BUILDING PLATFORM SERVICES (Landlord Infrastructure)
platform:
  facility_domain: "building01.propops.io"
  vault_root_path: "secret/data/propops/core"
  services:
    - id: "central-hvac-chiller"
      engine: "bacnet-ip" # Native building automation protocol
      template_ref: "git::https://github.com"
      vault_mount: "secret/data/propops/core/hvac-auth"
      dependencies: [] # Foundation layer

    - id: "lobby-access-gateway"
      engine: "mqtt-stream"
      template_ref: "git::https://github.com"
      vault_mount: "secret/data/propops/core/door-keys"
      dependencies: []

# 2. WHITELABEL TENANT SPACES (Leased Suites & Isolated IoT Footprints)
tenants:
  - id: "suite-301-medical-clinic"
    enabled: true
    vault_tenant_path: "secret/data/propops/tenants/suite-301"

    # The physical and digital space assignment
    userspace:
      physical_zone: "floor-3/suite-301"
      allocated_hardware_gateways: ["gw-fx-301a"]
      mqtt_topic_isolated_namespace: "building01/tenant/suite301/#"
      custom_branding:
        tenant_portal_display: "Alpha Medical Care"
        emergency_contact: "+49-30-555-0192"

    # The physical "deployments" inside the tenant's space pulled from standard profiles
    deployments:
      - id: "clinic-climate-control"
        engine: "zigbee-edge-profile"
        template_ref: "registry://iot-profiles/commercial/medical-temp-standard"
        # Custom parameters applied directly over the standard template for this physical lease
        config_patches:
          target_daytime_temp_celsius: 21.5
          humidity_strict_limit_pct: 50  # Crucial for medical supply storage
          operating_hours: "07:00-19:00"
        dependencies:
          - "central-hvac-chiller" # Overriding dependency: local airflow relies on main chiller loop

      - id: "clinic-smart-locks"
        engine: "assabloy-ip-lock"
        template_ref: "registry://iot-profiles/security/restricted-commercial-access"
        config_patches:
          auto_lock_delay_seconds: 5
          duress_code_enabled: true
        dependencies:
          - "lobby-access-gateway" # Dependency: Main lobby`,
    'lease.yaml': `Lease_Agreement:
  Tenant: "Tenant-Alpha-Finance"

  Demised_Premises:
    Suite_Number: "/home/tenant-alpha"      # Isolated physical boundary
    Security_Zone: "tenant-alpha-prod"      # Network/K8s fencing

  Standard_Fixtures_Ordered:
    - Item: "Core Banking Engine"
      Blueprint_Model: "git::banking-core"   # The architect's blueprint
      Tenant_Alteration:                     # The custom tenant fit-out
        Wall_Color: "Dark-Emerald"
        Electrical_Amps: "3 Phases"

  Utility_Hookups:
    - Connect_To: "Plaza-Central-Database"  # Siphoning from the main building

  Security_Clearance:
    Master_Key_Safe: "vault/tenants/alpha"   # Where they keep their private vault combinations`
  };
  var TABS = ['main.tf', 'dns.tf', 'opentenant.yaml', 'lease.yaml'];

  /* =====================================================================================
     init
     ===================================================================================== */
  OT.init = function (opts) {
    opts = opts || {};
    if (OT._ready) return; OT._ready = true;
    var mode = opts.mode === 'inline' ? 'inline' : 'overlay';
    var chartUrl = opts.chartUrl || 'chart.html';
    var body = document.body;
    var pin = opts.pin && opts.pin.n ? opts.pin : null;
    if (pin) META[pin.n] = { repo: pin.repo, ver: pin.ver, pub: pin.pub, d: pin.d };
    var container = null;
    if (mode === 'inline') {
      container = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
      if (!container) { if (window.console) console.error('OpenTenantBuilder: mount element not found'); OT._ready = false; return; }
      container.classList.add('builder', 'live');
    }
    var drawerHost = container || body;

    /* ---------- 3D block background ---------- */
    var PAL = [['#ffa400', '#0a1f7a'], ['#00a8ec', '#06185e'], ['#ee3b3b', '#ffffff'], ['#f9e50f', '#0a1f7a'], ['#f2f5fb', '#0a1f7a'], ['#d9dadb', '#0a1f7a']];
    var FACES = ['ft', 'fb', 'fl', 'fr', 'fu', 'fd'], YL = null, bgMax = mode === 'inline' ? .45 : 1;
    var stage = E('div'); stage.id = 'stage'; var scene = E('div'); scene.id = 'scene'; stage.appendChild(scene);
    var scrim = E('div', 'scrim');
    body.insertBefore(stage, body.firstChild); body.insertBefore(scrim, stage.nextSibling);
    function ySnip(i) {
      if (!YL) YL = (FILES['opentenant.yaml'] + '\n' + FILES['lease.yaml']).split('\n').filter(function (l) { var q = l.trim(); return q && q.charAt(0) !== '#' && q.length <= 34; });
      var a = (i * 5) % (YL.length - 3), ls = YL.slice(a, a + 3), mi = 99;
      ls.forEach(function (l) { mi = Math.min(mi, l.length - l.replace(/^\s+/, '').length); });
      return ls.map(function (l) { return l.slice(mi).replace(/\s+#.*$/, ''); }).join('\n');
    }
    function spot() {
      var w = Math.max(window.innerWidth, 360), h = window.innerHeight, x, y, n = 0;
      do { x = (Math.random() - .5) * w * 1.7; y = (Math.random() - .5) * h * 1.6; n++; }
      while (Math.abs(x) < w * .28 && Math.abs(y) < h * .2 && n < 30);
      return { x: x, y: y, z: -700 + Math.random() * 900 };
    }
    var tiles = [];
    function mkTile(i) {
      var el = E('div', 'tile'), p = spot(), pc = PAL[Math.random() * PAL.length | 0], front = null, s = (window.innerWidth < 600 ? 60 : 80) + Math.random() * 80, hh = s * (.7 + Math.random() * .5);
      el.style.setProperty('--c', pc[0]); el.style.setProperty('--ink', pc[1]);
      el.style.setProperty('--d', (40 + Math.random() * 80).toFixed(0) + 'px');
      FACES.forEach(function (f) { var fe = E('div', 'f ' + f); el.appendChild(fe); if (f === 'ft') front = fe; });
      el.setAttribute('aria-hidden', 'true');
      el.style.width = s + 'px'; el.style.height = hh + 'px'; el.style.marginLeft = -s / 2 + 'px'; el.style.marginTop = -hh / 2 + 'px';
      el.style.setProperty('--w', s + 'px'); el.style.setProperty('--h', hh + 'px');
      if (i % 3 === 0) front.appendChild(logo(logoNames[(i / 3 | 0) % logoNames.length], s < 70 ? 26 : 34));
      else if (i % 2 === 0) { front.classList.add('yq'); front.appendChild(E('pre', 'y', ySnip(i))); }
      scene.appendChild(el);
      tiles.push({ el: el, x: p.x, y: p.y, z: p.z, ph: Math.random() * 6.28, sp: .2 + Math.random() * .5, ax: 20 + Math.random() * 50, ay: 20 + Math.random() * 50, az: 30 + Math.random() * 80, rx: Math.random() * 360, ry: Math.random() * 360, rsx: (Math.random() - .5) * 28, rsy: (Math.random() - .5) * 28, op: 1, q: -1 });
    }
    var NT = Math.min(40, Math.round(window.innerWidth / 30) + 16);
    for (var ti = 0; ti < NT; ti++) mkTile(ti);
    var px = 0, py = 0, cx = 0, cy = 0;
    window.addEventListener('pointermove', function (e) { px = e.clientX / window.innerWidth - .5; py = e.clientY / window.innerHeight - .5; });
    function bgTick(dt, T) {
      cx += (px - cx) * .05; cy += (py - cy) * .05;
      scene.style.transform = 'rotateY(' + (cx * 14 + Math.sin(T * .15) * 5 * m) + 'deg) rotateX(' + (-cy * 10) + 'deg)';
      for (var i = 0; i < tiles.length; i++) {
        var t = tiles[i], a = T * t.sp + t.ph;
        t.rx += t.rsx * dt * m; t.ry += t.rsy * dt * m;
        var x = t.x + Math.sin(a) * t.ax * m, y = t.y + Math.cos(a * .8) * t.ay * m, z = t.z + Math.sin(a * .6) * t.az * m;
        t.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,' + z.toFixed(1) + 'px) rotateX(' + t.rx.toFixed(1) + 'deg) rotateY(' + t.ry.toFixed(1) + 'deg)';
        var ot = Math.min(bgMax, Math.max(.25, Math.min(1, (z + 800) / 900)));
        t.op += (ot - t.op) * .08;
        var q = Math.round(t.op * 20) / 20; if (q !== t.q) { t.q = q; t.el.style.setProperty('--o', q); }
      }
    }

    /* ---------- builder markup ---------- */
    var mainHtml =
      '<aside id="term" aria-label="Terraform console">' +
      '<div class="tbar"><button type="button" class="tab on" id="tab0">main.tf</button><button type="button" class="tab" id="tab1">dns.tf</button><button type="button" class="tab" id="tab2">opentenant.yaml</button><button type="button" class="tab" id="tab3">lease.yaml</button><button type="button" id="addprov2" class="rp">+ Server</button><button type="button" id="adddns2" class="rp rp2">+ DNS</button></div>' +
      '<div class="edw" id="edw"><pre class="gut" id="gut" aria-hidden="true"></pre><pre class="ed" id="ed"></pre>' +
      '<div class="empty" id="empty"><b id="emptyT"></b><span id="emptyS"></span><div class="erow"><button type="button" class="cta" id="addprov">+ Connect a server provider</button><button type="button" class="cta alt" id="adddns">+ Connect a DNS provider</button></div></div></div>' +
      '<div class="tm"><pre id="tm"></pre></div></aside>' +
      '<div id="infra"><div class="zbar" id="zbar"></div><div class="tot" id="tot"></div>' +
      '<canvas id="cv" role="img" aria-label="Infrastructure: service boxes stacked on server racks, linked by light rays from a Cloudflare tunnel"></canvas></div>' +
      '<button type="button" id="dtog" aria-label="Toggle marketplace menu">Marketplace</button>' +
      '<aside id="drawer" aria-label="Marketplace menu">' +
      '<div class="dh"><span>Marketplace</span><button type="button" class="pl" id="dx" aria-label="Close menu">&times;</button></div>' +
      '<div class="dt"><button type="button" class="tab on" id="dt0">Apps</button><button type="button" class="tab" id="dt1">Platform</button><button type="button" class="tab" id="dt2">Repos</button><button type="button" class="tab" id="dt3">DNS</button></div>' +
      '<div class="dsearch" id="searchWrap"><input id="chartSearch" type="search" placeholder="Search Helm charts on Artifact Hub" aria-label="Search Helm charts" autocomplete="off" spellcheck="false"><span class="dstat" id="searchStatus" role="status" aria-live="polite"></span></div>' +
      '<div class="dl" id="dlist"></div>' +
      '<div class="dsrc" id="dsrc"></div></aside>' +
      '<div id="warn" role="status"></div>';
    var overHtml =
      '<div id="picker" role="dialog" aria-modal="true" aria-label="Connect a server provider"><div class="pk" id="pk"></div></div><div id="ghost"></div>';
    var tmp = E('div'); tmp.innerHTML = mainHtml;
    if (mode === 'overlay') { var bg = E('div'); bg.id = 'tfbg'; body.appendChild(bg); }
    while (tmp.firstChild) (container || body).appendChild(tmp.firstChild);
    var tmp2 = E('div'); tmp2.innerHTML = overHtml; while (tmp2.firstChild) body.appendChild(tmp2.firstChild);
    function $(id) { return document.getElementById(id); }
    var edEl = $('ed'), gutEl = $('gut'), tmEl = $('tm'), edw = $('edw'), emptyEl = $('empty'), cv = $('cv'), g = cv.getContext('2d');
    var dlist = $('dlist'), ghost = $('ghost'), picker = $('picker'), pk = $('pk'), warnEl = $('warn'), zbar = $('zbar'), dsrc = $('dsrc'), emptyT = $('emptyT'), emptyS = $('emptyS'), totEl = $('tot');
    var searchWrap = $('searchWrap'), searchEl = $('chartSearch'), sstatEl = $('searchStatus'), infraEl = $('infra');

    /* ---------- state ---------- */
    var shared = { dns: null, records: [], place: {}, order: [], provs: [] }, RID = 0;
    var WS = { on: false, drawer: false, tab: 'apps', warn: null, tip: null, choose: null, rec: null, gh: false, gl: false, over: -1, drag: null };
    var TM = { raw: '', n: 0, typing: false, tl: [], T: 0, info: null, file: 'main.tf', seen: {} };
    var ZM = { rack: 0, t: 0, target: 0 }, ROWS2D = [], HV2 = -1;

    function placed() { return shared.order.filter(function (n) { return shared.place[n]; }); }
    function total() {
      var t = 0, apps = placed();
      apps.forEach(function (n) { t += appCost(n, shared.place[n]); });
      return t;
    }
    function place(n, h) {
      var had = WS.warn && WS.warn.n === n;
      if (!shared.place[n]) shared.order.push(n);
      shared.place[n] = h; WS.tip = null; WS.choose = null; syncRec(n, h);
      if (isHigh(n, h)) WS.warn = { n: n, h: h, c: appCost(n, h), alt: cheapest(n) };
      else if (had) { WS.warn = null; WS.tip = 'moved'; }
      refresh();
    }
    function unplace(n) {
      delete shared.place[n]; shared.order = shared.order.filter(function (q) { return q !== n; });
      shared.records = shared.records.filter(function (r) { return r.svc !== n; });
      if (WS.warn && WS.warn.n === n) WS.warn = null;
      refresh();
    }
    function connectProvider(h) {
      if (shared.provs.indexOf(h) > -1) return;
      shared.provs.push(h);
      if (shared.provs.length === 1) { setDrawer(true); WS.tip = 'conn1'; }
      refresh();
    }
    function quickPlace(n) {
      if (!shared.provs.length) { openPicker(); return; }
      if (shared.provs.length === 1) { place(n, shared.provs[0]); return; }
      WS.choose = n; renderToast();
    }
    function refresh() { tf(); renderDrawer(); renderToast(); renderEmpty(); updateTot(); }
    function updateTot() { totEl.textContent = placed().length ? 'Total ' + fmt(total()) + '/mo (sample rates)' : 'No apps placed yet'; }
    function rackIp(h) { return RIP[h]; }
    function fqdn(r) { return (r.host && r.host !== '@' ? r.host + '.' : '') + shared.dns.zone; }
    function uniqHost(base) {
      var h = base, i = 2;
      while (shared.records.some(function (r) { return r.host === h; })) h = base + '-' + i++;
      return h;
    }
    /* every placed app gets a hostname that follows its rack, until the visitor points it at another IP */
    function syncRec(n, h) {
      if (!shared.dns) return;
      var r = shared.records.filter(function (x) { return x.svc === n; })[0];
      if (!r) shared.records.push({ id: ++RID, host: uniqHost(lbl(n)), ip: rackIp(h), svc: n, auto: true });
      else if (r.auto) r.ip = rackIp(h);
    }
    function connectDns(prov, zone) {
      shared.dns = { prov: prov, zone: zone }; shared.records = [];
      placed().forEach(function (n) { syncRec(n, shared.place[n]); });
      WS.tab = 'dns'; WS.tip = 'dns1'; setDrawer(true); setFile('dns.tf'); refresh();
    }
    function addRecord() {
      if (!shared.dns || !shared.provs.length) return;
      shared.records.push({ id: ++RID, host: uniqHost('www'), ip: rackIp(shared.provs[0]), svc: null, auto: false });
      refresh();
    }

    /* ---------- generated files ---------- */
    function tmplRef(n) {
      var mt = META[n];
      if (mt && mt.repo) return 'registry://artifacthub.io/' + safeId(mt.repo) + '/' + safeId(n) + (mt.ver ? '@' + safeId(mt.ver) : '');
      return 'registry://platform/' + slug(n);
    }
    function genYaml() {
      var apps = placed(), L = ['# opentenant.yaml', 'name: "Acme"', 'infrastructureId: "acme-eu-01"', 'version: "1.0.0"', '',
        'platform:', '  facility_domain: "' + (shared.dns ? shared.dns.zone : 'acme.example.com') + '"', '  vault_root_path: "secret/data/acme/core"', '  services: []', '',
        'tenants:', '  - id: "tenant-a"', '    enabled: true', '    vault_tenant_path: "secret/data/acme/tenants/tenant-a"', '',
        '    userspace:', '      namespace: "tenant-a"', '      custom_branding:', '        portal_display: "Tenant A"', '',
        '    deployments:' + (apps.length ? '' : ' []')];
      apps.forEach(function (n, i) {
        if (i) L.push('');
        L.push('      - id: "' + slug(n) + '"', '        engine: "' + (META[n] && META[n].repo ? 'helm-chart' : 'platform') + '"', '        template_ref: "' + tmplRef(n) + '"',
          '        config_patches:', '          # values.yaml overrides, applied to this tenant only', '          fullnameOverride: "tenant-a-' + slug(n) + '"', '        dependencies: []');
        var doms = shared.dns ? shared.records.filter(function (r) { return r.svc === n; }).map(function (r) { return '"' + fqdn(r) + '"'; }) : [];
        if (doms.length) L.push('        domains: [' + doms.join(', ') + ']');
      });
      return L.join('\n');
    }
    function recIds() {
      var seen = {};
      return shared.records.map(function (r) {
        var base = lbl(r.host === '@' ? 'root' : r.host), id = base, k = 2;
        while (seen[id]) id = base + '-' + k++;
        seen[id] = 1; return id;
      });
    }
    function dnsText() {
      var d = shared.dns; if (!d) return '';
      var L = ['# DNS records for ' + d.zone + ' on ' + d.prov + ' (sample)', ''], ids = recIds();
      if (d.prov === 'Cloudflare' || d.prov === 'Route 53') L.push('variable "zone_id" {', '  type = string', '}', '');
      if (!shared.records.length) L.push('# no records yet: add one in the DNS tab of the marketplace menu');
      shared.records.forEach(function (r, i) {
        var host = r.host && r.host !== '@' ? r.host : '@', name = DNSP[d.prov].res;
        L.push('resource "' + name + '" "' + ids[i] + '" {');
        if (d.prov === 'Cloudflare') L.push('  zone_id = var.zone_id', '  name    = "' + host + '"', '  type    = "A"', '  content = "' + r.ip + '"');
        else if (d.prov === 'Route 53') L.push('  zone_id = var.zone_id', '  name    = "' + fqdn(r) + '"', '  type    = "A"', '  ttl     = 300', '  records = ["' + r.ip + '"]');
        else if (d.prov === 'Hetzner DNS') L.push('  zone    = "' + d.zone + '"', '  name    = "' + host + '"', '  type    = "A"', '  records = [{ value = "' + r.ip + '" }]');
        else L.push('  zone      = "' + d.zone + '"', '  subdomain = "' + (host === '@' ? '' : host) + '"', '  fieldtype = "A"', '  target    = "' + r.ip + '"', '  ttl       = 300');
        L.push('}', '');
      });
      return L.join('\n').replace(/\n+$/, '');
    }
    function fileText() {
      if (TM.file === 'main.tf') return TM.info ? TM.info.text : '';
      if (TM.file === 'dns.tf') return dnsText();
      if (TM.file === 'opentenant.yaml' && mode === 'inline') return genYaml();
      return FILES[TM.file];
    }
    function tfInfo() {
      var provs = shared.provs, apps = placed(), res = [], L = [], warns = [];
      apps.forEach(function (n) { if (isHigh(n, shared.place[n])) warns.push({ n: n, h: shared.place[n], c: appCost(n, shared.place[n]) }); });
      if (!provs.length) return { text: '', res: res, count: 0, empty: true, apps: apps, warns: warns };
      L.push('terraform {', '  required_providers {');
      var seenP = {}, plist = provs.map(function (h) { return PROVS[h]; });
      if (shared.dns) plist.push(DNSP[shared.dns.prov].src);
      plist.forEach(function (pr) { if (seenP[pr[0]]) return; seenP[pr[0]] = 1; L.push('    ' + pad(pr[0], 10) + ' = { source = "' + pr[1] + '" }'); });
      L.push('  }', '}', '');
      provs.forEach(function (h) {
        var on = apps.filter(function (n) { return shared.place[n] === h; });
        L.push('module "rack_' + slug(h) + '" {', '  source = "./modules/rack"', '  host   = "' + slug(h) + '"', '  apps   = [' + on.map(function (q) { return '"' + slug(q) + '"'; }).join(', ') + ']', '}', '');
        res.push(HRES[h] + '.rack_' + slug(h));
        on.forEach(function (n) { res.push('helm_release.' + slug(n)); });
      });
      if (shared.dns) recIds().forEach(function (id) { res.push(DNSP[shared.dns.prov].res + '.' + id); });
      if (apps.length) res.push('keycloak_realm.tenant', 'vault_mount.tenant');
      return { text: L.join('\n').replace(/\n+$/, ''), res: res, count: res.length, empty: false, apps: apps, warns: warns };
    }
    function hlTf(s) {
      return esc(s).replace(/(#.*$)|("[^"\n]*")|\b(terraform|required_providers|module|resource|provider|variable)\b|\b([a-z_]+)(?=\s*=)/gm, function (x, c, st, k, a) {
        return c ? '<span class="c">' + c + '</span>' : st ? '<span class="s">' + st + '</span>' : k ? '<span class="k">' + k + '</span>' : '<span class="a">' + a + '</span>';
      });
    }
    function hlYaml(s) {
      return esc(s).replace(/(#.*$)|("[^"\n]*")|^(\s*(?:-\s+)?)([A-Za-z_][\w-]*)(?=:)|\b(true|false)\b|\b(\d+(?:\.\d+)?)\b/gm, function (x, c, st, pre, key, b, n) {
        return c ? '<span class="c">' + c + '</span>' : st ? '<span class="s">' + st + '</span>' : key ? pre + '<span class="a">' + key + '</span>' : b ? '<span class="k">' + b + '</span>' : '<span class="n">' + n + '</span>';
      });
    }
    function paintEd() {
      var s = TM.raw.slice(0, Math.floor(TM.n)), tot = Math.max(1, TM.raw.split('\n').length), gn = [];
      for (var i = 1; i <= tot; i++) gn.push(i);
      edEl.innerHTML = (/\.tf$/.test(TM.file) ? hlTf(s) : hlYaml(s)) + (TM.typing ? '<span class="cur"></span>' : '');
      gutEl.textContent = gn.join('\n');
      if (TM.typing) edw.scrollTop = edw.scrollHeight;
    }
    function tmLines(info) {
      var L;
      if (mode === 'inline') {
        L = ['$ opentenant validate opentenant.yaml', '  ✓ 1 tenant, ' + info.apps.length + ' deployment' + (info.apps.length === 1 ? '' : 's')];
        info.apps.slice(0, 4).forEach(function (n) { L.push('  ✓ ' + slug(n) + ' from ' + tmplRef(n).replace('registry://', '')); });
        if (shared.dns) L.push('  ✓ ' + shared.records.length + ' DNS record' + (shared.records.length === 1 ? '' : 's') + ' on ' + shared.dns.prov);
        L.push('$ terraform plan');
      } else {
        L = ['$ opentenant validate opentenant.yaml', '  ✓ 2 platform services, 1 tenant, 2 deployments', '  ✓ vault path secret/data/propops/tenants/suite-301',
          '  ✓ clinic-climate-control needs central-hvac-chiller', '  ✓ clinic-smart-locks needs lobby-access-gateway', '$ terraform plan'];
      }
      if (info.empty) { L.push('  nothing to plan yet: connect a server provider'); return L; }
      info.res.forEach(function (r) { L.push('  + ' + r); });
      L.push('Plan: ' + info.count + ' to add, 0 to change, 0 to destroy.');
      info.warns.forEach(function (w) { L.push('  ! ' + w.n + ' on ' + w.h.toLowerCase() + ' costs ' + fmt(w.c) + '/mo (high)'); });
      return L;
    }
    function tmHtml(ls) {
      return ls.map(function (l) {
        var c = l.charAt(0) === '$' ? 'tw' : ((l.indexOf('  +') === 0 || l.indexOf('  ✓') === 0) ? 'tg2' : (l.indexOf('  !') === 0 ? 'tr' : (l.indexOf('Plan:') === 0 ? 'ty' : '')));
        return '<span class="' + c + '">' + esc(l) + '</span>';
      }).join('\n');
    }
    function renderEmpty() {
      var dnsTab = TM.file === 'dns.tf', show = (TM.file === 'main.tf' && TM.info && TM.info.empty) || (dnsTab && !shared.dns);
      emptyEl.style.display = show ? 'flex' : 'none';
      if (!show) return;
      emptyT.textContent = dnsTab ? 'No DNS provider yet' : 'Nothing to apply yet';
      emptyS.textContent = dnsTab ? 'Connect one, then point domains at the IP addresses of your servers.' : (shared.dns ? 'Connect a server provider to get IP addresses for your domains.' : 'Connect a server provider and a DNS provider to start.');
      $('addprov').style.display = dnsTab ? 'none' : '';
      $('adddns').style.display = shared.dns ? 'none' : '';
    }
    function setFile(f) {
      TM.file = f; TM.raw = fileText();
      TABS.forEach(function (n, i) { var b = $('tab' + i); if (b) b.classList.toggle('on', n === f); });
      TM.typing = false; TM.n = (TM.seen[f] || !TM.raw) ? TM.raw.length : 0; paintEd(); renderEmpty();
    }
    function tf() {
      var info = tfInfo(); TM.info = info; TM.tl = tmLines(info);
      TM.raw = fileText();
      if (TM.seen[TM.file] || !TM.raw) { TM.n = TM.raw.length; TM.typing = false; paintEd(); }
      tmEl.innerHTML = tmHtml(TM.tl);
      sceneBuild(); renderZbar(); a11y();
    }
    TABS.forEach(function (n, i) { $('tab' + i).addEventListener('click', function () { setFile(n); }); });

    /* ---------- isometric infrastructure picture ---------- */
    var cw = 0, ch = 0, dpr = 1, U = 40, OX = 0, OY = 0, ST = 0;
    var SC = { cubes: [], rays: [], labs: [], pils: [], racks: [], svc: [], tower: null };
    var PLAT = { x: -3.8, y: -1.2, z: -.25, w: 12.4, d: 5.6, h: .25, c: '#dfe7f5' };
    var HV = { i: 0, until: 0 }, IMG = {};
    function logoImg(n) {
      if (IMG[n]) return IMG[n];
      var d = lgDef(n), im = new Image();
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="' + d[0] + '"/>' + d[1] + '</svg>');
      IMG[n] = im; return im;
    }
    function mix(h, t, a) {
      var p = function (s) { return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]; }, A = p(h), B = p(t);
      return 'rgb(' + A.map(function (v, i) { return Math.round(v + (B[i] - v) * a); }).join(',') + ')';
    }
    function al(col, a) { return col.replace('rgb(', 'rgba(').replace(')', ',' + a + ')'); }
    function lum(h) { return (.2126 * parseInt(h.slice(1, 3), 16) + .7152 * parseInt(h.slice(3, 5), 16) + .0722 * parseInt(h.slice(5, 7), 16)) / 255; }
    function sh(n) { n = n.toLowerCase(); return n.length > 9 ? n.slice(0, 8) + '\u2026' : n; }
    function P(x, y, z) { return [(x - y) * .866 * U + OX, (x + y) * .5 * U - z * U + OY]; }
    function poly(pts, fill, sk) {
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath();
      g.fillStyle = fill; g.fill(); g.strokeStyle = sk || 'rgba(0,0,40,.28)'; g.lineWidth = sk ? 1.5 : 1; g.stroke();
    }
    function dot(p, r) { g.beginPath(); g.arc(p[0], p[1], r * U / 40, 0, 6.283); g.fill(); }
    function facesOf(c) {
      var x = c.x, y = c.y, z = c.z, w = c.w, d = c.d, h = c.h;
      return [[P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], [P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)], [P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)]];
    }
    function inPoly(qx, qy, pts) {
      var ins = false;
      for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        if (((pts[i][1] > qy) !== (pts[j][1] > qy)) && (qx < (pts[j][0] - pts[i][0]) * (qy - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0])) ins = !ins;
      }
      return ins;
    }
    function cube(c) {
      var x = c.x, y = c.y, z = c.z, w = c.w, d = c.d, h = c.h, f = facesOf(c);
      if (c.ghost) {
        var a = WS.over === c.rk ? .3 : .07;
        g.save(); g.setLineDash([4, 3]);
        f.forEach(function (q) { poly(q, 'rgba(255,255,255,' + a + ')', 'rgba(255,255,255,.5)'); });
        g.restore(); return;
      }
      var zl = c.glass ? z + .22 : z + h * .5;
      poly(f[0], c.glass ? al(mix(c.c, '#ffffff', .35), .3) : mix(c.c, '#ffffff', .3), c.glass ? 'rgba(255,255,255,.6)' : 0);
      poly(f[1], c.glass ? al(mix(c.c, '#ffffff', .1), .42) : c.c, c.glass ? 'rgba(255,255,255,.6)' : 0);
      poly(f[2], c.glass ? al(mix(c.c, '#000000', .2), .55) : mix(c.c, '#000000', .3), c.glass ? 'rgba(255,255,255,.6)' : 0);
      if (c.svc) {
        var o = P(x, y + d, z + h), dk = lum(c.c) > .5;
        g.save(); g.setTransform(dpr * .866 * U / 100, dpr * .5 * U / 100, 0, dpr * U / 100, dpr * o[0], dpr * o[1]);
        g.font = '700 14px ui-monospace,SFMono-Regular,Menlo,monospace'; g.textBaseline = 'top'; g.textAlign = 'left';
        g.fillStyle = dk ? 'rgba(10,31,122,.7)' : 'rgba(255,255,255,.7)'; g.fillText('id:', 8, 8);
        g.fillStyle = dk ? '#0a1f7a' : '#ffffff'; g.fillText(sh(c.svc), 8, 26);
        g.fillStyle = c.high ? 'rgba(200,30,30,.95)' : 'rgba(0,0,0,.4)'; g.fillRect(4, 46, 84, 20);
        g.fillStyle = '#ffffff'; g.fillText((c.high ? '! ' : '') + fmt(c.cost) + '/mo', 8, 49);
        g.restore();
      }
      if (c.led) {
        g.fillStyle = Math.sin(ST * 3 + c.x * 7 + c.z * 5) > -.3 ? '#4ade80' : '#14532d'; dot(P(x + .22, y + d, zl), 2.4);
        g.fillStyle = Math.sin(ST * 5 + c.z * 9 + c.x) > 0 ? '#fbbf24' : '#78350f'; dot(P(x + .42, y + d, zl), 2.4);
        var s = P(x + .8, y + d, zl), e = P(x + w - .2, y + d, zl);
        g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(s[0], s[1]); g.lineTo(e[0], e[1]); g.stroke();
      }
    }
    function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    function pill(x, y, txt, ln, bg) {
      var fs = Math.max(11, Math.min(14, U * .3));
      g.font = '800 ' + fs + 'px "Bricolage Grotesque",system-ui,sans-serif';
      var tw = g.measureText(txt).width, im = ln ? logoImg(ln) : null, lw = im ? fs + 6 : 0, w = tw + lw + 16, h = fs + 11, x0 = x - w / 2, y0 = y - h / 2;
      g.fillStyle = bg || 'rgba(255,255,255,.96)'; rr(x0, y0, w, h, h / 2); g.fill();
      if (im && im.complete && im.naturalWidth) g.drawImage(im, x0 + 6, y0 + (h - fs - 3) / 2, fs + 3, fs + 3);
      g.fillStyle = bg ? '#ffffff' : '#0a1f7a'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(txt, x0 + 8 + lw, y + .5);
    }
    function bz(a, c, b, t) { var u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; }
    function sizeCv() {
      var r = cv.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2); cw = r.width; ch = r.height;
      cv.width = Math.max(1, Math.round(cw * dpr)); cv.height = Math.max(1, Math.round(ch * dpr));
    }
    function fit() {
      if (!cw) return;
      var mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, ex = [PLAT, { x: -2.6, y: 1.2, z: 0, w: 1.2, d: 1.2, h: 2.6 }], i;
      for (i = 0; i < 3; i++) ex.push({ x: i * 2.5, y: 0, z: 0, w: 2.4, d: 2.4, h: 4.4 });
      ex.forEach(function (c) {
        for (var a = 0; a < 2; a++) for (var b = 0; b < 2; b++) for (var d = 0; d < 2; d++) {
          var x = c.x + a * c.w, y = c.y + b * c.d, z = c.z + d * c.h, sx = (x - y) * .866, sy = (x + y) * .5 - z;
          mnx = Math.min(mnx, sx); mxx = Math.max(mxx, sx); mny = Math.min(mny, sy); mxy = Math.max(mxy, sy);
        }
      });
      U = Math.max(10, Math.min(70, (cw - 50) / (mxx - mnx), (ch - 190) / (mxy - mny)));
      OX = cw / 2 - (mnx + mxx) / 2 * U; OY = ch / 2 - (mny + mxy) / 2 * U + 50;
    }
    function svcYaml(c) {
      var n = c.svc, s = slug(n);
      return ['- id: "' + s + '"', '  engine: "' + (META[n] && META[n].repo ? 'helm-chart' : 'platform') + '"', '  host: "' + slug(c.host) + '"', '  ip: ' + c.ip, '  vault_mount: "secret/data/acme/' + s + '"', '  monthly_usd: ' + c.cost.toFixed(2)];
    }
    function sceneBuild() {
      var cubes = [], rays = [], labs = [], pils = [], racks = [], svc = [], dn = shared.dns;
      var tw = { x: -2.6, y: 1.2, z: 0, w: 1.2, d: 1.2, h: 2.6, c: dn ? DNSP[dn.prov].col : '#8a96a8', ord: 0 }; cubes.push(tw);
      var from = [tw.x + .6, tw.y + .6, tw.h];
      labs.push({ x: from[0], y: from[1], z: from[2], t: dn ? dn.prov + ' \u00b7 ' + dn.zone : 'DNS: not connected', l: dn ? DNSP[dn.prov].logo : 'Cloudflare', dy: -36 });
      shared.provs.forEach(function (h, i) {
        var pxx = i * 2.5, on = placed().filter(function (n) { return shared.place[n] === h; }), units = Math.max(2, Math.floor(on.length / 2) + 1), UH = 1.1, base = 1 + i * 100,
          rk = { h: h, i: i, px: pxx, top: units * UH, sub: 0, n: on.length, ip: rackIp(h), items: [], extra: [] };
        on.forEach(function (n, k) {
          var u = Math.floor(k / 2), j = k % 2, cost = appCost(n, h);
          var c = { x: pxx + [.2, 1.3][j], y: .75, z: u * UH + .12, w: .9, d: .9, h: .8, c: colorFor(n), svc: n, host: h, si: svc.length, cost: cost, high: isHigh(n, h), ip: contIp(h, k), ord: base + u * 10 + j };
          cubes.push(c); svc.push(c); rk.sub += cost;
          rk.items.push({ n: n, ip: c.ip, cost: cost, color: c.c, high: c.high, domains: [], cube: c });
        });
        for (var s = on.length; s < units * 2; s++) { var u2 = Math.floor(s / 2), j2 = s % 2; cubes.push({ x: pxx + [.2, 1.3][j2], y: .75, z: u2 * UH + .12, w: .9, d: .9, h: .8, ghost: 1, rk: i, c: '#ffffff', ord: base + u2 * 10 + j2 }); }
        for (var u3 = 0; u3 < units; u3++) cubes.push({ x: pxx, y: 0, z: u3 * UH, w: 2.4, d: 2.4, h: UH - .04, c: PCOL[h], led: 1, glass: 1, ord: base + u3 * 10 + 5 });
        racks.push(rk); pils.push({ h: h, x: pxx + 1.2, y: 2.95, rk: rk });
      });
      /* a domain points at an IP and shows on the rack that owns that IP: on the container's row when it is that container's own record */
      if (dn) shared.records.forEach(function (r) {
        var rk = racks.filter(function (k) { return k.ip === r.ip; })[0]; if (!rk) return;
        var it = r.svc ? rk.items.filter(function (x) { return x.n === r.svc; })[0] : null, nm = fqdn(r);
        if (it) it.domains.push(nm); else rk.extra.push(nm);
        rays.push({ f: from, t: it ? [it.cube.x + .45, it.cube.y + .45, it.cube.z + it.cube.h] : [rk.px + 1.2, 1.2, rk.top], ph: rays.length * .137 });
      });
      cubes.sort(function (a, b) { return a.ord - b.ord; });
      SC = { cubes: cubes, rays: rays, labs: labs, pils: pils, racks: racks, svc: svc, tower: tw };
    }
    function callout() {
      if (!SC.svc.length) return;
      var n = SC.svc.length, i = HV.until > ST ? HV.i : Math.floor(ST / 3.5) % n, c = SC.svc[i];
      if (!c) return;
      var p = P(c.x + c.w / 2, c.y + c.d / 2, c.z + c.h), lines = svcYaml(c), fs = 11, f = facesOf(c)[0];
      g.strokeStyle = c.high ? 'rgba(255,120,110,.95)' : 'rgba(255,236,160,.95)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(f[0][0], f[0][1]);
      for (var k = 1; k < 4; k++) g.lineTo(f[k][0], f[k][1]);
      g.closePath(); g.stroke();
      g.font = '600 ' + fs + 'px ui-monospace,SFMono-Regular,Menlo,monospace';
      var lw = 0; lines.forEach(function (l) { lw = Math.max(lw, g.measureText(l).width); });
      var w = lw + 24, h = lines.length * (fs + 5) + 16, x = Math.max(8, Math.min(cw - w - 8, p[0] + 18)), y = Math.max(8, Math.min(ch - h - 8, p[1] - h - 34));
      g.strokeStyle = 'rgba(255,236,160,.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(x + 12, y + h); g.stroke();
      g.fillStyle = '#0d1117'; rr(x, y, w, h, 10); g.fill(); g.strokeStyle = '#30363d'; g.lineWidth = 1; g.stroke();
      g.textBaseline = 'top'; g.textAlign = 'left';
      lines.forEach(function (l, r) {
        var mm = /^(\s*-?\s*)([a-z_]+)(:)(.*)$/.exec(l), qx = x + 12, qy = y + 8 + r * (fs + 5);
        if (!mm) { g.fillStyle = '#c9d1d9'; g.fillText(l, qx, qy); return; }
        [[mm[1], '#8b949e'], [mm[2], '#79c0ff'], [mm[3], '#c9d1d9'], [mm[4], '#a5d6ff']].forEach(function (s) { g.fillStyle = s[1]; g.fillText(s[0], qx, qy); qx += g.measureText(s[0]).width; });
      });
    }
    function draw3D() {
      cube(PLAT);
      g.strokeStyle = 'rgba(11,47,184,.12)'; g.lineWidth = 1;
      for (var i = 1; i < PLAT.w; i++) { var a = P(PLAT.x + i, PLAT.y, 0), b = P(PLAT.x + i, PLAT.y + PLAT.d, 0); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
      for (var j = 1; j < PLAT.d; j++) { var c = P(PLAT.x, PLAT.y + j, 0), d = P(PLAT.x + PLAT.w, PLAT.y + j, 0); g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.stroke(); }
      SC.cubes.forEach(cube);
      g.lineCap = 'round';
      SC.rays.forEach(function (r) {
        var a = P(r.f[0], r.f[1], r.f[2]), b = P(r.t[0], r.t[1], r.t[2]), L = Math.hypot(b[0] - a[0], b[1] - a[1]), c = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - L * .28];
        g.strokeStyle = 'rgba(255,226,140,.32)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo(c[0], c[1], b[0], b[1]); g.stroke();
        for (var k = 0; k < 3; k++) {
          var t = (ST * .28 + r.ph + k / 3) % 1, q = bz(a, c, b, t), q0 = bz(a, c, b, Math.max(0, t - .07)), rad = 9 * U / 40 + 3;
          g.strokeStyle = 'rgba(255,246,210,.92)'; g.lineWidth = 2.5 * U / 40 + 1; g.beginPath(); g.moveTo(q0[0], q0[1]); g.lineTo(q[0], q[1]); g.stroke();
          var gr = g.createRadialGradient(q[0], q[1], 0, q[0], q[1], rad); gr.addColorStop(0, 'rgba(255,240,190,.9)'); gr.addColorStop(1, 'rgba(255,190,60,0)');
          g.fillStyle = gr; g.beginPath(); g.arc(q[0], q[1], rad, 0, 6.283); g.fill();
        }
      });
      var tw = SC.tower;
      if (tw && shared.dns) {
        var o = P(tw.x + .6, tw.y + .6, tw.h);
        for (var k2 = 0; k2 < 2; k2++) {
          var ph = (ST * .5 + k2 * .5) % 1, rx = (.35 + ph * 1.1) * U;
          g.strokeStyle = 'rgba(255,214,120,' + (1 - ph).toFixed(2) + ')'; g.lineWidth = 2; g.beginPath(); g.ellipse(o[0], o[1], rx, rx * .5, 0, 0, 6.283); g.stroke();
        }
      }
      SC.svc.forEach(function (c) {
        if (!c.high) return;
        var f = facesOf(c)[0], pu = .5 + .5 * Math.sin(ST * 5);
        g.strokeStyle = 'rgba(255,90,80,' + (.5 + .5 * pu).toFixed(2) + ')'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(f[0][0], f[0][1]);
        for (var k = 1; k < 4; k++) g.lineTo(f[k][0], f[k][1]);
        g.closePath(); g.stroke();
      });
      SC.pils.forEach(function (p) { var q = P(p.x, p.y, 0); pill(q[0], q[1], p.h + ' \u00b7 ' + p.rk.ip, p.h); });
      SC.labs.forEach(function (l) { var q = P(l.x, l.y, l.z); pill(q[0], q[1] + l.dy, l.t, l.l); });
      if (!SC.racks.length) { var q0 = P(1.8, 1.3, 0); pill(q0[0], q0[1], 'Connect a server provider to place your first rack', null, 'rgba(11,47,184,.9)'); }
      if (WS.drag && WS.over > -1 && SC.racks[WS.over]) {
        var rk = SC.racks[WS.over], q1 = P(rk.px + 1.2, 1.2, rk.top + .3);
        pill(q1[0], q1[1] - 14, 'Drop to deploy on ' + rk.h, rk.h, 'rgba(35,134,54,.95)');
      }
      if (ZM.t === 0) callout();
    }
    function ease(t) { return t * t * (3 - 2 * t); }
    function drawScene() {
      if (!cw || !isFinite(U) || !isFinite(OX) || !isFinite(OY)) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
      var e = ease(ZM.t);
      if (e < 1) {
        var U0 = U, OX0 = OX, OY0 = OY, rk = SC.racks[ZM.rack];
        if (e > 0 && rk) { var F = P(rk.px + 1.2, 1.2, rk.top / 2), sc = 1 + e * 1.5; U = U0 * sc; OX = OX0 * sc + (1 - sc) * F[0]; OY = OY0 * sc + (1 - sc) * F[1]; }
        g.globalAlpha = 1 - e; draw3D(); g.globalAlpha = 1; U = U0; OX = OX0; OY = OY0;
      }
      if (e > 0) draw2D(e);
    }

    /* ---- 2D rack elevation: container names and IP addresses, one slot per container ---- */
    function clipTxt(t, mw) {
      if (mw <= 0) return '';
      if (g.measureText(t).width <= mw) return t;
      while (t.length > 1 && g.measureText(t + '\u2026').width > mw) t = t.slice(0, -1);
      return t + '\u2026';
    }
    function chipRow(list, xr, xmin, y, bg, fg) {
      var font = '700 12px ui-monospace,SFMono-Regular,Menlo,monospace', h = 22, x = xr, shown = 0, i;
      g.font = font; g.textBaseline = 'middle'; g.textAlign = 'left';
      for (i = 0; i < list.length; i++) {
        var w = g.measureText(list[i]).width + 18, room = i < list.length - 1 ? 38 : 0;
        if (x - w - room < xmin) break;
        g.fillStyle = bg; rr(x - w, y, w, h, h / 2); g.fill(); g.fillStyle = fg; g.fillText(list[i], x - w + 9, y + h / 2 + .5);
        x -= w + 6; shown++;
      }
      if (!shown && list.length) {
        var t0 = clipTxt(list[0], xr - xmin - 18), w0 = g.measureText(t0).width + 18;
        if (xr - w0 >= xmin) { g.fillStyle = bg; rr(xr - w0, y, w0, h, h / 2); g.fill(); g.fillStyle = fg; g.fillText(t0, xr - w0 + 9, y + h / 2 + .5); }
      } else if (shown < list.length) {
        var tx = '+' + (list.length - shown), w1 = g.measureText(tx).width + 18;
        if (x - w1 >= xmin) { g.fillStyle = bg; rr(x - w1, y, w1, h, h / 2); g.fill(); g.fillStyle = fg; g.fillText(tx, x - w1 + 9, y + h / 2 + .5); }
      }
    }
    function rowBody(R, name, ip, nameCol, ipCol, nfs, big, maxW, ledOn) {
      var cyy = R.y + R.h / 2, x = R.x + 26, ifs = Math.max(11, nfs - 3), mono = '600 ' + ifs + 'px ui-monospace,SFMono-Regular,Menlo,monospace';
      g.fillStyle = ledOn ? '#4ade80' : '#14532d'; g.beginPath(); g.arc(R.x + 13, cyy, 4, 0, 6.283); g.fill();
      g.textBaseline = 'middle'; g.textAlign = 'left';
      g.font = '800 ' + nfs + 'px "Bricolage Grotesque",system-ui,sans-serif'; g.fillStyle = nameCol;
      if (big) {
        g.fillText(clipTxt(name, maxW), x, cyy - nfs * .5 + 1);
        g.font = mono; g.fillStyle = ipCol; g.fillText(ip, x, cyy + ifs * .75 + 1);
      } else {
        var t = clipTxt(name, maxW * .6), wn; g.fillText(t, x, cyy); wn = g.measureText(t).width;
        g.font = mono; g.fillStyle = ipCol; g.fillText(clipTxt(ip, maxW - wn - 12), x + wn + 12, cyy);
      }
    }
    function draw2D(e) {
      var rk = SC.racks[ZM.rack]; ROWS2D = [];
      if (!rk) return;
      var narrow = cw < 440, pd = narrow ? 12 : 20, rw = Math.min(cw - pd * 2, 680), rx = (cw - rw) / 2, ty = 52 + (1 - e) * 22, hfs = narrow ? 17 : 21;
      g.save(); g.globalAlpha = e;
      var im = logoImg(rk.h);
      if (im.complete && im.naturalWidth) g.drawImage(im, rx, ty, 34, 34);
      g.textBaseline = 'top'; g.textAlign = 'left'; g.fillStyle = '#ffffff';
      g.font = '800 ' + hfs + 'px "Bricolage Grotesque",system-ui,sans-serif'; g.fillText(rk.h + ' rack', rx + 44, ty - 3);
      g.font = '700 ' + (narrow ? 13 : 15) + 'px ui-monospace,SFMono-Regular,Menlo,monospace'; g.fillStyle = '#ffe08a'; g.fillText('Public IP ' + rk.ip, rx + 44, ty + hfs + 1);
      g.textAlign = 'right'; g.font = '600 13px system-ui,sans-serif'; g.fillStyle = 'rgba(255,255,255,.9)';
      g.fillText(rk.n + ' container' + (rk.n === 1 ? '' : 's') + ' \u00b7 ' + fmt(rk.sub) + '/mo', rx + rw, ty + 2);
      var fy = ty + 50, fh = Math.max(120, ch - fy - 14), rail = narrow ? 22 : 30;
      g.fillStyle = '#0d1117'; rr(rx, fy, rw, fh, 12); g.fill(); g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 2; g.stroke();
      var ix = rx + rail, iw = rw - rail * 2, innerH = fh - 16;
      var want = Math.max(6, rk.items.length + 2), rowH = Math.max(28, Math.min(58, innerH / want)), nRows = Math.min(want, Math.max(2, Math.floor(innerH / rowH)));
      var itemsShown = Math.min(rk.items.length, nRows - 1), hiddenN = rk.items.length - itemsShown, r;
      if (hiddenN > 0) { itemsShown = Math.max(0, nRows - 2); hiddenN = rk.items.length - itemsShown; }
      for (r = 0; r < nRows; r++) {
        var yy = fy + 8 + r * rowH;
        g.fillStyle = '#161b22'; g.fillRect(rx + 2, yy, rail - 4, rowH - 4); g.fillRect(rx + rw - rail + 2, yy, rail - 4, rowH - 4);
        g.fillStyle = '#6e7681'; g.font = '600 10px ui-monospace,monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(nRows - r), rx + rail / 2, yy + (rowH - 4) / 2); g.fillText(String(nRows - r), rx + rw - rail / 2, yy + (rowH - 4) / 2);
      }
      function RR(i) { return { x: ix, y: fy + 8 + i * rowH, w: iw, h: rowH - 4 }; }
      var big = rowH >= 40, nfs = Math.max(12, Math.min(17, rowH * .32)), chipX = narrow ? 0 : Math.min(iw * .46, 270), chipH = 22, S = RR(0);
      g.fillStyle = '#1f2937'; rr(S.x, S.y, S.w, S.h, 8); g.fill(); g.strokeStyle = 'rgba(255,224,138,.7)'; g.lineWidth = 1.5; g.stroke();
      rowBody(S, 'Switch / uplink', rk.ip, '#ffffff', '#ffe08a', nfs, big, S.w - 40 - (chipX ? chipX + 10 : 0), Math.sin(ST * 3) > -.3);
      if (chipX && rk.extra.length) chipRow(rk.extra, S.x + S.w - 10, S.x + S.w - chipX, S.y + (S.h - chipH) / 2, '#ffe08a', '#3b2a00');
      for (var k = 0; k < itemsShown; k++) {
        var it = rk.items[k], R = RR(k + 1), dk = lum(it.color) > .5;
        g.fillStyle = it.color; rr(R.x, R.y, R.w, R.h, 8); g.fill();
        g.lineWidth = HV2 === k ? 3 : 1.5; g.strokeStyle = HV2 === k ? '#ffffff' : (it.high ? '#ff5a50' : 'rgba(0,0,40,.35)'); g.stroke();
        rowBody(R, it.n, it.ip, dk ? '#0a1f7a' : '#ffffff', dk ? 'rgba(10,31,122,.85)' : 'rgba(255,255,255,.92)', nfs, big, R.w - 40 - (chipX ? chipX + 10 : 0), Math.sin(ST * 3 + k * 1.7) > -.3);
        if (chipX && it.domains.length) chipRow(it.domains, R.x + R.w - 10, R.x + R.w - chipX, R.y + (R.h - chipH) / 2, 'rgba(255,255,255,.95)', '#0a1f7a');
        ROWS2D.push({ x: R.x, y: R.y, w: R.w, h: R.h, i: k });
      }
      for (var q = itemsShown + 1; q < nRows; q++) {
        var Q = RR(q), msg;
        g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = '600 12px system-ui,sans-serif';
        if (hiddenN > 0 && q === nRows - 1) { g.fillStyle = '#21262d'; rr(Q.x, Q.y, Q.w, Q.h, 8); g.fill(); g.fillStyle = '#c9d1d9'; g.fillText('+' + hiddenN + ' more container' + (hiddenN === 1 ? '' : 's') + ' on this rack', Q.x + 14, Q.y + Q.h / 2); continue; }
        g.setLineDash([5, 4]); g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 1.5; rr(Q.x, Q.y, Q.w, Q.h, 8); g.stroke(); g.setLineDash([]);
        msg = !rk.items.length && q === 1 ? 'Drag an app onto this rack to fill it' : 'empty slot';
        g.fillStyle = 'rgba(255,255,255,.35)'; g.fillText(msg, Q.x + 14, Q.y + Q.h / 2);
      }
      g.restore();
    }
    function onPoint(e) {
      var r = cv.getBoundingClientRect(), qx = e.clientX - r.left, qy = e.clientY - r.top, hit = -1;
      if (ZM.target === 1) {
        var hv = -1; ROWS2D.forEach(function (R) { if (qx >= R.x && qx <= R.x + R.w && qy >= R.y && qy <= R.y + R.h) hv = R.i; });
        HV2 = hv; cv.style.cursor = ''; return;
      }
      for (var i = SC.cubes.length - 1; i >= 0 && hit < 0; i--) {
        var c = SC.cubes[i];
        if (c.svc && facesOf(c).some(function (f) { return inPoly(qx, qy, f); })) hit = SC.svc.indexOf(c);
      }
      if (hit > -1) { HV.i = hit; HV.until = ST + 4; }
      cv.style.cursor = rackAt(e.clientX, e.clientY) > -1 ? 'zoom-in' : '';
    }
    function nearestRack(e) {
      var r = cv.getBoundingClientRect(), qx = e.clientX - r.left, qy = e.clientY - r.top, best = -1, bd = 1e9;
      SC.racks.forEach(function (k, i) { var p = P(k.px + 1.2, 1.2, k.top / 2), d = Math.hypot(p[0] - qx, p[1] - qy); if (d < bd) { bd = d; best = i; } });
      return best;
    }
    function zoomTo(i) {
      if (!SC.racks[i]) return;
      ZM.rack = i; ZM.target = 1; HV2 = -1; if (reduce) ZM.t = 1;
      renderZbar(); a11y();
    }
    function zoomOut() { ZM.target = 0; HV2 = -1; if (reduce) ZM.t = 0; renderZbar(); a11y(); }
    function renderZbar() {
      zbar.innerHTML = '';
      if (!SC.racks.length) { zbar.style.display = 'none'; return; }
      if (ZM.rack >= SC.racks.length) ZM.rack = 0;
      zbar.style.display = '';
      var zoomed = ZM.target === 1;
      if (zoomed) { var bk = E('button', 'zb', '\u2190 All racks'); bk.type = 'button'; bk.addEventListener('click', zoomOut); zbar.appendChild(bk); }
      else zbar.appendChild(E('span', 'zl', mode === 'inline' ? 'Zoom into a rack (click, or Ctrl + scroll)' : 'Zoom into a rack (click, or scroll up)'));
      SC.racks.forEach(function (rk, i) {
        var b = E('button', 'zb' + (zoomed && ZM.rack === i ? ' on' : '')); b.type = 'button';
        b.appendChild(logo(rk.h, 16)); b.appendChild(E('span', '', rk.h)); b.setAttribute('aria-label', 'Zoom into the ' + rk.h + ' rack');
        b.addEventListener('click', function () { zoomTo(i); }); zbar.appendChild(b);
      });
    }
    function a11y() {
      var t = 'Infrastructure overview: ' + (SC.racks.length ? SC.racks.map(function (k) { return k.h + ' rack, public IP ' + k.ip + ', ' + k.n + ' container' + (k.n === 1 ? '' : 's'); }).join('; ') : 'no racks yet') + '.';
      if (ZM.target === 1 && SC.racks[ZM.rack]) {
        var k = SC.racks[ZM.rack];
        t = k.h + ' rack in 2D, public IP ' + k.ip + '. ' + (k.items.length ? k.items.map(function (it) { return it.n + ' at ' + it.ip + (it.domains.length ? ', domains ' + it.domains.join(', ') : ''); }).join('; ') : 'No containers yet.') + (k.extra.length ? ' Other domains pointing here: ' + k.extra.join(', ') + '.' : '');
      }
      cv.setAttribute('aria-label', t);
    }
    cv.addEventListener('pointerdown', onPoint);
    cv.addEventListener('pointerleave', function () { HV2 = -1; });
    cv.addEventListener('click', function (e) {
      if (ZM.target === 0) { var i = rackAt(e.clientX, e.clientY); if (i > -1) zoomTo(i); }
    });
    /* wheel up zooms into the rack under the pointer, wheel down zooms back out. Inside a page (chart.html) it needs Ctrl or Cmd so normal scrolling still works. */
    cv.addEventListener('wheel', function (e) {
      if (!SC.racks.length) return;
      if (mode === 'inline' && !(e.ctrlKey || e.metaKey)) return;
      if (ZM.target === 0 && e.deltaY < 0) { var i = rackAt(e.clientX, e.clientY); if (i < 0) i = nearestRack(e); if (i > -1) { e.preventDefault(); zoomTo(i); } }
      else if (ZM.target === 1) { e.preventDefault(); if (e.deltaY > 0) zoomOut(); }
    }, { passive: false });

    /* ---------- marketplace drawer ---------- */
    function setDrawer(v) { WS.drawer = v; drawerHost.classList.toggle('drawer', v); }
    function chartHref(it) { return opts.chartHref ? opts.chartHref(it.repo, it.n) : chartUrl + '?repo=' + encodeURIComponent(it.repo) + '&name=' + encodeURIComponent(it.n); }
    function cardEl(it) {
      var el = E('div', 'mc' + (pin && it.n === pin.n ? ' pin' : '')), tx = E('div', 'mt2'), host = shared.place[it.n];
      el.appendChild(E('span', 'grip', '\u22EE\u22EE'));
      el.appendChild(logo(it.logo || it.n, 32));
      tx.appendChild(E('b', '', it.n)); tx.appendChild(E('span', '', it.sub));
      if (host) tx.appendChild(E('em', 'on', 'on ' + host + ' \u00b7 ' + fmt(appCost(it.n, host)) + '/mo' + (isHigh(it.n, host) ? ' \u00b7 high' : '')));
      el.appendChild(tx);
      if (it.repo) { var ia = E('a', 'pl', 'i'); ia.href = chartHref(it); ia.setAttribute('aria-label', 'Open the ' + it.n + ' chart page'); ia.title = 'Chart details'; el.appendChild(ia); }
      var pb = E('button', 'pl', '+'); pb.type = 'button'; pb.setAttribute('aria-label', 'Deploy ' + it.n);
      pb.addEventListener('click', function () { quickPlace(it.n); });
      el.appendChild(pb);
      if (host) { var rb = E('button', 'pl', '\u00d7'); rb.type = 'button'; rb.setAttribute('aria-label', 'Remove ' + it.n); rb.addEventListener('click', function () { unplace(it.n); }); el.appendChild(rb); }
      el.addEventListener('pointerdown', function (e) {
        if (e.target && e.target.closest && e.target.closest('button,a')) return;
        if (e.pointerType && e.pointerType !== 'mouse' && String(e.target.className).indexOf('grip') < 0) return;
        startDrag(it, e);
      });
      return el;
    }
    function recEl(r) {
      var el = E('div', 'rc'), l1 = E('div', 'rl'), l2 = E('div', 'rl'), inp = E('input', 'rin'), x = E('button', 'pl', '\u00d7'), sel = E('select', 'rin rsel');
      inp.value = r.host; inp.setAttribute('aria-label', 'Hostname'); inp.spellcheck = false; inp.autocomplete = 'off';
      inp.addEventListener('change', function () {
        var v = inp.value.trim().toLowerCase().replace(/[^a-z0-9.@-]/g, '').replace(/^[.-]+|[.-]+$/g, '');
        r.host = v || '@'; refresh();
      });
      x.type = 'button'; x.setAttribute('aria-label', 'Remove record'); x.addEventListener('click', function () { shared.records = shared.records.filter(function (q) { return q !== r; }); refresh(); });
      l1.appendChild(inp); l1.appendChild(E('span', 'rz', '.' + shared.dns.zone)); l1.appendChild(x);
      l2.appendChild(E('span', 'ra', '\u2192'));
      shared.provs.forEach(function (h) {
        var names = placed().filter(function (n) { return shared.place[n] === h; });
        var o = E('option', '', rackIp(h) + ' \u00b7 ' + h + (names.length ? ' \u00b7 ' + names.slice(0, 2).join(', ') + (names.length > 2 ? '\u2026' : '') : ''));
        o.value = rackIp(h); if (rackIp(h) === r.ip) o.selected = true; sel.appendChild(o);
      });
      if (!shared.provs.some(function (h) { return rackIp(h) === r.ip; })) { var o0 = E('option', '', r.ip + ' (no server)'); o0.value = r.ip; o0.selected = true; sel.appendChild(o0); }
      sel.setAttribute('aria-label', 'IP address'); sel.addEventListener('change', function () { r.ip = sel.value; r.auto = false; refresh(); });
      l2.appendChild(sel);
      el.appendChild(l1); el.appendChild(l2); el.appendChild(E('div', 'rn', fqdn(r) + (r.svc ? ' \u00b7 ' + r.svc : ' \u00b7 manual')));
      return el;
    }
    function renderDns() {
      var d = shared.dns;
      if (!d) {
        dlist.appendChild(E('div', 'cn', 'Connect a DNS provider to point domains at the IP addresses of your servers. Demo only: no real account is linked.'));
        var cb = E('button', 'cta', '+ Connect a DNS provider'); cb.type = 'button'; cb.addEventListener('click', function () { openDnsPicker(); }); dlist.appendChild(cb);
        return;
      }
      var hd = E('div', 'mc rh'), tx = E('div', 'mt2'), db = E('button', 'pl', '\u00d7');
      hd.appendChild(logo(DNSP[d.prov].logo, 32)); tx.appendChild(E('b', '', d.prov)); tx.appendChild(E('span', '', shared.records.length + ' record' + (shared.records.length === 1 ? '' : 's'))); hd.appendChild(tx);
      db.type = 'button'; db.setAttribute('aria-label', 'Disconnect ' + d.prov); db.addEventListener('click', function () { shared.dns = null; shared.records = []; refresh(); }); hd.appendChild(db);
      dlist.appendChild(hd);
      var zr = E('div', 'rc'), zl = E('label', 'rn', 'Domain'), zi = E('input', 'rin');
      zi.value = d.zone; zi.spellcheck = false; zi.autocomplete = 'off'; zi.setAttribute('aria-label', 'Domain');
      zi.addEventListener('change', function () { var z = cleanZone(zi.value); if (okZone(z)) { d.zone = z; refresh(); } else { zi.value = d.zone; } });
      zr.appendChild(zl); zr.appendChild(zi); dlist.appendChild(zr);
      if (!shared.provs.length) dlist.appendChild(E('div', 'cn', 'Connect a server provider to get IP addresses to point at.'));
      shared.records.forEach(function (r) { dlist.appendChild(recEl(r)); });
      var ab = E('button', 'cta', '+ Add record'); ab.type = 'button'; ab.disabled = !shared.provs.length; ab.addEventListener('click', addRecord); dlist.appendChild(ab);
    }
    function renderDrawer() {
      ['dt0', 'dt1', 'dt2', 'dt3'].forEach(function (id, i) { var b = $(id); if (b) b.classList.toggle('on', ['apps', 'platform', 'repos', 'dns'][i] === WS.tab); });
      if (WS.tab !== 'apps' && (SEARCH.q || SEARCH.items.length)) resetSearch();
      searchWrap.style.display = WS.tab === 'apps' ? '' : 'none';
      dsrc.textContent = { apps: 'Apps: Helm charts from Artifact Hub (snapshot Nov 18, 2026, search is live). Drag one onto a rack, or press +.', platform: 'Platform services run once for every tenant.', repos: 'Repos: demo only, no account is linked.', dns: 'Sample IPs use documentation ranges. Nothing is sent to a DNS provider.' }[WS.tab];
      dlist.innerHTML = '';
      var its = [];
      if (WS.tab === 'apps') {
        if (SEARCH.q) {
          if (SEARCH.busy) dlist.appendChild(E('div', 'cn', 'Searching Artifact Hub for \u201c' + SEARCH.q + '\u201d\u2026'));
          else if (SEARCH.err) dlist.appendChild(E('div', 'cn', 'Could not reach Artifact Hub. Check your connection and try again.'));
          else if (!SEARCH.items.length) dlist.appendChild(E('div', 'cn', 'No Helm charts matched \u201c' + SEARCH.q + '\u201d. Try a shorter or different term.'));
          else dlist.appendChild(E('div', 'cn hint', SEARCH.items.length + ' result' + (SEARCH.items.length === 1 ? '' : 's') + ' from Artifact Hub'));
          its = SEARCH.items;
        } else {
          if (pin) its.push({ n: pin.n, repo: pin.repo, sub: (pin.pub || pin.repo) + ' \u00b7 this page' + (pin.ver ? ' \u00b7 v' + pin.ver : '') });
          CHARTS.forEach(function (c) { if (!pin || c.n !== pin.n) its.push({ n: c.n, repo: c.repo, sub: c.pub + ' \u00b7 \u2605 ' + c.st + ' \u00b7 v' + c.ver }); });
        }
      } else if (WS.tab === 'platform') its = PLATFORM.map(function (p) { return { n: p.n, sub: p.pub + ' \u00b7 ' + p.d }; });
      else if (WS.tab === 'dns') renderDns();
      else {
        dlist.appendChild(E('div', 'cn', 'Connect an account to deploy your own code onto a rack. Demo only: no real account is linked.'));
        var row = E('div', 'row');
        [['gh', 'GitHub'], ['gl', 'GitLab']].forEach(function (q) {
          var b = E('button', 'act'); b.type = 'button'; b.appendChild(logo(q[1], 18)); b.appendChild(E('span', '', WS[q[0]] ? q[1] + ' connected' : 'Connect ' + q[1])); if (WS[q[0]]) b.classList.add('done');
          b.addEventListener('click', function () { WS[q[0]] = !WS[q[0]]; renderDrawer(); }); row.appendChild(b);
        });
        dlist.appendChild(row);
        if (WS.gh) its.push({ n: 'acme-web', sub: 'GitHub \u00b7 acme/web', logo: 'GitHub' });
        if (WS.gl) its.push({ n: 'acme-api', sub: 'GitLab \u00b7 acme/api', logo: 'GitLab' });
      }
      its.forEach(function (it) { dlist.appendChild(cardEl(it)); });
      renderSearchStatus();
    }

    /* ---------- live Helm chart search on Artifact Hub (public API, no key, CORS enabled; kind=0 is Helm charts) ---------- */
    var SEARCH = { q: '', items: [], busy: false, err: false, seq: 0, t: null };
    function renderSearchStatus() {
      sstatEl.className = 'dstat';
      if (!SEARCH.q) { sstatEl.textContent = ''; return; }
      if (SEARCH.busy) { sstatEl.textContent = 'Searching\u2026'; return; }
      if (SEARCH.err) { sstatEl.className = 'dstat bad'; sstatEl.textContent = 'Offline'; return; }
      sstatEl.textContent = SEARCH.items.length ? SEARCH.items.length + ' found' : 'No match';
    }
    function mapChart(p) {
      var r = p.repository || {}, repo = r.name || '', bits = [];
      if (repo) bits.push(repo);
      if (p.stars) bits.push('\u2605 ' + p.stars);
      if (p.version) bits.push('v' + p.version);
      if (!META[p.name] || META[p.name].repo === repo) META[p.name] = { repo: repo, ver: p.version || '', pub: r.organization_display_name || r.user_alias || repo, d: p.description || '' };
      return { n: p.name, repo: repo, sub: bits.join(' \u00b7 ') };
    }
    function resetSearch() { SEARCH.q = ''; SEARCH.items = []; SEARCH.busy = false; SEARCH.err = false; SEARCH.seq++; searchEl.value = ''; renderSearchStatus(); }
    function searchCharts(q) {
      q = (q || '').trim();
      if (!q) { resetSearch(); renderDrawer(); return; }
      var seq = ++SEARCH.seq;
      SEARCH.q = q; SEARCH.busy = true; SEARCH.err = false; renderDrawer();
      fetch(HUB + 'search?ts_query_web=' + encodeURIComponent(q) + '&kind=0&limit=24', { headers: { Accept: 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) { if (seq !== SEARCH.seq) return; SEARCH.items = (d.packages || []).filter(function (p) { return p && p.name; }).map(mapChart); SEARCH.busy = false; renderDrawer(); })
        .catch(function (err) { if (seq !== SEARCH.seq) return; if (window.console) console.error('Artifact Hub search failed:', err); SEARCH.items = []; SEARCH.busy = false; SEARCH.err = true; renderDrawer(); });
    }
    searchEl.addEventListener('input', function () {
      var q = this.value.trim(); clearTimeout(SEARCH.t);
      if (!q) { resetSearch(); renderDrawer(); return; }
      SEARCH.t = setTimeout(function () { searchCharts(q); }, 320);
    });
    searchEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(SEARCH.t); searchCharts(this.value); }
      if (e.key === 'Escape') { e.preventDefault(); resetSearch(); renderDrawer(); }
    });

    /* ---------- drag from the menu onto a rack ---------- */
    function moveGhost(e) { ghost.style.transform = 'translate(' + (e.clientX + 14) + 'px,' + (e.clientY + 14) + 'px)'; }
    function rackAt(x, y) {
      var r = cv.getBoundingClientRect(), qx = x - r.left, qy = y - r.top;
      for (var i = SC.racks.length - 1; i >= 0; i--) {
        var k = SC.racks[i];
        if (facesOf({ x: k.px, y: 0, z: 0, w: 2.4, d: 2.4, h: k.top }).some(function (f) { return inPoly(qx, qy, f); })) return i;
      }
      return -1;
    }
    function onDrag(e) { moveGhost(e); WS.over = rackAt(e.clientX, e.clientY); }
    function endDrag(e) {
      window.removeEventListener('pointermove', onDrag); window.removeEventListener('pointerup', endDrag); window.removeEventListener('pointercancel', endDrag);
      ghost.style.display = 'none';
      var i = WS.over, d = WS.drag; WS.over = -1; WS.drag = null;
      if (!d || e.type === 'pointercancel') return;
      if (i > -1 && SC.racks[i]) place(d.n, SC.racks[i].h);
      else if (!shared.provs.length) { WS.tip = 'noprov'; renderToast(); }
    }
    function startDrag(it, e) {
      if (e.button > 0) return;
      WS.drag = { n: it.n };
      ghost.innerHTML = ''; ghost.appendChild(logo(it.logo || it.n, 22)); ghost.appendChild(document.createTextNode(' ' + it.n));
      ghost.style.display = 'flex'; moveGhost(e);
      window.addEventListener('pointermove', onDrag); window.addEventListener('pointerup', endDrag); window.addEventListener('pointercancel', endDrag);
      if (e.preventDefault) e.preventDefault();
    }

    /* ---------- provider picker ---------- */
    function renderPicker() {
      pk.innerHTML = '';
      pk.appendChild(E('b', 'pt', 'Connect a server provider'));
      pk.appendChild(E('p', 'cn', 'Pick one. Demo only: no real account is linked.'));
      PORD.forEach(function (h) {
        var r = E('div', 'pr2' + (WS.rec === h ? ' rec' : '')), tx = E('div', 'tx'), done = shared.provs.indexOf(h) > -1, bt = E('button', 'pc', done ? 'Connected' : 'Connect');
        r.appendChild(logo(h, 32)); tx.appendChild(E('b', '', h));
        tx.appendChild(E('span', '', (WS.rec === h ? 'Cheapest for your apps \u00b7 ' : '') + 'from ' + fmt(HOSTR[h][0]) + ' per vCPU per month (sample)'));
        r.appendChild(tx); bt.type = 'button'; if (done) bt.disabled = true;
        bt.addEventListener('click', function () { bt.disabled = true; bt.textContent = 'Connecting\u2026'; setTimeout(function () { connectProvider(h); closePicker(); }, 900); });
        r.appendChild(bt); pk.appendChild(r);
      });
      var cl = E('button', 'pc ghb', 'Cancel'); cl.type = 'button'; cl.addEventListener('click', closePicker); pk.appendChild(cl);
    }
    function renderDnsPicker() {
      pk.innerHTML = '';
      pk.appendChild(E('b', 'pt', 'Connect a DNS provider'));
      pk.appendChild(E('p', 'cn', 'Enter the domain you want to manage, then pick a provider. Demo only: no real account is linked.'));
      var zin = E('input', 'zin'), err = E('div', 'cn hi');
      zin.value = shared.dns ? shared.dns.zone : (WS.zone || 'example.com'); zin.setAttribute('aria-label', 'Your domain'); zin.spellcheck = false; zin.autocomplete = 'off';
      pk.appendChild(zin); pk.appendChild(err);
      DNSORD.forEach(function (name) {
        var r = E('div', 'pr2'), tx = E('div', 'tx'), done = shared.dns && shared.dns.prov === name, bt = E('button', 'pc', done ? 'Connected' : 'Connect');
        r.appendChild(logo(DNSP[name].logo, 32)); tx.appendChild(E('b', '', name)); tx.appendChild(E('span', '', 'Creates an A record for each app (sample)')); r.appendChild(tx);
        bt.type = 'button'; if (done) bt.disabled = true;
        bt.addEventListener('click', function () {
          var z = cleanZone(zin.value);
          if (!okZone(z)) { err.textContent = 'Enter a domain like example.com'; zin.focus(); return; }
          err.textContent = ''; WS.zone = z; bt.disabled = true; bt.textContent = 'Connecting\u2026';
          setTimeout(function () { connectDns(name, z); closePicker(); }, 900);
        });
        r.appendChild(bt); pk.appendChild(r);
      });
      var cl = E('button', 'pc ghb', 'Cancel'); cl.type = 'button'; cl.addEventListener('click', closePicker); pk.appendChild(cl);
    }
    function openDnsPicker() { renderDnsPicker(); picker.classList.add('on'); }
    function openPicker(rec) { WS.rec = rec || null; renderPicker(); picker.classList.add('on'); }
    function closePicker() { picker.classList.remove('on'); }

    /* ---------- hints and the cost warning ---------- */
    function renderToast() {
      warnEl.innerHTML = '';
      var w = WS.warn, msg = null, acts = [];
      if (WS.choose) {
        msg = 'Deploy ' + WS.choose + ' on which provider?';
        shared.provs.forEach(function (h) { acts.push([h, function () { place(WS.choose, h); }]); });
        acts.push(['Cancel', function () { WS.choose = null; renderToast(); }]);
      } else if (w) {
        var on = shared.provs.indexOf(w.alt.h) > -1;
        msg = '\u26a0 ' + w.n + ' would cost ' + fmt(w.c) + '/mo on ' + w.h + '. On ' + w.alt.h + ' it is about ' + fmt(w.alt.c) + '/mo.';
        acts.push(on ? ['Move to ' + w.alt.h, function () { place(w.n, w.alt.h); }] : ['Connect ' + w.alt.h, function () { openPicker(w.alt.h); }]);
        acts.push(['Keep it here', function () { WS.warn = null; renderToast(); }]);
      } else if (WS.tip === 'pinned' && pin) {
        msg = pin.n + ' is already on a Hetzner rack, the cheapest sample host. Open the marketplace to add more apps.';
        acts.push(['Got it', function () { WS.tip = null; renderToast(); }]);
      } else if (WS.tip === 'dns1' && shared.dns) msg = 'DNS connected. Each app got a hostname on ' + shared.dns.zone + '. Change the name or the IP in the DNS tab.';
      else if (WS.tip === 'conn1') msg = 'Provider connected. The marketplace menu is open: drag an app onto the rack.';
      else if (WS.tip === 'noprov') { msg = 'Connect a server provider first, then drop apps onto its rack.'; acts.push(['Connect a provider', function () { openPicker(); }]); }
      else if (WS.tip === 'moved') msg = 'Moved. The total above has the new price.';
      if (!msg) { warnEl.className = ''; return; }
      warnEl.className = 'on' + (w && !WS.choose ? ' bad' : '');
      warnEl.appendChild(E('div', '', msg));
      if (acts.length) {
        var row = E('div', 'wa');
        acts.forEach(function (a) { var b = E('button', 'wb', a[0]); b.type = 'button'; b.addEventListener('click', a[1]); row.appendChild(b); });
        warnEl.appendChild(row);
      }
    }
    $('addprov').addEventListener('click', function () { openPicker(); });
    $('addprov2').addEventListener('click', function () { openPicker(); });
    $('adddns').addEventListener('click', function () { openDnsPicker(); });
    $('adddns2').addEventListener('click', function () { openDnsPicker(); });
    $('dtog').addEventListener('click', function () { setDrawer(!WS.drawer); });
    $('dx').addEventListener('click', function () { setDrawer(false); });
    ['dt0', 'dt1', 'dt2', 'dt3'].forEach(function (id, i) { $(id).addEventListener('click', function () { WS.tab = ['apps', 'platform', 'repos', 'dns'][i]; renderDrawer(); }); });
    picker.addEventListener('click', function (e) { if (e.target === picker) closePicker(); });
    window.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (picker.classList.contains('on')) closePicker(); else if (ZM.target === 1) zoomOut();
    });

    /* ---------- show / hide the builder, per-frame step ---------- */
    function setOn(v) {
      if (v === WS.on) return;
      WS.on = v;
      if (mode === 'overlay') body.classList.toggle('tfon', v);
      if (v) { sizeCv(); fit(); renderDrawer(); renderToast(); }
    }
    function builderStep(dt) {
      if (!WS.on) return;
      TM.T += dt;
      if (!TM.typing && !TM.seen[TM.file] && TM.raw) { TM.typing = true; TM.n = reduce ? TM.raw.length : 0; }
      if (TM.typing) {
        TM.n += TM.raw.length * dt / 1.8 * (reduce ? 99 : 1);
        if (TM.n >= TM.raw.length) { TM.n = TM.raw.length; TM.typing = false; TM.seen[TM.file] = true; }
        paintEd();
      }
      var zs = reduce ? 99 : 3.2; ZM.t += Math.max(-zs * dt, Math.min(zs * dt, ZM.target - ZM.t));
      ST = m ? TM.T : 0; drawScene();
    }
    if (window.ResizeObserver) new ResizeObserver(function () { if (WS.on) { sizeCv(); fit(); } }).observe(infraEl);
    else window.addEventListener('resize', function () { if (WS.on) { sizeCv(); fit(); } });

    if (mode === 'inline') {
      if (window.IntersectionObserver) new IntersectionObserver(function (es) { setOn(es[0].isIntersecting); }, { rootMargin: '120px' }).observe(container);
      else setOn(true);
    }

    /* ---------- overlay mode: opens when the page scrolls ---------- */
    var hero = document.getElementById('hero'), spacer = document.getElementById('spacer'), nextBtn = document.getElementById('next'), nl = document.getElementById('nl'), sC = 0;
    function behavior() { return reduce ? 'auto' : 'smooth'; }
    function layout() { if (spacer) spacer.style.height = Math.round(window.innerHeight * 2) + 'px'; }
    if (mode === 'overlay') {
      layout(); window.addEventListener('resize', layout);
      if (nextBtn) nextBtn.addEventListener('click', function () {
        if (WS.on) window.scrollTo({ top: 0, behavior: behavior() });
        else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: behavior() });
      });
      if (location.hash === '#build') setTimeout(function () { window.scrollTo(0, document.documentElement.scrollHeight); }, 60);
    }
    function overlayStep() {
      var vh = window.innerHeight, y = Math.max(0, window.pageYOffset || document.documentElement.scrollTop || 0);
      sC += (y - sC) * .18;
      if (!WS.on && y > vh * .35) setOn(true); else if (WS.on && y < vh * .12) setOn(false);
      if (hero) { hero.style.transform = 'translate3d(0,' + (-sC).toFixed(1) + 'px,0)'; hero.style.opacity = Math.max(0, 1 - sC / (vh * .55)).toFixed(2); }
      if (nextBtn) { nextBtn.classList.toggle('end', WS.on); if (nl) nl.textContent = WS.on ? 'Back to top' : 'Start building'; }
    }

    /* ---------- go ---------- */
    renderDrawer(); tf(); updateTot(); renderEmpty();
    if (pin && mode === 'inline') { shared.provs.push('Hetzner'); WS.tip = 'pinned'; place(pin.n, 'Hetzner'); WS.tip = 'pinned'; renderToast(); }

    var last = performance.now(), T = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      var dt = Math.min((now - last) / 1000, .05); last = now; T += dt;
      try {
        if (mode === 'overlay') overlayStep();
        if (!(mode === 'overlay' && WS.on)) bgTick(dt, T);
        builderStep(dt);
      } catch (err) { if (window.console) console.error(err); }
    }
    requestAnimationFrame(frame);
  };
})();