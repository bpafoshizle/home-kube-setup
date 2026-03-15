#!/bin/bash
# Deploy the Tailscale Kubernetes Operator and Connector (subnet router)
# Requires: kubectl and helm configured with cluster access
#
# Required environment variables:
#   TAILSCALE_OAUTH_CLIENT_ID      - OAuth client ID from Tailscale admin console
#   TAILSCALE_OAUTH_CLIENT_SECRET  - OAuth client secret from Tailscale admin console

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KUBE_DIR="$SCRIPT_DIR/../kube/tailscale"

# ── Preflight checks ──────────────────────────────────────────────────────────
MISSING=""
for var in TAILSCALE_OAUTH_CLIENT_ID TAILSCALE_OAUTH_CLIENT_SECRET; do
    if [ -z "${!var}" ]; then
        MISSING="$MISSING  $var\n"
    fi
done

if [ -n "$MISSING" ]; then
    echo "ERROR: Required environment variables not set:"
    echo ""
    echo -e "$MISSING"
    echo "Source your secrets file first: source sensitive/secrets.sh"
    exit 1
fi

# ── Step 1: Install the Tailscale Kubernetes Operator via Helm ─────────────────
echo ""
echo "=== Deploying Tailscale Kubernetes Operator ==="
echo ""

echo "--- Adding Tailscale Helm repo ---"
helm repo add tailscale https://pkgs.tailscale.com/helmcharts 2>/dev/null || true
helm repo update

echo ""
echo "--- Installing / upgrading tailscale-operator ---"
helm upgrade --install tailscale-operator tailscale/tailscale-operator \
    --namespace=tailscale \
    --create-namespace \
    --set-string oauth.clientId="$TAILSCALE_OAUTH_CLIENT_ID" \
    --set-string oauth.clientSecret="$TAILSCALE_OAUTH_CLIENT_SECRET" \
    --wait

# ── Step 2: Wait for the operator pod to be ready ─────────────────────────────
echo ""
echo "--- Waiting for operator pod to be ready ---"
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=tailscale-operator \
    -n tailscale --timeout=120s || true

# ── Step 3: Apply the Connector (subnet router) ──────────────────────────────
echo ""
echo "--- Applying Connector (subnet router) ---"
kubectl apply -f "$KUBE_DIR/connector.yaml"

# ── Step 4: Wait for Connector to be created ──────────────────────────────────
echo ""
echo "--- Waiting for Connector to be created ---"
sleep 10
kubectl get connector home-kube-subnet-router 2>/dev/null || echo "(Connector may take a moment to appear)"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Tailscale deployment complete ==="
echo ""
echo "Operator:"
kubectl get pods -n tailscale
echo ""
echo "Connector:"
kubectl get connector home-kube-subnet-router 2>/dev/null || echo "(pending)"
echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  NEXT STEPS (manual):                                          ║"
echo "║                                                                ║"
echo "║  1. Open https://login.tailscale.com/admin/machines            ║"
echo "║  2. Find 'home-kube-subnet-router' and approve its routes:     ║"
echo "║       • 192.168.0.0/24   (home LAN)                           ║"
echo "║       • 10.96.0.0/12     (K8s Service CIDR)                   ║"
echo "║       • 10.244.0.0/16    (Pod CIDR / Flannel)                 ║"
echo "║  3. On each client: ensure 'Accept Routes' is enabled.        ║"
echo "║                                                                ║"
echo "║  Or configure autoApprovers in your Tailscale ACL policy:      ║"
echo "║    \"autoApprovers\": {                                         ║"
echo "║      \"routes\": {                                              ║"
echo "║        \"192.168.0.0/24\":  [\"tag:k8s\"],                        ║"
echo "║        \"10.96.0.0/12\":    [\"tag:k8s\"],                        ║"
echo "║        \"10.244.0.0/16\":   [\"tag:k8s\"]                         ║"
echo "║      }                                                        ║"
echo "║    }                                                           ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
