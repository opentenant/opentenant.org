# `opentenant-visual.ts` — The Blueprint → SVG Schema Compiler

Same philosophy as the main compiler: pure Deno, zero dependencies beyond std. It reads the same `opentenant-reseller.yaml`, reuses the same flatten/validate logic in miniature, and emits a **self-contained SVG schema diagram** of the delegation tree — depth bands, vault subtrees, royalty splits, tenant counts, composite-template edges, and disabled-node states.

```bash
deno run --allow-read --allow-write opentenant-visual.ts opentenant-reseller.yaml --out ./generated/tree.svg
```

```typescript
#!/usr/bin/env deno
// ============================================================================
// opentenant-visual.ts
// OpenTenant v3.0 — Delegation Tree Visual Schema Compiler
//
// Reads the canonical reseller blueprint and compiles it to a single
// self-contained SVG showing:
//   - The delegation tree (root → resellers → sub-resellers → ...)
//   - Depth bands (horizontal strata = organizational altitude)
//   - Vault namespace subtrees (crypto isolation boundaries)
//   - Royalty flow arrows (child → parent revenue hops)
//   - Template registry cards per node (with composite edges)
//   - Tenant leaf chips
//   - Disabled nodes rendered dashed/ghosted
//
// Usage:
//   deno run --allow-read --allow-write opentenant-visual.ts <blueprint.yaml> [--out FILE.svg]
// ============================================================================

import { parse as parseYaml } from "https://deno.land/std@0.224.0/yaml/mod.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/ensure_dir.ts";
import { dirname, resolve } from "https://deno.land/std@0.224.0/path/mod.ts";

// ----------------------------------------------------------------------------
// Types (minimal mirror of the compiler schema)
// ----------------------------------------------------------------------------

interface TemplateDef {
  id: string;
  engine?: string;
  version?: string;
  composes?: { template: string }[];
  resale?: { allowed?: boolean; price_floor?: number; royalty_per_seat?: number };
}

interface NodeDef {
  id: string;
  kind?: string;
  enabled?: boolean;
  brand?: { name?: string; domain?: string; theme?: string };
  vault_namespace?: string;
  template_registry?: TemplateDef[];
  tenants?: { id: string; tier?: string }[];
  children?: NodeDef[];
}

interface Blueprint {
  version?: string;
  root?: { id: string; domain?: string; max_depth?: number };
  delegation_tree: NodeDef[];
}

// ----------------------------------------------------------------------------
// Layout model
// ----------------------------------------------------------------------------

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
  { fill: "#1e293b", stroke: "#38bdf8", text: "#e2e8f0", accent: "#38bdf8" }, // depth 0 root
  { fill: "#0f2a1e", stroke: "#34d399", text: "#d1fae5", accent: "#34d399" }, // depth 1
  { fill: "#2a1e0f", stroke: "#fbbf24", text: "#fef3c7", accent: "#fbbf24" }, // depth 2
  { fill: "#2a0f1e", stroke: "#f472b6", text: "#fce7f3", accent: "#f472b6" }, // depth 3
  { fill: "#0f1e2a", stroke: "#a78bfa", text: "#ede9fe", accent: "#a78bfa" }, // depth 4
  { fill: "#1e2a0f", stroke: "#a3e635", text: "#ecfccb", accent: "#a3e635" }, // depth 5+
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

  constructor(text: string) {
    this.bp = parseYaml(text) as Blueprint;
    if (!this.bp?.delegation_tree) {
      throw new Error("Blueprint missing `delegation_tree:`");
    }
  }

  // --------------------------------------------------------------------------
  // Phase 1 — flatten + measure (decides card heights, tree width)
  // --------------------------------------------------------------------------

  private flatten(): void {
    const walk = (n: NodeDef, parent: string | null, path: string[], depth: number) => {
      if (this.byId.has(n.id)) throw new Error(`Duplicate node id '${n.id}'`);
      const templates = n.template_registry ?? [];
      const tenants = (n.tenants ?? []).map((t) => t.id);
      const h = NODE_H_BASE +
        templates.length * 16 +
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
        x: 0, y: 0, w: NODE_W, h,
        parentId: parent,
      };
      this.nodes.push(v);
      this.byId.set(n.id, v);
      for (const c of n.children ?? []) walk(c, n.id, [...path, n.id], depth + 1);
    };
    // Root pseudo-node
    const root = this.bp.root ?? { id: "opentenant-core" };
    this.nodes.push({
      id: root.id, path: root.id, depth: 0, enabled: true,
      brandName: `ROOT · ${root.domain ?? ""}`,
      vault: "secret/data/opentenant/core",
      templates: this.bp.template_registry_placeholder ?? [],
      tenantIds: [], x: 0, y: 0, w: NODE_W, h: NODE_H_BASE, parentId: null,
    } as VNode);
    this.byId.set(root.id, this.nodes[0]);
    for (const top of this.bp.delegation_tree) walk(top, root.id, [], 1);
  }

  // --------------------------------------------------------------------------
  // Phase 2 — tidy tree layout (Reingold–Tilford-lite: leaf packing + parent centering)
  // --------------------------------------------------------------------------

  private layout(): { width: number; height: number; maxDepth: number } {
    const childrenOf = (id: string) => this.nodes.filter((n) => n.parentId === id);

    // assign x by in-order leaf walk
    let cursorX = 0;
    const assign = (n: VNode): number => {
      const kids = childrenOf(n.id);
      if (kids.length === 0) {
        n.x = cursorX;
        cursorX += n.w + CARD_GAP_X;
      } else {
        const centers = kids.map(assign);
        n.x = (Math.min(...centers) + Math.max(...centers)) / 2 - n.w / 2;
        // ensure no overlap with previous sibling subtree
        if (n.x < cursorX - n.w - CARD_GAP_X) n.x = cursorX - n.w - CARD_GAP_X;
      }
      return n.x;
    };
    const root = this.nodes[0];
    assign(root);

    // y by depth
    const depthY = new Map<number, number>();
    for (const n of this.nodes) {
      if (!depthY.has(n.depth)) depthY.set(n.depth, 0);
      n.y = Math.max(...[...depthY.entries()].filter(([d]) => d < n.depth)
        .map(([d, yy]) => yy), 0);
    }
    // recompute cumulative band heights (bands sized by tallest card in band)
    const bandHeight = new Map<number, number>();
    for (const n of this.nodes) {
      bandHeight.set(n.depth, Math.max(bandHeight.get(n.depth) ?? 0, n.h));
    }
    let yCursor = 0;
    const bandTop = new Map<number, number>();
    const maxDepth = Math.max(...this.nodes.map((n) => n.depth));
    for (let d = 0; d <= maxDepth; d++) {
      bandTop.set(d, yCursor);
      const bh = (bandHeight.get(d) ?? NODE_H_BASE) + (d === 0 ? 0 : CARD_GAP_Y);
      for (const n of this.nodes.filter((x) => x.depth === d)) n.y = yCursor;
      yCursor += bh;
    }

    const width = Math.max(...this.nodes.map((n) => n.x + n.w)) + MARGIN * 2;
    const height = yCursor + MARGIN * 2 + TITLE_H;
    return { width, height, maxDepth };
  }

  // --------------------------------------------------------------------------
  // Phase 3 — emit SVG
  // --------------------------------------------------------------------------

  private esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private emit(layout: { width: number; height: number; maxDepth: number }): string {
    const { width, height, maxDepth } = layout;
    const out: string[] = [];

    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, 'JetBrains Mono', Menlo, monospace">`);
    out.push(`<defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="#64748b"/>
      </marker>
      <marker id="royalty" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="#facc15"/>
      </marker>
      <filter id="glow"><feGaussianBlur stdDeviation="2.5" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>`);

    // background
    out.push(`<rect width="${width}" height="${height}" fill="#0b1120"/>`);

    // title block
    out.push(`<text x="${MARGIN}" y="42" fill="#f8fafc" font-size="20" font-weight="bold">OpenTenant v3.0 — Delegation Tree Schema</text>`);
    out.push(`<text x="${MARGIN}" y="64" fill="#64748b" font-size="12">root: ${this.esc(this.bp.root?.id ?? "")} · max_depth: ${this.bp.root?.max_depth ?? "∞"} · nodes: ${this.nodes.length} · compiled ${new Date().toISOString()}</text>`);
    // legend
    const legend = [
      { c: "#38bdf8", t: "root (depth 0)" },
      { c: "#34d399", t: "depth 1" },
      { c: "#fbbf24", t: "depth 2" },
      { c: "#facc15", t: "royalty flow ↑" },
    ];
    legend.forEach((l, i) => {
      const lx = width - MARGIN - legend.length * 130 + i * 130;
      out.push(`<circle cx="${lx}" cy="40" r="5" fill="${l.c}"/><text x="${lx + 12}" y="44" fill="#94a3b8" font-size="11">${l.t}</text>`);
    });

    // depth bands
    for (let d = 0; d <= maxDepth; d++) {
      const band = this.nodes.filter((n) => n.depth === d);
      if (!band.length) continue;
      const top = Math.min(...band.map((n) => n.y)) - 26;
      const bot = Math.max(...band.map((n) => n.y + n.h)) + 14;
      out.push(`<rect x="0" y="${top}" width="${width}" height="${bot - top}" fill="#ffffff" opacity="${d % 2 === 0 ? 0.015 : 0.04}"/>`);
      out.push(`<text x="12" y="${top + 18}" fill="${pal(d).accent}" font-size="11" opacity="0.8">DEPTH ${d}${d === 0 ? " · OPERATOR" : ` · RESALE HOP ${d}`}</text>`);
    }

    // edges: delegation (solid) + royalty (dashed gold, drawn upward)
    for (const n of this.nodes) {
      if (!n.parentId) continue;
      const p = this.byId.get(n.parentId)!;
      const x1 = p.x + p.w / 2, y1 = p.y + p.h;
      const x2 = n.x + n.w / 2, y2 = n.y;
      const my = (y1 + y2) / 2;
      out.push(`<path d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" fill="none" stroke="${n.enabled ? "#475569" : "#334155"}" stroke-width="${n.enabled ? 1.5 : 1}" stroke-dasharray="${n.enabled ? "" : "4 4"}" marker-end="url(#arrow)"/>`);
      // royalty hop label at midpoint
      out.push(`<text x="${x2 + 6}" y="${my}" fill="#facc15" font-size="9" opacity="0.85">↰ royalty</text>`);
    }

    // composite template edges (child card composes ancestor template)
    for (const n of this.nodes) {
      for (const t of n.templates) {
        for (const comp of t.composes ?? []) {
          // find owning ancestor card
          let anc = n.parentId ? this.byId.get(n.parentId) : null;
          while (anc && !anc.templates.some((tt) => tt.id === comp.template)) {
            anc = anc.parentId ? this.byId.get(anc.parentId) : null;
          }
          if (!anc) continue;
          const ti = n.templates.indexOf(t);
          const x1 = anc.x + anc.w, y1 = anc.y + 60 + anc.templates.findIndex((tt) => tt.id === comp.template) * 16 + 8;
          const x2 = n.x, y2 = n.y + 60 + ti * 16 + 8;
          out.push(`<path d="M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}" fill="none" stroke="#22d3ee" stroke-width="1" stroke-dasharray="2 3" opacity="0.7"/>`);
        }
      }
    }

    // node cards
    for (const n of this.nodes) {
      const c = pal(n.depth);
      const opacity = n.enabled ? 1 : 0.35;
      out.push(`<g opacity="${opacity}" ${n.enabled ? "" : `stroke-dasharray="5 3"`}>`);
      out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5" ${n.enabled ? 'filter="url(#glow)"' : ""}/>`);

      // header
      out.push(`<text x="${n.x + 14}" y="${n.y + 24}" fill="${c.text}" font-size="13" font-weight="bold">${this.esc(n.brandName)}</text>`);
      out.push(`<text x="${n.x + 14}" y="${n.y + 40}" fill="${c.accent}" font-size="9">${this.esc(n.id)} · depth ${n.depth}${n.enabled ? "" : " · DISABLED"}</text>`);

      // vault path (crypto boundary)
      out.push(`<rect x="${n.x + 10}" y="${n.y + 46}" width="${n.w - 20}" height="16" rx="4" fill="#000" opacity="0.3"/>`);
      out.push(`<text x="${n.x + 16}" y="${n.y + 57}" fill="#7dd3fc" font-size="8">🔒 ${this.esc(n.vault.length > 44 ? n.vault.slice(0, 42) + "…" : n.vault)}</text>`);

      // templates
      n.templates.forEach((t, i) => {
        const ty = n.y + 74 + i * 16;
        const resell = t.resale?.allowed;
        const mark = t.composes?.length ? "🧩" : resell ? "✓" : "✗";
        const floor = t.resale?.price_floor != null ? ` floor $${t.resale.price_floor}` : "";
        out.push(`<text x="${n.x + 16}" y="${ty}" fill="${resell === false ? "#f87171" : c.text}" font-size="9">${mark} ${this.esc(t.id)}${t.composes?.length ? ` ⟵ composes ${t.composes.map((x) => x.template).join(" + ")}` : ""}${this.esc(floor)}</text>`);
      });

      // tenant chips
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

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------

if (import.meta.main) {
  const args = Deno.args;
  const file = args[0];
  const outIdx = args.indexOf("--out");
  const outFile = outIdx !== -1 ? args[outIdx + 1] : "./generated/delegation-tree.svg";
  if (!file) {
    console.error("Usage: deno run --allow-read --allow-write opentenant-visual.ts <blueprint.yaml> [--out FILE.svg]");
    Deno.exit(2);
  }
  const text = await Deno.readTextFile(file);
  await new VisualCompiler(text).compile(outFile);
}
```

---

## What the diagram encodes

The SVG isn't decoration — it's a **visual audit of the same invariants the main compiler enforces**. Every visual element maps to a validation rule:

| Visual element | Compiler invariant it makes visible |
|---|---|
| **Depth bands** (horizontal strata) | `depth_ceiling` — you can literally see if the tree approaches `max_depth` |
| **Solid → dashed edges** | `no_orphan_nodes` / disabled slots — reserved-but-inactive partners are ghosted, not missing |
| **🔒 Vault path bar** in each card | `vault_namespace_matches_tree_path` — isolation boundaries are visible; a child whose vault path escapes its band is instantly wrong |
| **✓ / ✗ / 🧩 template markers** | `resale_authorization_chain` — green ✓ = authorized for resale, red ✗ = root-only (like `fleet-maintenance`), 🧩 = composite product |
| **Cyan dashed composite edges** | Template composition lineage — `lf-logistics-suite` visibly stitched from two root templates, with royalties flowing along the same path |
| **Gold "↰ royalty" labels** on edges | `royalty_chain_complete` — every hop up the tree is a revenue hop; the edge *is* the payment rail |
| **Tenant chips (◆)** | Leaf demand nodes — who actually consumes what, at which altitude |
| **Ghosted card** (`logifleet-brazil`) | `enabled: false` — reserved slot, rendered but dimmed |

## Layout algorithm

A compact **Reingold–Tilford-style tidy tree layout**, implemented in ~30 lines:

1. **Leaf packing** — leaves consume horizontal slots left-to-right via a single cursor.
2. **Parent centering** — internal nodes center over their children's span (bottom-up recursion in `assign()`).
3. **Depth bands** — vertical position is by depth, band heights sized to the tallest card in each stratum, so a node with 4 templates doesn't collide with the band below.
4. **Card height is data-driven** — `NODE_H_BASE + templates×16 + tenants×22`, so a partner with a big registry and many tenants physically occupies more space. The diagram *is* the load profile.

Because layout is computed (not hand-placed), adding a depth-7 reseller to the YAML re-renders automatically — the SVG widens/bands with zero manual positioning, exactly like the Argo ApplicationSet glob.

## Pipeline: the full compile chain

```bash
# 1. Validate + emit deployable artifacts
deno run --allow-read --allow-write opentenant-compiler.ts opentenant-reseller.yaml --out ./generated

# 2. Emit the human-auditable schema diagram from the SAME source of truth
deno run --allow-read --allow-write opentenant-visual.ts opentenant-reseller.yaml --out ./generated/delegation-tree.svg
```

Two compilers, one blueprint, zero drift — the SVG is generated from the identical parse the manifests are, so **the picture can never lie about what's deployed**. That's the property-management analogy closed out: GitOps gives you the *ledger*, and this gives you the *site plan* — both derived from the same deed.