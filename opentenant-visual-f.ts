#!/usr/bin/env -S deno run --allow-read --allow-write

// OpenTenant v3.0 — Delegation Tree Visual Schema Compiler
//
// Compiles the canonical v3 reseller blueprint into one self-contained SVG.
// The visual model deliberately mirrors the recursive delegation_tree schema
// and the global template registry used by opentenant-compiler.ts.

import { parse as parseYaml } from "https://deno.land/std@0.224.0/yaml/mod.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/ensure_dir.ts";
import { dirname, resolve } from "https://deno.land/std@0.224.0/path/mod.ts";

interface TemplateDef {
  id: string;
  engine?: string;
  version?: string;
  composes?: { template: string }[];
  resale?: {
    allowed?: boolean;
    price_floor?: number;
    royalty_per_seat?: number;
  };
}

interface NodeDef {
  id: string;
  kind?: string;
  parent?: string;
  depth?: number;
  enabled?: boolean;
  brand?: { name?: string; domain?: string; theme?: string };
  vault_namespace?: string;
  template_registry?: TemplateDef[];
  // v3.0 uses this for explicit downstream policy metadata. The effective
  // registry still comes from inherited template registries plus local entries.
  inherited_registry_policy?: {
    template: string;
    resale?: TemplateDef["resale"];
  }[];
  tenants?: { id: string; tier?: string; subscriptions?: { template: string }[] }[];
  children?: NodeDef[];
}

interface RoyaltySchedule {
  depth: number | "default";
  keep_pct: number;
  pass_up_pct: number;
}

interface Blueprint {
  version?: string;
  root: {
    id: string;
    domain?: string;
    max_depth?: number;
    royalty_schedule?: RoyaltySchedule[];
  };
  template_registry?: TemplateDef[];
  delegation_tree: NodeDef[];
}

interface VNode {
  id: string;
  path: string;
  depth: number;
  enabled: boolean;
  brandName: string;
  vault: string;
  templates: TemplateDef[];
  tenantIds: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  parentId: string | null;
}

const PALETTE = [
  { fill: "#1e293b", stroke: "#38bdf8", text: "#e2e8f0", accent: "#38bdf8" },
  { fill: "#0f2a1e", stroke: "#34d399", text: "#d1fae5", accent: "#34d399" },
  { fill: "#2a1e0f", stroke: "#fbbf24", text: "#fef3c7", accent: "#fbbf24" },
  { fill: "#2a0f1e", stroke: "#f472b6", text: "#fce7f3", accent: "#f472b6" },
  { fill: "#0f1e2a", stroke: "#a78bfa", text: "#ede9fe", accent: "#a78bfa" },
  { fill: "#1e2a0f", stroke: "#a3e635", text: "#ecfccb", accent: "#a3e635" },
];
const pal = (d: number) => PALETTE[Math.min(d, PALETTE.length - 1)];

const NODE_W = 300;
const NODE_H_BASE = 92;
const CARD_GAP_X = 44;
const CARD_GAP_Y = 120;
const TENANT_CHIP_H = 22;
const MARGIN = 60;
const TITLE_H = 96;

class VisualCompiler {
  private bp: Blueprint;
  private nodes: VNode[] = [];
  private byId = new Map<string, VNode>();
  private errors: string[] = [];

  constructor(text: string) {
    this.bp = parseYaml(text) as Blueprint;
    if (!this.bp?.root?.id) throw new Error("Blueprint missing required root.id");
    if (!this.bp?.delegation_tree) {
      throw new Error("Blueprint missing required delegation_tree:");
    }
  }

  private fail(message: string): void {
    this.errors.push(message);
  }

