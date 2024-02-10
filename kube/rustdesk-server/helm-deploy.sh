helm repo add home-kube-setup https://bpafoshizle.github.io/home-kube-setup
helm repo update

helm install rustdesk-server home-kube-setup/rustdesk-server \
    --values ../rustdesk-server/charts/rustdesk-server/values.yaml