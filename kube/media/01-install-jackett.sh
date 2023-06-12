helm repo add bananaspliff https://bananaspliff.github.io/geek-charts
helm repo update

helm install jackett bananaspliff/jackett \
    --values ../kube/media/media.jackett.values.yml \
    --namespace media