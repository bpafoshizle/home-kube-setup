#!/bin/bash
# Expose all home-kube services to the Tailscale tailnet.
# Run this AFTER the Tailscale operator is deployed (09-deploy-tailscale.sh).
#
# Services exposed:
#   - kubernetes-dashboard  → https://kubernetes-dashboard
#   - openclaw (personal)   → http://openclaw-personal:18789
#   - openclaw (citepulse)  → http://openclaw-citepulse:18789
#   - postgresql            → homelab-postgres:5432
#   - rustdesk hbbs         → rustdesk-hbbs:21115-21118
#   - rustdesk hbbr         → rustdesk-hbbr:21117,21119
#
# Note: OpenClaw services get Tailscale annotations via Helm values
# (values-personal.yaml / values-citepulse.yaml), so they are exposed
# automatically when you run 08-deploy-openclaw.sh. This script handles
# the remaining services.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Exposing all services to Tailscale tailnet ==="

# ── Kubernetes Dashboard ──────────────────────────────────────────────────────
echo ""
echo "--- Kubernetes Dashboard ---"
kubectl patch svc kubernetes-dashboard-kong-proxy \
    -n kubernetes-dashboard \
    --type merge \
    --patch-file "$SCRIPT_DIR/../kube/kubernetes-dashboard/expose-dashboard.yaml" \
    2>/dev/null && echo "  ✓ Patched" || echo "  ⚠ Service not found (is the dashboard deployed?)"

# ── PostgreSQL ────────────────────────────────────────────────────────────────
echo ""
echo "--- PostgreSQL ---"
kubectl apply -f "$SCRIPT_DIR/../kube/postgresql/postgresql-service.yaml" \
    2>/dev/null && echo "  ✓ Applied" || echo "  ⚠ Failed to apply"

# ── RustDesk ──────────────────────────────────────────────────────────────────
echo ""
echo "--- RustDesk ---"
kubectl apply -f "$SCRIPT_DIR/../kube/rustdesk-server/expose-rustdesk.yaml" \
    2>/dev/null && echo "  ✓ Applied" || echo "  ⚠ Failed to apply"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=== All services exposed ==="
echo ""
echo "Once the Tailscale operator provisions the devices, access via MagicDNS:"
echo ""
echo "  ┌──────────────────────┬───────────────────────────────────────────┐"
echo "  │ Service              │ Tailnet URL                               │"
echo "  ├──────────────────────┼───────────────────────────────────────────┤"
echo "  │ K8s Dashboard        │ https://kubernetes-dashboard              │"
echo "  │ OpenClaw (personal)  │ http://openclaw-personal:18789            │"
echo "  │ OpenClaw (citepulse) │ http://openclaw-citepulse:18789           │"
echo "  │ PostgreSQL           │ homelab-postgres:5432                     │"
echo "  │ RustDesk (signaling) │ rustdesk-hbbs:21115-21118                │"
echo "  │ RustDesk (relay)     │ rustdesk-hbbr:21117,21119                │"
echo "  └──────────────────────┴───────────────────────────────────────────┘"
echo ""
echo "Note: OpenClaw Tailscale annotations are managed in Helm values files."
echo "      Re-run 08-deploy-openclaw.sh to apply those."
