## The prompt

something like this but for users their spaces and processes managed by them
instead of buckets we define users and insted of media processing we define executable definition files like the pm2config/helmchart/dockercompose 

we dont actually define the processes in the this yaml file that we are blueprinting now those are imported from templates which contain multiple -> dockercompose/pm2json/helmchart

lets call this opentenant system for whitelabel managing and its configured by vault fully, we have some kind platform service configuration and per tenant configuration in this yaml file, so we have pertenant userspace and pertant setup of dockercompose/pm2json/helmchart as well as the platform itself, and the platform can run the platform.

```yaml
# audio-pipeline.yaml
name: "Audio Processing Pipeline"
pipelineId: "audio-pipeline"
runId:
  mode: "deterministic"
  template: "{baseFilename}"
description: "Sequential audio processing: extract → normalize → waveform"
version: "1.0.0"

editor:
  compressionLevel: 23
  preset: "medium"
  aspectRatio: "16:9"
  framerate: 30
  opacity: 1.0

storage:
  output_bucket: "audio-processed"
  buckets:
    - name: "audio-uploads"
      public: false
      allowed_mime_types: ["audio/mpeg", "audio/wav", "audio/flac", "video/mp4"]
    - name: "audio-temp-1"
      public: false
      allowed_mime_types: ["audio/wav"]
    - name: "audio-processed"
      public: true
      allowed_mime_types: ["audio/mpeg", "image/png"]

  rls_policies:
    - name: "Users can upload to their own audio folders"
      operation: "INSERT"
      role: "authenticated"
      condition: |
        (bucket_id IN ('audio-uploads', 'audio-temp-1', 'audio-processed')) AND
        (storage.foldername(name))[1] = auth.uid()::text

steps:
  - id: "normalize_loudness"
    trigger:
      name: "handle_normalize_audio"
      event: "INSERT"
      table: "storage.objects"
      condition: |
        NEW.bucket_id = 'audio-uploads' AND
        NEW.name NOT LIKE '%.emptyFolderPlaceholder'
    command: -i $MEDIA_1 -af loudnorm=I=-16:LRA=11:TP=-1.5 -c:a libmp3lame -b:a 192k -f mp3 -y $OUTPUT_PATH
    inputs: ["INPUT_FILE"]
    outputs: ["OUTPUT_FILE"]
    output_path: "{{userId}}/{{pipelineId}}/{{runId}}/podcast/{{baseFilename}}.mp3"
    editor:
      output: "mp3"
      preset: "medium"
      selectedCode: "custom"
      compressionLevel: 23
    next_bucket: "audio-processed"
    keep: true   # MP3 is permanently stored

  - id: "generate_waveform"
    trigger:
      name: "handle_waveform"
      event: "INSERT"
      table: "storage.objects"
      condition: |
        NEW.bucket_id = 'audio-processed' AND
        NEW.name LIKE '%.mp3' AND
        NEW.name NOT LIKE '%.emptyFolderPlaceholder'
    command: -i $MEDIA_1 -filter_complex showwavespic=s=1200x200:colors=#FC6D26 -frames:v 1 -f image2 -y $OUTPUT_PATH
    inputs: ["INPUT_FILE"]
    outputs: ["OUTPUT_FILE"]
    output_path: "{{userId}}/{{pipelineId}}/{{runId}}/waveforms/{{baseFilename}}.png"
    editor:
      output: "png"
      preset: "medium"
      selectedCode: "custom"
      width: 1200
      height: 200
    next_bucket: "audio-processed"
    keep: true   # PNG is also permanently stored

render:
  project_name: "audio-processing"
  status: "queued"
  public: false
```

## The answer
Here is the complete architectural layout and system schema for your OpenTenant Whitelabel Management System.
In this architecture, your infrastructure file acts purely as a composition and bindings engine. It strips out raw execution details, importing them instead from standardized templates (such as Docker Compose, PM2 JSON ecosystem descriptors, or Helm charts). It binds these templates directly to whitelabel platform settings and per-tenant isolated userspaces, with all sensitive variables and keys resolved natively via HashiCorp Vault.
## Architectural Flow

                 [ HashiCorp Vault ] (Secrets & Variables Injection)
                        │
                        ▼
  [ GitOps Repo ] ──► [ OpenTenant Engine ]
  (Infrastructure       │  ├─► 1. Fetches Config Templates (Docker, PM2, Helm)
   & Tenant Specs)      │  ├─► 2. Validates Dependency Graph & Spaces
                        │  └─► 3. Compiles Environments Natively
                        ▼
       ┌────────────────────────────────────────────────┐
       │             Target Target Systems              │
       ├───────────────────────┬────────────────────────┤
       │   Platform Services   │    Tenant Userspaces   │
       │ (Core API, Mesh, etc.)│ (Tenant A, Tenant B...)│
       └───────────────────────┴────────────────────────┘

------------------------------
## The OpenTenant Core Schema Blueprint
This schema defines your shared platform services, isolates individual whitelabel tenant configurations, sets up their respective execution runtimes (PM2, Docker Compose, or Helm), and establishes cross-tenant dependency trees.

