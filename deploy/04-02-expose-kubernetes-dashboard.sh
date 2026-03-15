#!/bin/bash
# Expose the Kubernetes Dashboard on the home LAN (MetalLB) and Tailnet.
# Eliminates the need for: kubectl port-forward svc/kubernetes-dashboard-kong-proxy 8443:443
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KUBE_DIR="$SCRIPT_DIR/../kube/kubernetes-dashboard"

echo "=== Exposing Kubernetes Dashboard ==="
echo ""

# Patch the kong-proxy service
echo "--- Patching kubernetes-dashboard-kong-proxy service ---"
kubectl patch svc kubernetes-dashboard-kong-proxy \
    -n kubernetes-dashboard \
    --type merge \
    --patch-file "$KUBE_DIR/expose-dashboard.yaml"

# Wait a moment for MetalLB to assign an IP
echo ""
echo "--- Waiting for external IP assignment ---"
sleep 5

# Get the assigned IP
EXTERNAL_IP=$(kubectl get svc kubernetes-dashboard-kong-proxy \
    -n kubernetes-dashboard \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)

echo ""
echo "=== Dashboard exposed ==="
echo ""
if [ -n "$EXTERNAL_IP" ]; then
    echo "  Home LAN:  https://$EXTERNAL_IP"
else
    echo "  Home LAN:  (waiting for MetalLB IP — run: kubectl get svc -n kubernetes-dashboard)"
fi
echo "  Tailnet:   https://kubernetes-dashboard  (once Tailscale operator is running)"
echo ""
echo "  Don't forget: you still need a token to log in."
echo "  Get one with: kubectl -n kubernetes-dashboard create token admin-user"
