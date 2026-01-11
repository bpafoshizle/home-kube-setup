#!/bin/bash
# Deploy PostgreSQL with pgvector to Kubernetes
# Requires: kubectl configured with cluster access
#
# Required environment variables:
#   POSTGRES_USER     - Database superuser name
#   POSTGRES_PASSWORD - Database superuser password
#   POSTGRES_DB       - Default database name

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KUBE_DIR="$SCRIPT_DIR/../kube/postgresql"

# Check required environment variables
if [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_PASSWORD" ] || [ -z "$POSTGRES_DB" ]; then
    echo "ERROR: Required environment variables not set."
    echo ""
    echo "Please set the following before running:"
    echo "  export POSTGRES_USER=postgres"
    echo "  export POSTGRES_PASSWORD=your_secure_password"
    echo "  export POSTGRES_DB=homelab"
    exit 1
fi

echo "=== Deploying PostgreSQL ==="

# Apply namespace first
echo "Creating namespace..."
kubectl apply -f "$KUBE_DIR/postgresql-namespace.yaml"

# Apply secret with environment variable substitution
echo "Applying credentials secret..."
envsubst < "$KUBE_DIR/postgresql-secret.yaml" | kubectl apply -f -

# Apply PVC
echo "Creating persistent volume claim..."
kubectl apply -f "$KUBE_DIR/postgresql-pvc.yaml"

# Apply StatefulSet
echo "Deploying StatefulSet..."
kubectl apply -f "$KUBE_DIR/postgresql-statefulset.yaml"

# Apply Service
echo "Creating LoadBalancer service..."
kubectl apply -f "$KUBE_DIR/postgresql-service.yaml"

echo ""
echo "=== Waiting for pod to be ready ==="
kubectl wait --for=condition=ready pod -l app=postgresql -n postgresql --timeout=120s

echo ""
echo "=== PostgreSQL deployment complete ==="
echo ""
echo "Service details:"
kubectl get svc postgresql -n postgresql
echo ""
echo "To connect: psql -h <EXTERNAL-IP> -U $POSTGRES_USER -d $POSTGRES_DB"
echo ""
echo "To enable pgvector extension, run:"
echo "  CREATE EXTENSION vector;"
