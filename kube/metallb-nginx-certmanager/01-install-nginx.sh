helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

# Install nginx-ingress to kube-system namespace
helm install nginx-ingress ingress-nginx/ingress-nginx --namespace kube-system \
    --set defaultBackend.enabled=false