  // --------------------------------------------------------------------------
  // Phase 1 — flatten + validate the topology needed by the visual
  // --------------------------------------------------------------------------
  private flatten(): void {
    const root = this.bp.root;

    this.nodes.push({
      id: root.id,
      path: root.id,
      depth: 0,
      enabled: true,
      brandName: `ROOT · ${root.domain ?? ""}`.trim(),
      vault: "secret/data/opentenant/core",
      // FIX: the root card owns the global registry; the old implementation
      // referenced a non-existent template_registry_placeholder property.
      templates: this.bp.template_registry ?? [],
      tenantIds: [],
      x: 0,
      y: 0,
      w: NODE_W,
      h: NODE_H_BASE + (this.bp.template_registry?.length ?? 0) * 16,
      parentId: null,
    });
    this.byId.set(root.id, this.nodes[0]);

    const walk = (
      n: NodeDef,
      parent: string,
      path: string[],
      depth: number,
      inheritedTemplates: Map<string, TemplateDef>,
    ) => {
      if (this.byId.has(n.id)) {
        this.fail(`Duplicate node id '${n.id}' at ${[...path, n.id].join("/")}`);
        return;
      }

      if (n.parent && n.parent !== parent) {
        this.fail(
          `Parent mismatch for '${n.id}': declared '${n.parent}', tree parent is '${parent}'`,
        );
      }
      if (n.depth != null && n.depth !== depth) {
        this.fail(`Depth mismatch for '${n.id}': declared ${n.depth}, computed ${depth}`);
      }
      if (this.bp.root.max_depth != null && depth > this.bp.root.max_depth) {
        this.fail(
          `Depth ceiling exceeded at '${n.id}': ${depth} > root.max_depth=${this.bp.root.max_depth}`,
        );
      }

      const effective = new Map(inheritedTemplates);
      for (const t of n.template_registry ?? []) {
        effective.set(t.id, t);
        for (const comp of t.composes ?? []) {
          const upstream = effective.get(comp.template);
          if (!upstream) {
            this.fail(
              `Composite '${t.id}' at '${n.id}' references '${comp.template}' before it is available upstream`,
            );
          } else if (upstream.resale?.allowed !== true) {
            this.fail(
              `Composite '${t.id}' at '${n.id}' references non-resellable template '${comp.template}'`,
            );
          }
        }
      }

      const templates = [...effective.values()].filter(
        (t) => t.resale?.allowed !== false || (n.template_registry ?? []).some((x) => x.id === t.id),
      );
      const tenants = (n.tenants ?? []).map((t) => t.id);
      const h =
        NODE_H_BASE +
        (templates.length ? templates.length * 16 : 0) +
        tenants.length * TENANT_CHIP_H;

      const v: VNode = {
        id: n.id,
        path: [...path, n.id].join("/"),
        depth,
        enabled: n.enabled !== false,
        brandName: n.brand?.name ?? n.id,
        vault: n.vault_namespace ?? `opentenant/${[...path, n.id].join("/")}`,
        templates,
        tenantIds: tenants,
        x: 0,
        y: 0,
        w: NODE_W,
        h,
        parentId: parent,
      };

      this.nodes.push(v);
      this.byId.set(n.id, v);

      const expectedVaultFragment = [...path, n.id].join("/");
      if (n.vault_namespace && !n.vault_namespace.includes(n.id)) {
        this.fail(
          `Vault namespace for '${n.id}' does not contain its node id: '${n.vault_namespace}'`,
        );
      }
      if (expectedVaultFragment && n.vault_namespace && !n.vault_namespace.includes(n.id)) {
        this.fail(`Vault path mismatch at '${n.id}'`);
      }

      for (const tenant of n.tenants ?? []) {
        if (!new Set(["basic", "standard", "premium", "platinum"]).has(tenant.tier ?? "")) {
          this.fail(`Invalid tenant tier '${tenant.tier}' for '${tenant.id}' at '${n.id}'`);
        }
        for (const sub of tenant.subscriptions ?? []) {
          if (!effective.has(sub.template)) {
            this.fail(`Tenant '${tenant.id}' at '${n.id}' subscribes to unknown template '${sub.template}'`);
          }
        }
      }

      const childInherited = new Map(effective);
      for (const child of n.children ?? []) {
        walk(child, n.id, [...path, n.id], depth + 1, childInherited);
      }
    };

    const rootTemplates = new Map<string, TemplateDef>();
    for (const t of this.bp.template_registry ?? []) rootTemplates.set(t.id, t);

    for (const top of this.bp.delegation_tree) {
      walk(top, root.id, [], 1, rootTemplates);
    }

    const seenParents = new Set<string>();
    for (const n of this.nodes) {
      if (n.parentId) {
        if (!this.byId.has(n.parentId)) this.fail(`Missing parent '${n.parentId}' for '${n.id}'`);
        if (seenParents.has(`${n.id}->${n.parentId}`)) this.fail(`Duplicate parent edge '${n.id}->${n.parentId}'`);
        seenParents.add(`${n.id}->${n.parentId}`);
      }
    }

    for (const n of this.nodes) {
      const sched = (this.bp.root.royalty_schedule ?? []).find((s) => s.depth === n.depth)
        ?? (this.bp.root.royalty_schedule ?? []).find((s) => s.depth === "default");
      if (n.depth > 0 && !sched) {
        this.fail(`No royalty schedule covers depth ${n.depth} for '${n.id}'`);
      } else if (sched && sched.keep_pct + sched.pass_up_pct !== 100) {
        this.fail(
          `Royalty schedule for depth ${String(sched.depth)} is not balanced: ${sched.keep_pct}+${sched.pass_up_pct}`,
        );
      }
    }

    if (this.errors.length) {
      throw new Error(`Visual audit failed:\n- ${this.errors.join("\n- ")}`);
    }
  }