# opentenant-infra.yamlname: "Global Whitelabel Cluster Core"systemId: "opentenant-production-01"version: "2.4.0"
# 1. PLATFORM REGISTRY & GLOBAL SERVICES# These run under the system root or platform userspace to support the tenantsplatform:
  cluster_domain: "whitelabel-platform.com"
  vault_root_path: "secret/data/opentenant/core"
  services:
    - id: "platform-routing-mesh"
      engine: "docker-compose"
      template_ref: "git::https://github.com"
      vault_mount: "secret/data/opentenant/core/routing"
      dependencies: [] # Absolute base layer

    - id: "platform-shared-db"
      engine: "helm"
      template_ref: "oci://://platform.com"
      vault_mount: "secret/data/opentenant/core/database"
      dependencies: 
        - "platform-routing-mesh"
# 2. WHITELABEL TENANT DECLARATIONS & SYSTEM TOPOLOGY# Each tenant gets a hard-isolated runtime context, userspace, and customized templatestenants:
  - id: "tenant-alpha-finance"
    enabled: true
    vault_tenant_path: "secret/data/opentenant/tenants/alpha-finance"
    
    # Target execution containment for native processes or containers
    userspace:
      unix_user: "tenant-alpha"
      pm2_home: "/home/tenant-alpha/.pm2"
      kube_namespace: "tenant-alpha-prod"
      custom_branding:
        domain: "://alphafinance.com"
        theme: "dark-emerald"

    # The concrete execution manifests pulled from templates and localized for this tenant
    deployments:
      - id: "alpha-cache-layer"
        engine: "pm2-json"
        template_ref: "git::https://github.com"
        # Overrides to patch into the standard template
        config_patches:
          max_memory: "2gb"
        dependencies:
          - "platform-shared-db" # Cross-boundary platform dependency

      - id: "alpha-core-banking-api"
        engine: "docker-compose"
        template_ref: "git::https://github.com"
        config_patches:
          replica_count: 3
          log_level: "info"
        dependencies:
          - "alpha-cache-layer"

  - id: "tenant-beta-retail"
    enabled: true
    vault_tenant_path: "secret/data/opentenant/tenants/beta-retail"
    userspace:
      unix_user: "tenant-beta"
      pm2_home: "/home/tenant-beta/.pm2"
      kube_namespace: "tenant-beta-prod"
      custom_branding:
        domain: "shop.betaretail.io"
        theme: "light-minimal"
    deployments:
      - id: "beta-commerce-backend"
        engine: "helm"
        template_ref: "helm-repo/magento-enterprise-wrap"
        config_patches:
          autoscaling:
            minReplicas: 2
        dependencies:
          - "platform-shared-db" # Both tenants consume the core platform database safely

------------------------------
## Static Compilation and Dependency Validation Engine
I have written the engine module that compiles this whitelabel topology. It performs two critical structural audits before hitting runtime:

   1. Cross-Boundary Dependency Validation: Ensures that tenant engines do not loop and cleanly resolve dependencies toward either platform engines or other tenant leaf nodes.
   2. Vault Secret Patch Simulator: Connects your templates to Vault variable mapping.

Here is your file: opentenant_compiler.py.

import os
# Ensure the output generated directory exists
os.makedirs("generated", exist_ok=True)
compiler_script = """import yaml
import sys
from collections import defaultdict

class OpenTenantCompiler:
    def __init__(self, config_path):
        with open(config_path, 'r') as f:
            self.manifest = yaml.safe_load(f)
        self.all_nodes = {}
        self.dependency_graph = defaultdict(list)

    def compile_and_validate(self):
        print(f"🏗️  Initializing OpenTenant Matrix Compilation...")
        
        # 1. Register Core Platform Services
        platform_services = self.manifest.get('platform', {}).get('services', [])
        for svc in platform_services:
            svc_id = svc['id']
            self.all_nodes[svc_id] = {'context': 'platform', 'meta': svc}
            for dep in svc.get('dependencies', []):
                self.dependency_graph[svc_id].append(dep)
                
        # 2. Register Whitelabel Tenant Spaces & Deployments
        for tenant in self.manifest.get('tenants', []):
            tenant_id = tenant['id']
            for deploy in tenant.get('deployments', []):
                dep_id = deploy['id']
                self.all_nodes[dep_id] = {'context': f'tenant:{tenant_id}', 'meta': deploy}
                for dep in deploy.get('dependencies', []):
                    self.dependency_graph[dep_id].append(dep)

        return self._run_static_checks()

    def _run_static_checks(self):
        visited = {} # 0: unvisited, 1: visiting, 2: visited
        for node in self.all_nodes:
            visited[node] = 0

        def dfs(node):
            if visited.get(node, 0) == 1:
                print(f"❌ Cycle Detected: Circular dependency tracking through engine configuration node '{node}'!")
                return False
            if visited.get(node, 0) == 2:
                return True

            visited[node] = 1
            for connection in self.dependency_graph[node]:
                if connection not in self.all_nodes:
                    print(f"❌ Missing Link: Blueprint node '{node}' requires downstream target '{connection}', which is not configured.")
                    return False
                if not dfs(connection):
                    return False
            visited[node] = 2
            return True

        for node in self.all_nodes:
            if visited[node] == 0:
                if not dfs(node):
                    return False
                    
        print("✅ OpenTenant Topology Audit Passed: Graph is acyclic and cross-tenant lines match safely.")
        return True

    def simulate_vault_and_template_hydration(self):
        """Simulates assembling dynamic configs by applying structural overrides to blueprints."""
        print("\\n🔒 Hydrating Application Footprints with Vault Context Mounts:")
        for node_id, data in self.all_nodes.items():
            context = data['context']
            meta = data['meta']
            
            # Map where Vault values drop into runtime env
            vault_path = meta.get('vault_mount') or self._get_tenant_vault_path(context)
            print(f"  ⚡ [{meta['engine'].upper()}] Compiled ID: {node_id}")
            print(f"     Scope: {context} | Vault Node: {vault_path}")
            print(f"     Source Template: {meta['template_ref']}")
            if 'config_patches' in meta:
                print(f"     Patches applied: {list(meta['config_patches'].keys())}")

    def _get_tenant_vault_path(self, context):
        if not context.startswith('tenant:'):
            return "core"
        t_id = context.split(':')[1]
        for t in self.manifest['tenants']:
            if t['id'] == t_id:
                return t['vault_tenant_path']
        return "unknown"

if __name__ == '__main__':
    # In a real environment, this reads the GitOps artifact
    print("OpenTenant Execution Module Prepared.")"""
