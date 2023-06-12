helm repo add bananaspliff https://bananaspliff.github.io/geek-charts
helm repo update

helm install sonarr bananaspliff/sonarr \
    --values ../kube/media/media.sonarr.values.yml \
    --namespace media

