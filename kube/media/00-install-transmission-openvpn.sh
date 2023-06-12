helm repo add bananaspliff https://bananaspliff.github.io/geek-charts
helm repo update

helm install transmission bananaspliff/transmission-openvpn \
    --values ../kube/media/media.transmission-openvpn.values.yml \
    --namespace media

