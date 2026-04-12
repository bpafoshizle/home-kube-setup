#!/usr/bin/env bash
# Deploy CouchDB for Obsidian LiveSync to the home-kube cluster
#
# Prerequisites:
#   1. Create the namespace:
#      kubectl apply -f kube/couchdb/couchdb-namespace.yaml
#
#   2. Create the secret (set env vars first):
#      export COUCHDB_USER="admin"
#      export COUCHDB_PASSWORD="your-secure-password"
#      export COUCHDB_COOKIE_AUTH_SECRET="$(openssl rand -hex 32)"
#      export COUCHDB_ERLANG_COOKIE="$(openssl rand -hex 32)"
#      envsubst < kube/couchdb/couchdb-secret.yaml | kubectl apply -f -
#
#   3. Run this script to deploy via Helm:
#      bash kube/couchdb/helm-deploy.sh
#
#   4. After CouchDB is running, initialise for LiveSync:
#      kubectl apply -f kube/couchdb/couchdb-init-job.yaml
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Add the Apache CouchDB Helm repository
helm repo add couchdb https://apache.github.io/couchdb-helm
helm repo update

# Install or upgrade the release
helm upgrade --install couchdb couchdb/couchdb \
    --namespace couchdb \
    --create-namespace \
    --values "${SCRIPT_DIR}/values.yaml"
