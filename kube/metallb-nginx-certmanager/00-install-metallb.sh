helm repo add metallb https://metallb.github.io/metallb
helm repo update

# Install MetalLB to kube-system namespace
helm install metallb metallb/metallb --namespace kube-system -f ../kube/metallb-nginx-certmanager/00-metallb-values.yml


# Create custom resource objects to define IP address pool and L2 advertisement
# https://blog.differentpla.net/blog/2023/04/03/metallb-crds/
kubectl apply -f ../kube/metallb-nginx-certmanager/IPAddressPool.yml
kubectl apply -f ../kube/metallb-nginx-certmanager/L2Advertisement.yml
