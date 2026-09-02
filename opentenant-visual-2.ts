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
  tenants?: { id: string; tier?: string }[];
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
  // Phase 2 — tidy tree layout
  // --------------------------------------------------------------------------
  private layout(): { width: number; height: number; maxDepth: number } {
    const childrenOf = (id: string) => this.nodes.filter((n) => n.parentId === id);
    let cursorX = 0;

    const assign = (n: VNode): number => {
      const kids = childrenOf(n.id);
      if (kids.length === 0) {
        n.x = cursorX;
        cursorX += n.w + CARD_GAP_X;
        return n.x + n.w / 2;
      }
      const centers = kids.map(assign);
      n.x = (Math.min(...centers) + Math.max(...centers)) / 2 - n.w / 2;
      return n.x + n.w / 2;
    };

    assign(this.nodes[0]);

    const bandHeight = new Map<number, number>();
    for (const n of this.nodes) {
      bandHeight.set(n.depth, Math.max(bandHeight.get(n.depth) ?? 0, n.h));
    }

    let yCursor = 0;
    const maxDepth = Math.max(...this.nodes.map((n) => n.depth));
    for (let d = 0; d <= maxDepth; d++) {
      for (const n of this.nodes.filter((x) => x.depth === d)) n.y = yCursor;
      yCursor += (bandHeight.get(d) ?? NODE_H_BASE) + (d === maxDepth ? 0 : CARD_GAP_Y);
    }

    const width = Math.max(...this.nodes.map((n) => n.x + n.w)) + MARGIN * 2;
    const height = yCursor + MARGIN * 2 + TITLE_H;
    for (const n of this.nodes) {
      n.x += MARGIN;
      n.y += TITLE_H;
    }
    return { width, height, maxDepth };
  }

  // --------------------------------------------------------------------------
  // Phase 3 — emit SVG
  // --------------------------------------------------------------------------
  private esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private emit(layout: { width: number; height: number; maxDepth: number }): string {
    const { width, height, maxDepth } = layout;
    const out: string[] = [];
    const resellerCount = this.nodes.filter((n) => n.depth > 0).length;
    const tenantCount = this.nodes.reduce((sum, n) => sum + n.tenantIds.length, 0);
    const disabledCount = this.nodes.filter((n) => !n.enabled).length;

    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, 'SFMono-Regular', Menlo, monospace">`);
    out.push(`<title>OpenTenant v3.0 — compiled delegation tree</title>`);
    out.push(`<desc>${this.esc(`${resellerCount} reseller nodes, ${tenantCount} tenant leaves, ${disabledCount} disabled slots, maximum depth ${maxDepth}. Compiled from the same blueprint consumed by the deployment compiler.`)}</desc>`);
    out.push(`<defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="#64748b"/>
      </marker>
      <filter id="glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>`);

    out.push(`<rect width="${width}" height="${height}" fill="#0b1120"/>`);
    out.push(`<text x="${MARGIN}" y="42" fill="#f8fafc" font-size="20" font-weight="bold">OpenTenant v3.0 — Delegation Tree</text>`);
    out.push(`<text x="${MARGIN}" y="64" fill="#64748b" font-size="12">root: ${this.esc(this.bp.root.id)} · max_depth: ${this.bp.root.max_depth ?? "∞"} · nodes: ${this.nodes.length} · tenants: ${tenantCount}</text>`);

    const legend = [
      { c: "#38bdf8", t: "root" },
      { c: "#34d399", t: "enabled reseller" },
      { c: "#fbbf24", t: "sub-reseller" },
      { c: "#64748b", t: "delegation" },
    ];
    legend.forEach((l, i) => {
      const lx = width - MARGIN - legend.length * 118 + i * 118;
      out.push(`<circle cx="${lx}" cy="40" r="5" fill="${l.c}"/><text x="${lx + 12}" y="44" fill="#94a3b8" font-size="10">${l.t}</text>`);
    });

    for (let d = 0; d <= maxDepth; d++) {
      const band = this.nodes.filter((n) => n.depth === d);
      if (!band.length) continue;
      const top = Math.min(...band.map((n) => n.y)) - 26;
      const bot = Math.max(...band.map((n) => n.y + n.h)) + 14;
      out.push(`<rect x="0" y="${top}" width="${width}" height="${bot - top}" fill="#fff" opacity="${d % 2 === 0 ? 0.015 : 0.04}"/>`);
      out.push(`<text x="12" y="${top + 18}" fill="${pal(d).accent}" font-size="11" opacity="0.8">DEPTH ${d}${d === 0 ? " · OPERATOR" : " · RESALE HOP " + d}</text>`);
    }

    // Delegation edges: solid for enabled nodes, dashed for disabled slots.
    for (const n of this.nodes) {
      if (!n.parentId) continue;
      const p = this.byId.get(n.parentId)!;
      const x1 = p.x + p.w / 2;
      const y1 = p.y + p.h;
      const x2 = n.x + n.w / 2;
      const y2 = n.y;
      const my = (y1 + y2) / 2;
      out.push(`<path d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" fill="none" stroke="${n.enabled ? "#475569" : "#334155"}" stroke-width="${n.enabled ? 1.5 : 1}" stroke-dasharray="${n.enabled ? "" : "4 4"}" marker-end="url(#arrow)"/>`);
      if (n.depth > 0) {
        const royalty = (this.bp.root.royalty_schedule ?? []).find((s) => s.depth === n.depth)
          ?? (this.bp.root.royalty_schedule ?? []).find((s) => s.depth === "default");
        if (royalty) {
          out.push(`<text x="${x2 + 8}" y="${my}" fill="#facc15" font-size="9" opacity="0.85">royalty · ${royalty.pass_up_pct}% up</text>`);
        }
      }
    }

    // Composite edges: child template → ancestor template.
    for (const n of this.nodes) {
      for (const t of n.templates) {
        for (const comp of t.composes ?? []) {
          let anc = n.parentId ? this.byId.get(n.parentId) : null;
          while (anc && !anc.templates.some((tt) => tt.id === comp.template)) {
            anc = anc.parentId ? this.byId.get(anc.parentId) : null;
          }
          if (!anc) continue;
          const ti = n.templates.indexOf(t);
          const ai = anc.templates.findIndex((tt) => tt.id === comp.template);
          const x1 = anc.x + anc.w;
          const y1 = anc.y + 60 + ai * 16 + 8;
          const x2 = n.x;
          const y2 = n.y + 60 + ti * 16 + 8;
          out.push(`<path d="M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}" fill="none" stroke="#22d3ee" stroke-width="1" stroke-dasharray="2 3" opacity="0.75"/>`);
        }
      }
    }

    for (const n of this.nodes) {
      const c = pal(n.depth);
      const opacity = n.enabled ? 1 : 0.35;
      out.push(`<g opacity="${opacity}">`);
      out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5" ${n.enabled ? 'filter="url(#glow)"' : 'stroke-dasharray="5 3"'}/>`);
      out.push(`<text x="${n.x + 14}" y="${n.y + 24}" fill="${c.text}" font-size="13" font-weight="bold">${this.esc(n.brandName)}</text>`);
      out.push(`<text x="${n.x + 14}" y="${n.y + 40}" fill="${c.accent}" font-size="9">${this.esc(n.id)} · depth ${n.depth}${n.enabled ? "" : " · DISABLED"}</text>`);
      out.push(`<rect x="${n.x + 10}" y="${n.y + 46}" width="${n.w - 20}" height="16" rx="4" fill="#000" opacity="0.3"/>`);
      out.push(`<text x="${n.x + 16}" y="${n.y + 57}" fill="#7dd3fc" font-size="8">🔒 ${this.esc(n.vault.length > 46 ? n.vault.slice(0, 44) + "…" : n.vault)}</text>`);

      n.templates.forEach((t, i) => {
        const ty = n.y + 74 + i * 16;
        const resell = t.resale?.allowed;
        const mark = t.composes?.length ? "🧩" : resell === false ? "✗" : "✓";
        const floor = t.resale?.price_floor != null ? ` floor $${t.resale.price_floor}` : "";
        const text = `${mark} ${t.id}${t.composes?.length ? ` ⟵ ${t.composes.map((x) => x.template).join(" + ")}` : ""}${floor}`;
        out.push(`<text x="${n.x + 16}" y="${ty}" fill="${resell === false ? "#f87171" : c.text}" font-size="9">${this.esc(text)}</text>`);
      });

      n.tenantIds.forEach((tid, i) => {
        const ty = n.y + NODE_H_BASE + n.templates.length * 16 + 6 + i * TENANT_CHIP_H;
        out.push(`<rect x="${n.x + 12}" y="${ty}" width="${n.w - 24}" height="${TENANT_CHIP_H - 6}" rx="4" fill="${c.accent}" opacity="0.18"/>`);
        out.push(`<text x="${n.x + 20}" y="${ty + 12}" fill="${c.text}" font-size="9">◆ ${this.esc(tid)}</text>`);
      });
      out.push(`</g>`);
    }

    out.push(`</svg>`);
    return out.join("\n");
  }

  async compile(outFile: string): Promise<void> {
    console.log("🎨 OpenTenant v3.0 — Visual Schema Compiler");
    this.flatten();
    console.log(`   📥 Flattened ${this.nodes.length} nodes`);
    const layout = this.layout();
    const svg = this.emit(layout);
    await ensureDir(dirname(resolve(outFile)));
    await Deno.writeTextFile(outFile, svg);
    console.log(`   ✅ Schema diagram: ${layout.width}×${layout.height}px, ${layout.maxDepth + 1} depth bands`);
    console.log(`   ✅ Wrote ${outFile}`);
  }
}

if (import.meta.main) {
  const file = Deno.args[0];
  const outIdx = Deno.args.indexOf("--out");
  const outFile = outIdx !== -1 ? Deno.args[outIdx + 1] : "./generated/delegation-tree.svg";
  if (!file) {
    console.error("Usage: deno run --allow-read --allow-write opentenant-visual.ts <blueprint.yaml> [--out FILE.svg]");
    Deno.exit(2);
  }
  const text = await Deno.readTextFile(file);
  await new VisualCompiler(text).compile(outFile);
}