  // --------------------------------------------------------------------------
  // Phase 2 — control-plane layout
  // --------------------------------------------------------------------------
  // The topology is intentionally compact: the surrounding integration
  // surfaces remain visually rich, while the actual reseller/tenant graph is
  // represented as a small radial star inside the OpenTenant control plane.
  private controlPlaneLayout(): { width: number; height: number } {
    return { width: 1200, height: 820 };
  }

  private tenantTopology(): { label: string; sublabel: string; enabled: boolean; angle: number; radius: number }[] {
    const root = this.nodes[0];
    const resellerNodes = this.nodes.filter((n) => n.depth > 0);
    const tenantLeaves = resellerNodes.flatMap((n) => n.tenantIds.map((tenantId) => ({
      label: tenantId,
      sublabel: n.depth === 1 ? `${n.brandName} tenant` : `${n.brandName} · tenant`,
      enabled: n.enabled,
    })));

    // Keep the star small and readable. The actual hierarchy remains encoded
    // by the labels; this is an overview, not a second source of truth.
    const items: { label: string; sublabel: string; enabled: boolean; angle: number; radius: number }[] = [];
    const availableNodes = resellerNodes.map((n) => ({
      label: n.brandName,
      sublabel: `depth ${n.depth} · ${n.enabled ? "active" : "reserved"}`,
      enabled: n.enabled,
    }));

    const merged = [...availableNodes, ...tenantLeaves];
    const max = Math.min(5, merged.length);
    const selected = merged.slice(0, max);
    selected.forEach((item, i) => {
      const angle = (-90 + i * (360 / selected.length)) * Math.PI / 180;
      items.push({ ...item, angle, radius: 122 });
    });
    return items;
  }

