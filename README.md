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
