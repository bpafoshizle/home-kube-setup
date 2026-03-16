#!/usr/bin/env bash
# Deploy OpenCode Web to the home-kube cluster
#
# Prerequisites:
#   1. Create the namespace:
#      kubectl apply -f kube/opencode/opencode-namespace.yaml
#
#   2. Create the secret (set OPENCODE_SERVER_PASSWORD first):
#      export OPENCODE_SERVER_PASSWORD="your-password-here"
#      envsubst < kube/opencode/opencode-secret.yaml | kubectl apply -f -
#
#   3. Run this script to deploy via Helm:
#      bash kube/opencode/helm-deploy.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART_DIR="${SCRIPT_DIR}/charts/opencode"

# Build dependencies (downloads app-template chart)
helm dependency build "${CHART_DIR}"

# Install or upgrade the release
helm upgrade --install opencode "${CHART_DIR}" \
    --namespace opencode \
    --create-namespace \
    --values "${SCRIPT_DIR}/values.yaml"
