#!/usr/bin/env -S deno run --allow-read --allow-write

import { parse as parseYaml } from "https://deno.land/std@0.224.0/yaml/mod.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/ensure_dir.ts";
import { dirname, resolve } from "https://deno.land/std@0.224.0/path/mod.ts";

interface TemplateDef {
  id: string;
  engine?: string;
  version?: string;
  composes?: { template: string }[];
  resale?: { allowed?: boolean; price_floor?: number; royalty_per_seat?: number };
}

interface TenantDef {
  placement?: { cloud?: string; region?: string; cluster_pool?: string };
  id: string;
  tier?: string;
  namespace?: string;
  enabled?: boolean;
  subscriptions?: { template: string }[];
  placement?: { cloud?: string; region?: string };
}

interface NodeDef {
  id: string;
  kind?: string;
  parent?: string;
  depth?: number;
  enabled?: boolean;
  brand?: { name?: string; domain?: string; theme?: string };
  vault_namespace?: string;
  kubernetes?: { cluster_pool?: string; namespace_prefix?: string; resource_quotas?: { cpu?: string; memory?: string } };
  template_registry?: TemplateDef[];
  inherited_registry_policy?: { template: string; resale?: TemplateDef["resale"] }[];
  tenants?: TenantDef[];
  children?: NodeDef[];
}

interface RoyaltySchedule { depth: number | "default"; keep_pct: number; pass_up_pct: number; }
interface Blueprint {
  version?: string;
  root: { id: string; domain?: string; max_depth?: number; royalty_schedule?: RoyaltySchedule[] };
  template_registry?: TemplateDef[];
  delegation_tree: NodeDef[];
}

interface VNode {
  id: string; path: string; depth: number; enabled: boolean; brandName: string; vault: string;
  templates: TemplateDef[]; tenants: TenantDef[]; x: number; y: number; w: number; h: number; parentId: string | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

class VisualCompiler {
  private bp: Blueprint;
  private nodes: VNode[] = [];
  private byId = new Map<string, VNode>();
  private errors: string[] = [];

  constructor(text: string) {
    this.bp = parseYaml(text) as Blueprint;
    if (!this.bp?.root?.id) throw new Error("Blueprint missing required root.id");
    if (!this.bp?.delegation_tree) throw new Error("Blueprint missing required delegation_tree:");
  }

