import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const svg = d3.select("#graph");
const width = 1200, height = 760;
const scene = svg.append("g");
scene.append("rect").attr("class","graph-bg").attr("x",0).attr("y",0).attr("width",width).attr("height",height);
const linksLayer = scene.append("g");
const nodesLayer = scene.append("g");
const zoom = d3.zoom().scaleExtent([0.45,2.5]).on("zoom", e => scene.attr("transform", e.transform));
svg.call(zoom);

d3.select("#reset").on("click",()=>svg.transition().duration(350).call(zoom.transform,d3.zoomIdentity));
d3.select("#fit").on("click",fit);
d3.select("#refresh").on("click",load);

function statusColor(status){return ({healthy:"#34d399",degraded:"#fbbf24",unknown:"#94a3b8",reserved:"#64748b"})[status]??"#94a3b8"}
function esc(s){return String(s??"")}
function labelFor(n){return n.kind === "tenant" ? n.id.replace(/^tenant:/,"") : n.id.replace(/^node:/,"")}
function render(data){
  d3.select("#stat-total").text(data.summary.total);
  d3.select("#stat-healthy").text(data.summary.healthy);
  d3.select("#stat-degraded").text(data.summary.degraded);
  d3.select("#stat-unknown").text(data.summary.unknown);
  d3.select("#generated").text(new Date(data.generatedAt).toLocaleString());
  d3.select("#conn-kube").text(`Kubernetes · ${data.mode.kubernetes}`);
  d3.select("#conn-vault").text(`Vault · ${data.mode.vault}`);

  const byId = new Map(data.nodes.map(n=>[n.id,n]));
  const roots = data.nodes.filter(n=>!n.parentId);
  const children = id => data.nodes.filter(n=>n.parentId===id);
  const root = roots[0] ?? {id:"root",path:"opentenant",kind:"cluster",status:"unknown"};
  const rootNode = d3.hierarchy(root, n=>children(n.id));
  const allNodes = rootNode.descendants();
  const layout = d3.tree().nodeSize([120,190]).separation((a,b)=>a.parent===b.parent?1.1:1.7);
  layout(rootNode);
  const x0=d3.min(allNodes,d=>d.x)??0, x1=d3.max(allNodes,d=>d.x)??0;
  const dx=(x0+x1)/2;
  allNodes.forEach(n=>{n.x=n.x-dx+600;n.y=80+n.depth*180});

  linksLayer.selectAll("* ").remove(); nodesLayer.selectAll("*").remove();
  linksLayer.selectAll("path").data(rootNode.links()).join("path").attr("class","link").attr("d",d3.linkVertical().x(d=>d.x).y(d=>d.y));
  linksLayer.selectAll("circle").data(allNodes).join("circle").attr("cx",d=>d.x).attr("cy",d=>d.y).attr("r",3).attr("fill",d=>statusColor(d.data.status));

  const g=nodesLayer.selectAll("g").data(allNodes).join("g").attr("class","node-card").attr("transform",d=>`translate(${d.x-125},${d.y-48})`).on("click",(_,d)=>selectNode(d.data));
  g.append("rect").attr("class","node-box").attr("width",250).attr("height",96).attr("rx",10).attr("stroke",d=>statusColor(d.data.status));
  g.append("circle").attr("cx",16).attr("cy",17).attr("r",5).attr("fill",d=>statusColor(d.data.status));
  g.append("text").attr("class","node-title").attr("x",30).attr("y",21).text(d=>labelFor(d.data));
  g.append("text").attr("class","node-kind").attr("x",16).attr("y",42).text(d=>`${d.data.kind} · ${d.data.status}`);
  g.append("text").attr("class","node-sub").attr("x",16).attr("y",59).text(d=>d.data.namespace?`ns ${d.data.namespace}`:"no namespace");
  g.append("text").attr("class","node-sub").attr("x",16).attr("y",73).text(d=>`${d.data.cloud??"cloud —"} · ${d.data.region??"region —"}`);
  g.append("text").attr("class","source-text").attr("x",16).attr("y",87).text(d=>`source: ${d.data.source}`);
  fit();
}

function selectNode(n){
  const panel=d3.select("#selection");
  panel.html(`
    <div class="selection-title">${esc(labelFor(n))}</div>
    <div class="meta">
      <div class="meta-row"><span>Kind</span><b>${esc(n.kind)}</b></div>
      <div class="meta-row"><span>Status</span><b><span class="badge">${esc(n.status)}</span></b></div>
      <div class="meta-row"><span>Path</span><b>${esc(n.path)}</b></div>
      <div class="meta-row"><span>Namespace</span><b>${esc(n.namespace??"—")}</b></div>
      <div class="meta-row"><span>Cloud</span><b>${esc(n.cloud??"—")}</b></div>
      <div class="meta-row"><span>Region</span><b>${esc(n.region??"—")}</b></div>
      <div class="meta-row"><span>Workloads</span><b>${n.readyWorkloads}/${n.workloads} ready</b></div>
      <div class="meta-row"><span>Source</span><b>${esc(n.source)}</b></div>
    </div>`);
  nodesLayer.selectAll("rect.node-box").classed("selected",false);
  nodesLayer.selectAll("g").filter(d=>d.data.id===n.id).select("rect.node-box").classed("selected",true);
}

function fit(){
  const bbox=scene.node().getBBox();
  const scale=Math.min(width/(bbox.width+80),height/(bbox.height+80),1.15);
  const tx=(width-(bbox.width*scale))/2-bbox.x*scale;
  const ty=(height-(bbox.height*scale))/2-bbox.y*scale;
  svg.transition().duration(450).call(zoom.transform,d3.zoomIdentity.translate(tx,ty).scale(scale));
}

async function load(){
  try{
    const res=await fetch("/api/topology",{cache:"no-store"});
    const data=await res.json();
    render(data);
    const errors=d3.select("#errors");
    errors.text(data.errors?.length?data.errors.join(" · "):"");
  }catch(err){d3.select("#errors").text(String(err));}
}
load();
setInterval(load,30000);