  // --------------------------------------------------------------------------
  // Phase 3 — emit the visual
  // --------------------------------------------------------------------------
  private esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private emit(layout: { width: number; height: number }): string {
    const { width, height } = layout;
    const out: string[] = [];
    const tenantCount = this.nodes.reduce((sum, n) => sum + n.tenantIds.length, 0);
    const activeNodes = this.nodes.filter((n) => n.enabled).length;
    const disabledCount = this.nodes.filter((n) => !n.enabled).length;
    const topology = this.tenantTopology();

    const providerLeft = [
      { y: 146, label: "GITHUB", path: "M228 146 C340 146, 400 244, 472 254", dur: "4.2s" },
      { y: 254, label: "GITLAB", path: "M228 254 C340 254, 400 278, 472 278", dur: "4.55s" },
      { y: 362, label: "VAULT", path: "M228 362 C340 362, 400 302, 472 302", dur: "4.9s" },
    ];
    const providerRight = [
      { y: 120, label: "GCP", path: "M946 120 C860 120, 800 248, 728 248", dur: "5.25s" },
      { y: 228, label: "AWS", path: "M946 228 C860 228, 800 272, 728 272", dur: "5.6s" },
      { y: 336, label: "SUPABASE", path: "M946 336 C860 336, 800 296, 728 296", dur: "5.95s" },
      { y: 444, label: "CLOUDFLARE", path: "M946 444 C860 444, 800 320, 728 320", dur: "6.3s" },
    ];

    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="control-plane-title control-plane-desc" font-family="ui-monospace, 'SFMono-Regular', Menlo, monospace">`);
    out.push(`<title id="control-plane-title">OpenTenant control plane with compiled tenant topology</title>`);
    out.push(`<desc id="control-plane-desc">Git, Vault, cloud, database and edge integrations surround OpenTenant. A small radial topology inside the control plane shows the compiled reseller and tenant nodes from the canonical blueprint.</desc>`);
    out.push(`<defs>
      <radialGradient id="core-halo">
        <stop offset="0" stop-color="#38bdf8" stop-opacity="0.2"/>
        <stop offset="1" stop-color="#38bdf8" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="flow-line">
        <stop offset="0" stop-color="#22d3ee" stop-opacity="0.18"/>
        <stop offset="0.5" stop-color="#38bdf8" stop-opacity="0.92"/>
        <stop offset="1" stop-color="#22d3ee" stop-opacity="0.18"/>
      </linearGradient>
      <filter id="soft-glow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="tiny-glow"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>`);

    out.push(`<rect width="${width}" height="${height}" fill="#0b1120"/>`);
    out.push(`<circle cx="600" cy="300" r="250" fill="url(#core-halo)"/>`);
    out.push(`<circle cx="600" cy="300" r="238" fill="none" stroke="#263244" stroke-width="1" stroke-dasharray="4 12" class="control-plane__orbit control-plane__orbit--slow"/>`);
    out.push(`<circle cx="600" cy="300" r="185" fill="none" stroke="#22d3ee" stroke-opacity="0.28" stroke-width="1.5" stroke-dasharray="32 18 5 18" class="control-plane__orbit control-plane__orbit--reverse"/>`);
    out.push(`<circle cx="600" cy="300" r="126" fill="none" stroke="#38bdf8" stroke-opacity="0.42" stroke-width="2" stroke-dasharray="72 26" class="control-plane__orbit"/>`);
    out.push(`<path d="M600 44A256 256 0 0 1 856 300" fill="none" stroke="#38bdf8" stroke-opacity="0.7" stroke-width="3" stroke-linecap="round" class="control-plane__scan"/>`);

    const emitProvider = (p: {y:number;label:string;path:string;dur:string}, side: 'left'|'right', i:number) => {
      const boxX = side === 'left' ? 94 : 946;
      const dotX = side === 'left' ? 114 : 966;
      const textX = side === 'left' ? 130 : 982;
      out.push(`<path id="provider-path-${side}-${i}" d="${p.path}" fill="none" stroke="url(#flow-line)" stroke-opacity="0.36" stroke-width="1.5"/>`);
      out.push(`<circle r="4" fill="#38bdf8" filter="url(#soft-glow)" class="control-plane__packet"><animateMotion dur="${p.dur}" repeatCount="indefinite" begin="-${(i + (side === 'right' ? 3 : 0)) * 0.6}s"><mpath href="#provider-path-${side}-${i}"/></animateMotion></circle>`);
      out.push(`<rect x="${boxX}" y="${p.y - 24}" width="160" height="48" rx="8" fill="#162033" stroke="#263244"/>`);
      out.push(`<circle cx="${dotX}" cy="${p.y}" r="5" fill="#38bdf8" fill-opacity="0.85"/>`);
      out.push(`<text x="${textX}" y="${p.y + 4}" fill="#e2e8f0" font-family="monospace" font-size="12" letter-spacing="1.5">${p.label}</text>`);
    };
    providerLeft.forEach((p, i) => emitProvider(p, 'left', i));
    providerRight.forEach((p, i) => emitProvider(p, 'right', i));

    // Core.
    out.push(`<g class="control-plane__core">`);
    out.push(`<circle cx="600" cy="300" r="96" fill="#162033" stroke="#38bdf8" stroke-opacity="0.55" stroke-width="2"/>`);
    out.push(`<circle cx="600" cy="300" r="78" fill="#0b1120" stroke="#263244"/>`);
    out.push(`<rect x="578" y="240" width="44" height="44" rx="10" fill="#38bdf8"/>`);
    out.push(`<path d="M589 273V251h8v22M603 273v-22h8v22M585 277h30" fill="none" stroke="#082f49" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`);
    out.push(`<text x="600" y="308" text-anchor="middle" fill="#f8fafc" font-family="sans-serif" font-weight="700" font-size="18">OpenTenant</text>`);
    out.push(`<text x="600" y="332" text-anchor="middle" fill="#94a3b8" font-family="monospace" font-size="10" letter-spacing="2">CONTROL PLANE</text>`);
    out.push(`<circle cx="600" cy="359" r="4" fill="#38bdf8" class="control-plane__pulse"/>`);
    out.push(`</g>`);

    // Small star topology: business hierarchy stays compact and readable.
    const hubX = 600, hubY = 442;
    const directTenant = this.nodes.find((n) => n.id === "logifleet-partner")?.tenantIds[0] ?? "carrier-mx";
    const mexico = this.nodes.find((n) => n.id === "logifleet-mexico");
    const brazil = this.nodes.find((n) => n.id === "logifleet-brazil");
    const mexicoTenant = mexico?.tenantIds[0] ?? "transportes-norte";
    const spoke = (x: number, y: number, enabled: boolean) => out.push(`<path d="M${hubX},${hubY} C${hubX + (x - hubX) * 0.35},${hubY + 12} ${hubX + (x - hubX) * 0.72},${y - 16} ${x},${y}" fill="none" stroke="${enabled ? '#22d3ee' : '#475569'}" stroke-width="1.3" stroke-opacity="0.68" ${enabled ? '' : 'stroke-dasharray="4 4"'}/>`) ;
    out.push(`<text x="600" y="382" text-anchor="middle" fill="#64748b" font-family="monospace" font-size="9" letter-spacing="1.8">COMPILED TENANT TOPOLOGY</text>`);
    out.push(`<circle cx="${hubX}" cy="${hubY}" r="7" fill="#38bdf8" filter="url(#tiny-glow)"/>`);
    spoke(420, 505, true); spoke(600, 505, true); spoke(780, 505, false);
    out.push(`<rect x="512" y="430" width="176" height="58" rx="10" fill="#162033" stroke="#38bdf8" stroke-opacity="0.6"/>`);
    out.push(`<text x="600" y="454" text-anchor="middle" fill="#e2e8f0" font-size="11" font-weight="700">LOGIFLEET PLATFORM</text>`);
    out.push(`<text x="600" y="471" text-anchor="middle" fill="#94a3b8" font-size="8">reseller · depth 1 · 70 / 30</text>`);

    out.push(`<rect x="332" y="501" width="176" height="58" rx="10" fill="#162033" stroke="#22d3ee" stroke-opacity="0.55"/>`);
    out.push(`<circle cx="350" cy="522" r="4" fill="#22d3ee"/>`);
    out.push(`<text x="366" y="526" fill="#e2e8f0" font-size="10" font-weight="700">${this.esc(directTenant.toUpperCase())}</text>`);
    out.push(`<text x="350" y="543" fill="#94a3b8" font-size="8">tenant · premium · Helm release</text>`);

    out.push(`<rect x="512" y="501" width="176" height="58" rx="10" fill="#162033" stroke="#22d3ee" stroke-opacity="0.55"/>`);
    out.push(`<circle cx="530" cy="522" r="4" fill="#22d3ee"/>`);
    out.push(`<text x="546" y="526" fill="#e2e8f0" font-size="10" font-weight="700">LOGIFLEET MÉXICO</text>`);
    out.push(`<text x="530" y="543" fill="#94a3b8" font-size="8">reseller · depth 2 · ${mexico?.tenantIds.length ?? 1} tenant</text>`);
    out.push(`<path d="M600 559V579" fill="none" stroke="#22d3ee" stroke-opacity="0.4" stroke-width="1.2"/>`);
    out.push(`<rect x="528" y="579" width="144" height="38" rx="8" fill="#101a2b" stroke="#263244"/>`);
    out.push(`<text x="600" y="595" text-anchor="middle" fill="#e2e8f0" font-size="8.5" font-weight="700">${this.esc(mexicoTenant.toUpperCase())}</text>`);
    out.push(`<text x="600" y="608" text-anchor="middle" fill="#94a3b8" font-size="7.5">tenant · standard</text>`);

    out.push(`<rect x="692" y="501" width="176" height="58" rx="10" fill="#162033" stroke="#475569" stroke-dasharray="5 4" opacity="0.55"/>`);
    out.push(`<circle cx="710" cy="522" r="4" fill="#64748b" opacity="0.5"/>`);
    out.push(`<text x="726" y="526" fill="#94a3b8" font-size="10" font-weight="700">LOGIFLEET BRAZIL</text>`);
    out.push(`<text x="710" y="543" fill="#64748b" font-size="8">reseller slot · ${brazil?.enabled === false ? 'disabled' : 'reserved'}</text>`);

    out.push(`<line x1="72" y1="650" x2="1128" y2="650" stroke="#263244"/>`);
    out.push(`<text x="72" y="678" fill="#64748b" font-family="monospace" font-size="9" letter-spacing="1.7">RUNTIME SIGNALS</text>`);
    const sig = [
      [72, "INGRESS", "wildcard TLS · WAF · websockets"],
      [324, "SECRETS", "Vault → ExternalSecret → pod"],
      [576, "DEPLOYMENT", "Helm release · namespace · RLS"],
      [828, "AUDIT", `${tenantCount} tenant releases · ${disabledCount} reserved · graph valid`],
    ];
    for (const [x, label, value] of sig) {
      const w = x === 828 ? 300 : 240;
      out.push(`<rect x="${x}" y="696" width="${w}" height="56" rx="9" fill="#10161e" stroke="#263244"/>`);
      out.push(`<text x="${Number(x)+18}" y="717" fill="#64748b" font-size="8" letter-spacing="1.3">${label}</text>`);
      out.push(`<text x="${Number(x)+18}" y="737" fill="#e2e8f0" font-size="10">${this.esc(String(value))}</text>`);
    }

    out.push(`</svg>`);
    return out.join("\n");
  }

  async compile(outFile: string): Promise<void> {
    console.log("🎨 OpenTenant v3.0 — Visual Schema Compiler");
    this.flatten();
    console.log(`   📥 Flattened ${this.nodes.length} nodes`);
    const layout = this.controlPlaneLayout();
    const svg = this.emit(layout);
    await ensureDir(dirname(resolve(outFile)));
    await Deno.writeTextFile(outFile, svg);
    console.log(`   ✅ Control-plane visual: ${layout.width}×${layout.height}px, ${this.nodes.length - 1} reseller nodes + ${this.nodes.reduce((sum, n) => sum + n.tenantIds.length, 0)} tenant releases`);
    console.log(`   ✅ Wrote ${outFile}`);
  }
}

if (import.meta.main) {
  const file = Deno.args[0];
  const outIdx = Deno.args.indexOf("--out");
  const outFile = outIdx !== -1 ? Deno.args[outIdx + 1] : "./generated/control-plane.svg";
  if (!file) {
    console.error("Usage: deno run --allow-read --allow-write opentenant-visual.ts <blueprint.yaml> [--out FILE.svg]");
    Deno.exit(2);
  }
  const text = await Deno.readTextFile(file);
  await new VisualCompiler(text).compile(outFile);
}
