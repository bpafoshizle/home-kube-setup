#!/bin/bash
# Deploy two OpenClaw instances (personal + citepulse) to Kubernetes
# Requires: kubectl and helm configured with cluster access
#
# Required environment variables:
#   OPENCLAW_ANTHROPIC_API_KEY           - Anthropic API key (personal)
#   OPENCLAW_XAI_API_KEY                 - xAI API key (personal)
#   OPENCLAW_OPENAI_API_KEY              - OpenAI API key (personal)
#   OPENCLAW_GATEWAY_TOKEN               - Gateway pairing token (personal)
#   OPENCLAW_CITEPULSE_ANTHROPIC_API_KEY - Anthropic API key (citepulse)
#   OPENCLAW_CITEPULSE_XAI_API_KEY       - xAI API key (citepulse)
#   OPENCLAW_CITEPULSE_OPENAI_API_KEY    - OpenAI API key (citepulse)
#   OPENCLAW_CITEPULSE_GATEWAY_TOKEN     - Gateway pairing token (citepulse)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KUBE_DIR="$SCRIPT_DIR/../kube/openclaw"
CHART_DIR="$KUBE_DIR/charts/openclaw"

# Check required environment variables
MISSING=""
for var in OPENCLAW_ANTHROPIC_API_KEY OPENCLAW_XAI_API_KEY OPENCLAW_GATEWAY_TOKEN \
           OPENCLAW_CITEPULSE_ANTHROPIC_API_KEY OPENCLAW_CITEPULSE_XAI_API_KEY OPENCLAW_CITEPULSE_GATEWAY_TOKEN \
           OPENCLAW_CITEPULSE_OPENAI_API_KEY; do
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

echo "=== Deploying OpenClaw (personal + citepulse) ==="

# Create namespaces
echo ""
echo "--- Creating namespaces ---"
kubectl apply -f "$KUBE_DIR/openclaw-namespace.yaml"

# Apply secrets for personal instance
echo ""
echo "--- Applying secrets (openclaw) ---"
OPENCLAW_NAMESPACE=openclaw \
ANTHROPIC_API_KEY="$OPENCLAW_ANTHROPIC_API_KEY" \
XAI_API_KEY="$OPENCLAW_XAI_API_KEY" \
OPENAI_API_KEY="$OPENCLAW_OPENAI_API_KEY" \
GATEWAY_TOKEN="$OPENCLAW_GATEWAY_TOKEN" \
CLAWHUB_TOKEN="$OPENCLAW_CLAWHUB_TOKEN" \
envsubst < "$KUBE_DIR/openclaw-secret.yaml" | kubectl apply -f -

# Apply secrets for citepulse instance
echo ""
echo "--- Applying secrets (openclaw-citepulse) ---"
OPENCLAW_NAMESPACE=openclaw-citepulse \
ANTHROPIC_API_KEY="$OPENCLAW_CITEPULSE_ANTHROPIC_API_KEY" \
XAI_API_KEY="$OPENCLAW_CITEPULSE_XAI_API_KEY" \
OPENAI_API_KEY="$OPENCLAW_CITEPULSE_OPENAI_API_KEY" \
GATEWAY_TOKEN="$OPENCLAW_CITEPULSE_GATEWAY_TOKEN" \
CLAWHUB_TOKEN="$OPENCLAW_CITEPULSE_CLAWHUB_TOKEN" \
envsubst < "$KUBE_DIR/openclaw-secret.yaml" | kubectl apply -f -

# Update Helm chart dependencies
echo ""
echo "--- Updating Helm chart dependencies ---"
helm dependency update "$CHART_DIR"

# Deploy personal instance
echo ""
echo "--- Deploying openclaw (personal) ---"
helm upgrade --install openclaw "$CHART_DIR" \
    --namespace openclaw \
    -f "$KUBE_DIR/values-common.yaml" \
    -f "$KUBE_DIR/values-personal.yaml"

# Deploy citepulse instance
echo ""
echo "--- Deploying openclaw-citepulse (work) ---"
helm upgrade --install openclaw-citepulse "$CHART_DIR" \
    --namespace openclaw-citepulse \
    -f "$KUBE_DIR/values-common.yaml" \
    -f "$KUBE_DIR/values-citepulse.yaml"

# Wait for pods to be ready
echo ""
echo "=== Waiting for pods to be ready ==="
echo "Waiting for openclaw..."
kubectl wait --for=condition=ready pod -l app.kubernetes.io/instance=openclaw -n openclaw --timeout=180s || true
echo "Waiting for openclaw-citepulse..."
kubectl wait --for=condition=ready pod -l app.kubernetes.io/instance=openclaw-citepulse -n openclaw-citepulse --timeout=180s || true

# Print status
echo ""
echo "=== OpenClaw deployment complete ==="
echo ""
echo "Personal instance (openclaw):"
kubectl get svc -n openclaw
echo ""
echo "Work instance (openclaw-citepulse):"
kubectl get svc -n openclaw-citepulse
echo ""
echo "To pair a device, open your browser to:"
echo "  Personal: http://<PERSONAL-LB-IP>:18789"
echo "  Work:     http://<CITEPULSE-LB-IP>:18789"
echo ""
echo "Use the gateway token for each instance to pair."
