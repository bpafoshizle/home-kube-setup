helm repo add jetstack https://charts.jetstack.io
helm repo update

# Install cert-manager to kube-system namespace
helm install cert-manager jetstack/cert-manager \
    --namespace kube-system \
    --version v1.11.0 \
    --set installCRDs=true

# Deploy the ClusterIssuer resources
kubectl apply -f ../kube/metallb-nginx-certmanager/ClusterIssuer.yml