  private flatten(): void {
    const root = this.bp.root;
    const globalTemplates = this.bp.template_registry ?? [];
    this.nodes.push({
      id: root.id, path: root.id, depth: 0, enabled: true,
      brandName: `ROOT · ${root.domain ?? ""}`.trim(), vault: "secret/data/opentenant/core",
      templates: globalTemplates, tenants: [], x: 0, y: 0, w: 300,
      h: 92 + globalTemplates.length * 16, parentId: null,
    });
    this.byId.set(root.id, this.nodes[0]);

    const walk = (n: NodeDef, parent: string, path: string[], depth: number, inherited: Map<string, TemplateDef>) => {
      if (this.byId.has(n.id)) { this.errors.push(`Duplicate node id '${n.id}'`); return; }
      if (n.parent && n.parent !== parent) this.errors.push(`Parent mismatch for '${n.id}': declared '${n.parent}', tree parent '${parent}'`);
      if (n.depth != null && n.depth !== depth) this.errors.push(`Depth mismatch for '${n.id}': declared ${n.depth}, computed ${depth}`);
      if (this.bp.root.max_depth != null && depth > this.bp.root.max_depth) this.errors.push(`Depth ceiling exceeded at '${n.id}'`);

      const effective = new Map(inherited);
      for (const t of n.template_registry ?? []) {
        effective.set(t.id, t);
        for (const comp of t.composes ?? []) {
          const upstream = effective.get(comp.template);
          if (!upstream) this.errors.push(`Composite '${t.id}' references missing upstream '${comp.template}'`);
          else if (upstream.resale?.allowed !== true) this.errors.push(`Composite '${t.id}' references non-resellable '${comp.template}'`);
        }
      }

      const tenants = n.tenants ?? [];
      for (const tenant of tenants) {
        if (tenant.enabled !== false && tenant.placement && (!tenant.placement.cloud || !tenant.placement.region)) {
          this.errors.push(`Tenant '${tenant.id}' placement must include both cloud and region`);
        }
        if (!new Set(["basic", "standard", "premium", "platinum"]).has(tenant.tier ?? "")) {
          this.errors.push(`Invalid tenant tier '${tenant.tier}' for '${tenant.id}'`);
        }
        for (const sub of tenant.subscriptions ?? []) if (!effective.has(sub.template)) {
          this.errors.push(`Tenant '${tenant.id}' references unknown template '${sub.template}' at '${n.id}'`);
        }
      }

      const templates = [...effective.values()].filter(t => t.resale?.allowed !== false || (n.template_registry ?? []).some(x => x.id === t.id));
      const v: VNode = {
        id: n.id,
        path: [...path, n.id].join("/"),
        depth,
        enabled: n.enabled !== false,
        brandName: n.brand?.name ?? n.id,
        vault: n.vault_namespace ?? `opentenant/${[...path, n.id].join("/")}`,
        templates, tenants,
        x: 0, y: 0, w: 300,
        h: 92 + templates.length * 16 + tenants.length * 22,
        parentId: parent,
      };
      this.nodes.push(v); this.byId.set(n.id, v);

      if (n.vault_namespace && !n.vault_namespace.includes(n.id) && depth > 1) {
        this.errors.push(`Vault namespace for '${n.id}' does not contain node id`);
      }
      for (const child of n.children ?? []) walk(child, n.id, [...path, n.id], depth + 1, effective);
    };

    const rootTemplates = new Map<string, TemplateDef>();
    for (const t of globalTemplates) rootTemplates.set(t.id, t);
    for (const top of this.bp.delegation_tree) walk(top, root.id, [], 1, rootTemplates);

    for (const n of this.nodes) {
      if (n.depth === 0) continue;
      const sched = (root.royalty_schedule ?? []).find(s => s.depth === n.depth) ?? (root.royalty_schedule ?? []).find(s => s.depth === "default");
      if (!sched) this.errors.push(`No royalty schedule covers depth ${n.depth}`);
      else if (sched.keep_pct + sched.pass_up_pct !== 100) this.errors.push(`Royalty schedule for depth ${String(sched.depth)} is not balanced`);
    }
    if (this.errors.length) throw new Error(`Visual audit failed:\n- ${this.errors.join("\n- ")}`);
  }

  private cloud(tenant: TenantDef): string {
    return tenant.placement?.cloud?.toUpperCase() ?? "UNPLACED";
  }

  private layoutTopology() {
    const root = this.nodes.find(n => n.depth === 0)!;
    const direct = this.nodes.filter(n => n.depth === 1);
    const centerX = 600;
    const directY = 390;
    direct.forEach((n, i) => {
      const span = Math.max(260, 840 / Math.max(1, direct.length));
      n.x = centerX - ((direct.length - 1) * span) / 2 + i * span - n.w / 2;
      n.y = directY;
    });
    root.x = centerX - root.w / 2;
    root.y = 185;
  }

