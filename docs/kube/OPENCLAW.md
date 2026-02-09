# OpenClaw Deployment

This document covers the deployment and operation of two OpenClaw instances on the home Kubernetes cluster. OpenClaw is an AI assistant that connects to messaging platforms and executes tasks autonomously.

## Instances

| Instance | Name | Namespace | Default Model | Web UI |
| :--- | :--- | :--- | :--- | :--- |
| Personal | Neumann | `openclaw` | `xai/grok-4-1-fast-reasoning` | `http://192.168.0.204:18789` |
| Work | Anton | `openclaw-citepulse` | `anthropic/claude-sonnet-4-5` | `http://192.168.0.205:18789` |

Both instances have access to both Anthropic and xAI models via API keys in their environment. The "primary" model is the default; other models can be selected per-agent or at runtime in the web UI.

---

## Architecture

Each instance runs as an isolated Helm release in its own namespace with:

- **Main container**: OpenClaw gateway (`ghcr.io/openclaw/openclaw`)
- **Chromium sidecar**: Headless browser for web automation (CDP on port 9222)
- **Init containers**: `init-config` (config merge/overwrite) and `init-skills` (ClawHub skill installation)
- **PVC**: 5Gi on `managed-nfs-storage` for config, sessions, and workspace
- **Service**: MetalLB `LoadBalancer` on port 18789

---

## File Layout

```text
kube/openclaw/
├── charts/openclaw/          # Vendored Helm chart (bjw-s app-template based)
│   ├── Chart.yaml
│   ├── Chart.lock
│   ├── values.yaml           # Chart defaults (init containers, probes, resources, skills)
│   └── charts/               # Downloaded dependencies (gitignored *.tgz)
├── openclaw-namespace.yaml   # Both namespaces
├── openclaw-secret.yaml      # Secret template (envsubst placeholders)
├── values-common.yaml        # Shared infra settings (storage, service type, envFrom, network policies)
├── values-personal.yaml      # Neumann config (identity, model, full openclaw.json)
└── values-citepulse.yaml     # Anton config (identity, model, full openclaw.json)
```

The per-instance values files each contain the full `openclaw.json` configuration because the JSON config is a plain string in YAML — Helm cannot deep-merge it across files. The last `-f` flag wins for that key.

---

## Deployment

### Prerequisites

1. `kubectl` and `helm` configured with cluster access.
2. Environment variables set in `sensitive/secrets.sh`:

| Variable | Description |
| :--- | :--- |
| `OPENCLAW_ANTHROPIC_API_KEY` | Anthropic API key (personal) |
| `OPENCLAW_XAI_API_KEY` | xAI API key (personal) |
| `OPENCLAW_GATEWAY_TOKEN` | Gateway pairing token (personal) — choose any secure string |
| `OPENCLAW_CITEPULSE_ANTHROPIC_API_KEY` | Anthropic API key (work) |
| `OPENCLAW_CITEPULSE_XAI_API_KEY` | xAI API key (work) |
| `OPENCLAW_CITEPULSE_GATEWAY_TOKEN` | Gateway pairing token (work) — choose any secure string |

Gateway tokens are self-chosen secrets (e.g., `openssl rand -hex 32`). You enter them in the web UI to pair devices.

### Deploy

```bash
source sensitive/secrets.sh
./deploy/08-deploy-openclaw.sh
```

The script is idempotent (`helm upgrade --install`). It creates namespaces, applies secrets via `envsubst`, updates chart dependencies, deploys both Helm releases, and waits for pod readiness.

### Verify

```bash
kubectl get pods -n openclaw
kubectl get pods -n openclaw-citepulse
kubectl get svc -n openclaw
kubectl get svc -n openclaw-citepulse
```

---

## Pairing Devices

### 1. Access the Web UI

Either browse directly to the LoadBalancer IP on your LAN:

```
http://192.168.0.204:18789   # Neumann (personal)
http://192.168.0.205:18789   # Anton (work)
```

Or use `kubectl port-forward` if not on the LAN:

```bash
# Personal
kubectl port-forward -n openclaw svc/openclaw 18789:18789
# Open http://localhost:18789

# Work
kubectl port-forward -n openclaw-citepulse svc/openclaw-citepulse 18789:18789
# Open http://localhost:18789
```

### 2. Connect

Enter the gateway token for that instance and click **Connect**.

### 3. Approve the Pairing Request

```bash
# List pending device requests
kubectl exec -n openclaw deployment/openclaw -- node dist/index.js devices list

# Approve a request
kubectl exec -n openclaw deployment/openclaw -- node dist/index.js devices approve <REQUEST_ID>
```

For the work instance, replace `-n openclaw deployment/openclaw` with `-n openclaw-citepulse deployment/openclaw-citepulse`.

---

## Configuration

### Changing Models

Edit the `"primary"` field in the per-instance values file:

- `kube/openclaw/values-personal.yaml` — Neumann
- `kube/openclaw/values-citepulse.yaml` — Anton

Then redeploy. Both providers (Anthropic, xAI) remain available in the UI regardless of which is set as primary, as long as the API keys are in the environment.

### Config Mode

The `init-config` init container supports two modes via the `CONFIG_MODE` env var in `values-common.yaml`:

- **`merge`** (default): Deep-merges Helm config on top of existing config on the PVC. Preserves runtime changes made through the UI.
- **`overwrite`**: Replaces the config file entirely. Use this temporarily when you need to remove keys that `merge` would preserve.

### Skills

Skills are installed by the `init-skills` init container from [ClawHub](https://clawhub.com). The default chart installs the `weather` skill. To add more, override the `init-skills` init container command in a values file and add skill slugs to the `for skill in ...` loop.

Skills and their dependencies persist on the NFS PVC and survive pod restarts.

---

## Troubleshooting

### Check logs

```bash
# Main container
kubectl logs -n openclaw deployment/openclaw -c main

# Init containers
kubectl logs -n openclaw deployment/openclaw -c init-config
kubectl logs -n openclaw deployment/openclaw -c init-skills

# Chromium sidecar
kubectl logs -n openclaw deployment/openclaw -c chromium
```

### Config validation errors

If OpenClaw rejects the config (e.g., unrecognized keys), temporarily switch `CONFIG_MODE` to `overwrite` in `values-common.yaml`, redeploy, then switch back to `merge`.

### Image pull taking a long time

Expected on Raspberry Pi nodes. The OpenClaw image and Chromium sidecar are pulled from public registries. First deploy can take several minutes.
