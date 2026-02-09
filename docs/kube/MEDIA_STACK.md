# Media Stack Configuration

This document covers the deployment and configuration of self-hosted media services (Plex, Transmission, Radarr, etc.) using Helm and Ingress controllers.

## Networking Infrastructure

### MetalLB (Load Balancer)
MetalLB provides virtual IPs from a local address pool for services of type `LoadBalancer`.

**Installation**:
```bash
source kube/metallb-nginx-certmanager/00-install-metallb.sh
```

**Configuration**:
Modern MetalLB uses a custom `values.yaml` for IP address pooling. Listener pods run on each node to handle ARP requests for the virtual IPs.

### Nginx Ingress Controller
Routes external traffic to internal services based on hostnames.

**Installation**:
```bash
source kube/metallb-nginx-certmanager/01-install-nginx.sh
```

**Critical Note**: Ensure `ingressClassName: nginx` is defined in all Ingress resources to avoid routing failures or 404/503 errors.

---

## Application Stack
The media center follows a pattern of deploying via Helm charts, often persisting data to the Synology NAS via the dynamic NFS provisioner.

### Supported Applications
- **Plex**: Media server
- **Transmission**: Torrent client
- **Radarr/Sonarr/Lidarr/Readarr**: Media automation and management

---

## Setup Requirements
1. **Helm**: Installed locally (`brew install helm`).
2. **Stable Repo**: `helm repo add stable https://charts.helm.sh/stable`.
3. **Storage**: Dynamic NFS provisioner must be active (see `MAINTENANCE.md`).