  private emit(): string {
    const width = 1200, height = 780;
    const root = this.nodes.find(n => n.depth === 0)!;
    const direct = this.nodes.filter(n => n.depth === 1 && n.enabled);
    const disabled = this.nodes.filter(n => !n.enabled);
    const allTenants = this.nodes.flatMap(owner => owner.tenants.map(tenant => ({ tenant, owner })));
    const tenantCount = allTenants.filter(x => x.tenant.enabled !== false && x.owner.enabled).length;
    const activeNodeCount = this.nodes.filter(n => n.enabled).length;
    const vaultCount = allTenants.filter(x => x.owner.enabled).length;
    const awsCount = allTenants.filter(x => this.cloud(x.tenant) === "AWS").length;
    const gcpCount = allTenants.filter(x => this.cloud(x.tenant) === "GCP").length;

    this.layoutTopology();

    const out: string[] = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="control-plane-title control-plane-desc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">`);
    out.push(`<title id="control-plane-title">OpenTenant control plane tenant topology dashboard</title>`);
    out.push(`<desc id="control-plane-desc">OpenTenant sits between source systems and shared platform services. The center topology maps reseller ownership to real tenant releases and their Vault, Supabase, and cloud placement.</desc>`);
    out.push(`<defs>
      <radialGradient id="halo"><stop offset="0" stop-color="#2dd4a7" stop-opacity=".18"/><stop offset="1" stop-color="#2dd4a7" stop-opacity="0"/></radialGradient>
      <linearGradient id="flow"><stop offset="0" stop-color="#22d3ee" stop-opacity=".10"/><stop offset=".5" stop-color="#38bdf8" stop-opacity=".9"/><stop offset="1" stop-color="#22d3ee" stop-opacity=".10"/></linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>`);
    out.push(`<rect width="1200" height="780" fill="#0b1120"/>`);
    out.push(`<rect x="56" y="18" width="1088" height="744" rx="16" fill="#090d15" stroke="#263244"/>`);
    out.push(`<line x1="56" y1="72" x2="1144" y2="72" stroke="#263244"/>`);
    out.push(`<circle cx="82" cy="44" r="5" fill="#2dd4a7"/>`);
    out.push(`<text x="98" y="48" fill="#94a3b8" font-size="11" letter-spacing="1.8">TOPOLOGY SYNCHRONIZED</text>`);
    out.push(`<text x="1118" y="48" text-anchor="end" fill="#94a3b8" font-size="11" letter-spacing="1.5">${activeNodeCount} ACTIVE NODES · ${tenantCount} TENANT RELEASES</text>`);

    // Existing integration surfaces kept as the outer control-plane shell.
    out.push(`<circle cx="600" cy="250" r="205" fill="url(#halo)"/>`);
    out.push(`<circle cx="600" cy="250" r="190" fill="none" stroke="#263244" stroke-dasharray="4 12" class="control-plane__orbit control-plane__orbit--slow"/>`);
    out.push(`<circle cx="600" cy="250" r="147" fill="none" stroke="#22d3ee" stroke-opacity=".25" stroke-width="1.5" stroke-dasharray="32 18 5 18" class="control-plane__orbit control-plane__orbit--reverse"/>`);
    out.push(`<circle cx="600" cy="250" r="108" fill="none" stroke="#2dd4a7" stroke-opacity=".42" stroke-width="2" stroke-dasharray="72 26" class="control-plane__orbit"/>`);
    out.push(`<path d="M600 60A190 190 0 0 1 790 250" fill="none" stroke="#2dd4a7" stroke-opacity=".7" stroke-width="3" class="control-plane__scan"/>`);

    const left = [
      [142, "GITHUB", "M250 118 C360 118 430 184 484 218"],
      [232, "GITLAB", "M250 232 C360 232 430 228 484 238"],
      [322, "VAULT", "M250 346 C360 346 430 274 484 254"],
    ];
    const right = [
      [118, "AWS", "M950 118 C840 118 770 184 716 218"],
      [228, "GCP", "M950 228 C840 228 770 228 716 238"],
      [338, "SUPABASE", "M950 338 C840 338 770 274 716 254"],
      [448, "CLOUDFLARE", "M950 448 C840 448 770 306 716 270"],
    ];
    const emitSide = (items: (number|string)[][], side: "left"|"right") => items.forEach((p, i) => {
      const y = Number(p[0]), label = String(p[1]), d = String(p[2]);
      const boxX = side === "left" ? 92 : 950;
      const dotX = side === "left" ? 112 : 970;
      const textX = side === "left" ? 128 : 986;
      const id = `${side}-${i}`;
      out.push(`<path id="p-${id}" d="${d}" fill="none" stroke="url(#flow)" stroke-opacity=".4" stroke-width="1.5"/>`);
      out.push(`<circle r="4" fill="#38bdf8" filter="url(#glow)" class="control-plane__packet"><animateMotion dur="${4.3 + i * .45}s" repeatCount="indefinite" begin="-${i * .6}s"><mpath href="#p-${id}"/></animateMotion></circle>`);
      out.push(`<rect x="${boxX}" y="${y - 24}" width="158" height="48" rx="8" fill="#151b25" stroke="#263244"/>`);
      out.push(`<circle cx="${dotX}" cy="${y}" r="5" fill="#2dd4a7"/>`);
      out.push(`<text x="${textX}" y="${y + 4}" fill="#e2e8f0" font-size="12" letter-spacing="1.5">${label}</text>`);
    });
    emitSide(left, "left"); emitSide(right, "right");

    out.push(`<g class="control-plane__core"><circle cx="600" cy="250" r="90" fill="#151b25" stroke="#2dd4a7" stroke-opacity=".58" stroke-width="2"/><circle cx="600" cy="250" r="73" fill="#0b1120" stroke="#263244"/><rect x="578" y="192" width="44" height="44" rx="10" fill="#2dd4a7"/><path d="M589 225V203h8v22M603 225v-22h8v22M585 229h30" fill="none" stroke="#06251e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><text x="600" y="262" text-anchor="middle" fill="#f8fafc" font-family="sans-serif" font-weight="700" font-size="18">OpenTenant</text><text x="600" y="285" text-anchor="middle" fill="#94a3b8" font-size="10" letter-spacing="2">CONTROL PLANE</text><circle cx="600" cy="310" r="4" fill="#2dd4a7" class="control-plane__pulse"/></g>`);

    // Small star topology: root -> direct resellers -> actual tenants.
    out.push(`<text x="600" y="345" text-anchor="middle" fill="#64748b" font-size="9" letter-spacing="1.8">COMPILED TENANT TOPOLOGY</text>`);
    for (const n of direct) {
      const cx = n.x + n.w / 2;
      const label = n.brandName.length > 25 ? n.brandName.slice(0, 24) + "…" : n.brandName;
      out.push(`<path d="M600 324 C600 342 ${cx} 350 ${cx} ${n.y}" fill="none" stroke="#2dd4a7" stroke-opacity=".36" stroke-width="1.2"/>`);
      out.push(`<circle cx="${cx}" cy="${n.y}" r="5" fill="#2dd4a7" filter="url(#glow)"/>`);
      out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="72" rx="10" fill="#111824" stroke="#2dd4a7" stroke-opacity=".45"/>`);
      out.push(`<text x="${cx}" y="${n.y + 24}" text-anchor="middle" fill="#e2e8f0" font-size="11" font-weight="700">${esc(label.toUpperCase())}</text>`);
      out.push(`<text x="${cx}" y="${n.y + 41}" text-anchor="middle" fill="#94a3b8" font-size="8">reseller · depth 1 · ${n.id}</text>`);
      out.push(`<text x="${cx}" y="${n.y + 56}" text-anchor="middle" fill="#64748b" font-size="7.5">Vault subtree · Supabase RLS · ${n.tenants.length} tenant${n.tenants.length === 1 ? "" : "s"}</text>`);
    }

    // Actual tenant cards, distributed under their owning nodes; each is explicitly placed on AWS/GCP.
    const tenantRows: { x:number; y:number; tenant: TenantDef; owner: VNode }[] = [];
    const active = allTenants.filter(x => x.tenant.enabled !== false && x.owner.enabled);
    const cols = Math.min(4, Math.max(1, active.length));
    const cardW = 220, gap = 18;
    const startX = 600 - ((cols * cardW + (cols - 1) * gap) / 2);
    active.forEach((item, i) => tenantRows.push({ x: startX + (i % cols) * (cardW + gap), y: 520 + Math.floor(i / cols) * 104, tenant: item.tenant, owner: item.owner }));

    for (const row of tenantRows) {
      const cloud = this.cloud(row.tenant);
      const cloudStroke = cloud === "AWS" ? "#38bdf8" : cloud === "GCP" ? "#2dd4a7" : "#64748b";
      const ownerCx = row.owner.x + row.owner.w / 2;
      out.push(`<path d="M${ownerCx} ${row.owner.y + 72} C${ownerCx} 468 ${row.x + cardW / 2} 492 ${row.x + cardW / 2} 520" fill="none" stroke="${cloudStroke}" stroke-opacity=".35" stroke-width="1.2"/>`);
      out.push(`<circle cx="${row.x + cardW / 2}" cy="520" r="4" fill="${cloudStroke}" filter="url(#glow)"/>`);
      out.push(`<rect x="${row.x}" y="520" width="${cardW}" height="88" rx="10" fill="#111824" stroke="#263244"/>`);
      out.push(`<text x="${row.x + 14}" y="542" fill="#e2e8f0" font-size="10" font-weight="700">${esc(row.tenant.id.toUpperCase())}</text>`);
      out.push(`<text x="${row.x + cardW - 14}" y="542" text-anchor="end" fill="${cloudStroke}" font-size="9" font-weight="700">${esc(cloud)}</text>`);
      out.push(`<text x="${row.x + 14}" y="559" fill="#7dd3fc" font-size="7.4">VAULT · ${esc(row.owner.vault.length > 36 ? row.owner.vault.slice(0, 33) + "…" : row.owner.vault)}</text>`);
      out.push(`<text x="${row.x + 14}" y="574" fill="#94a3b8" font-size="7.4">SUPABASE · ${esc(`reseller_${row.owner.id.replace(/-/g, "_")}.*`)}</text>`);
      out.push(`<text x="${row.x + 14}" y="589" fill="#64748b" font-size="7.2">${esc((row.tenant.tier ?? "unknown") + " · " + (row.tenant.namespace ?? "namespace pending"))}</text>`);
      if (row.tenant.placement?.region) out.push(`<text x="${row.x + cardW - 14}" y="589" text-anchor="end" fill="#64748b" font-size="7.2">${esc(row.tenant.placement.region)}</text>`);
    }

    for (const n of disabled) {
      const x = 82 + disabled.indexOf(n) * 214;
      out.push(`<rect x="${x}" y="654" width="198" height="55" rx="9" fill="#0f1620" stroke="#475569" stroke-dasharray="5 4" opacity=".65"/>`);
      out.push(`<text x="${x + 12}" y="676" fill="#94a3b8" font-size="8.5" font-weight="700">RESERVED · ${esc(n.id.toUpperCase())}</text>`);
      out.push(`<text x="${x + 12}" y="692" fill="#64748b" font-size="7.2">disabled · vault slot retained · artifacts skipped</text>`);
    }

    out.push(`<line x1="72" y1="728" x2="1128" y2="728" stroke="#263244"/>`);
    out.push(`<text x="72" y="749" fill="#64748b" font-size="8.5" letter-spacing="1.5">PLACEMENT</text>`);
    out.push(`<text x="142" y="749" fill="#38bdf8" font-size="8.5">AWS ${awsCount}</text>`);
    out.push(`<text x="208" y="749" fill="#2dd4a7" font-size="8.5">GCP ${gcpCount}</text>`);
    out.push(`<text x="302" y="749" fill="#64748b" font-size="8.5">VAULT ${vaultCount} scoped tenant owner${vaultCount === 1 ? "" : "s"}</text>`);
    out.push(`<text x="1118" y="749" text-anchor="end" fill="#64748b" font-size="8.5">MAX DEPTH ${this.bp.root.max_depth ?? "∞"} · ROOT ${esc(root.id)}</text>`);
    out.push(`</svg>`);
    return out.join("\n");
  }

  async compile(outFile: string): Promise<void> {
    console.log("🎨 OpenTenant v3.0 — Control Plane Visual Compiler");
    this.flatten();
    await ensureDir(dirname(resolve(outFile)));
    await Deno.writeTextFile(outFile, this.emit());
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
