helm repo add bpafoshizle-radarr https://bpafoshizle.github.io/docker-radarr
helm repo update

helm install radarr bpafoshizle-radarr/radarr \
    --values ../kube/media/media.radarr.values.yml \
    --namespace media