with open("generated/opentenant_compiler.py", "w") as f:
    f.write(compiler_script)

## Running code block...

import os
# Ensure the output generated directory exists
os.makedirs("generated", exist_ok=True)
compiler_script = """import yaml
import sys
from collections import defaultdict

class OpenTenantCompiler:
    def __init__(self, config_path):
        with open(config_path, 'r') as f:
            self.manifest = yaml.safe_load(f)
        self.all_nodes = {}
        self.dependency_graph = defaultdict(list)

    def compile_and_validate(self):
        print(f"🏗️  Initializing OpenTenant Matrix Compilation...")
        
        # 1. Register Core Platform Services
        platform_services = self.manifest.get('platform', {}).get('services', [])
        for svc in platform_services:
            svc_id = svc['id']
            self.all_nodes[svc_id] = {'context': 'platform', 'meta': svc}
            for dep in svc.get('dependencies', []):
                self.dependency_graph[svc_id].append(dep)
                
        # 2. Register Whitelabel Tenant Spaces & Deployments
        for tenant in self.manifest.get('tenants', []):
            tenant_id = tenant['id']
            for deploy in tenant.get('deployments', []):
                dep_id = deploy['id']
                self.all_nodes[dep_id] = {'context': f'tenant:{tenant_id}', 'meta': deploy}
                for dep in deploy.get('dependencies', []):
                    self.dependency_graph[dep_id].append(dep)

        return self._run_static_checks()

    def _run_static_checks(self):
        visited = {} # 0: unvisited, 1: visiting, 2: visited
        for node in self.all_nodes:
            visited[node] = 0

        def dfs(node):
            if visited.get(node, 0) == 1:
                print(f"❌ Cycle Detected: Circular dependency tracking through engine configuration node '{node}'!")
                return False
            if visited.get(node, 0) == 2:
                return True

            visited[node] = 1
            for connection in self.dependency_graph[node]:
                if connection not in self.all_nodes:
                    print(f"❌ Missing Link: Blueprint node '{node}' requires downstream target '{connection}', which is not configured.")
                    return False
                if not dfs(connection):
                    return False
            visited[node] = 2
            return True

        for node in self.all_nodes:
            if visited[node] == 0:
                if not dfs(node):
                    return False
                    
        print("✅ OpenTenant Topology Audit Passed: Graph is acyclic and cross-tenant lines match safely.")
        return True

    def simulate_vault_and_template_hydration(self):
        \"\"\"Simulates assembling dynamic configs by applying structural overrides to blueprints.\"\"\"
        print("\\n🔒 Hydrating Application Footprints with Vault Context Mounts:")
        for node_id, data in self.all_nodes.items():
            context = data['context']
            meta = data['meta']
            
            # Map where Vault values drop into runtime env
            vault_path = meta.get('vault_mount') or self._get_tenant_vault_path(context)
            print(f"  ⚡ [{meta['engine'].upper()}] Compiled ID: {node_id}")
            print(f"     Scope: {context} | Vault Node: {vault_path}")
            print(f"     Source Template: {meta['template_ref']}")
            if 'config_patches' in meta:
                print(f"     Patches applied: {list(meta['config_patches'].keys())}")

    def _get_tenant_vault_path(self, context):
        if not context.startswith('tenant:'):
            return "core"
        t_id = context.split(':')[1]
        for t in self.manifest['tenants']:
            if t['id'] == t_id:
                return t['vault_tenant_path']
        return "unknown"

if __name__ == '__main__':
    print("OpenTenant Execution Module Prepared.")"""
with open("generated/opentenant_compiler.py", "w") as f:
    f.write(compiler_script)
print("Compiler engine script compiled.")
```**Output:** `Compiler engine script compiled.`


