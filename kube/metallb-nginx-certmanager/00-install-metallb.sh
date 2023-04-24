helm repo add metallb https://metallb.github.io/metallb
helm repo update

# Install MetalLB to kube-system namespace
helm install metallb metallb/metallb --namespace kube-system -f ../kube/metallb-nginx-certmanager/00-metallb-values.yml
