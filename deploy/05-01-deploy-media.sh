
# Install 
kubectl apply -f ../kube/media/media.namespace.yml
kubectl apply -f ../kube/media/media.persistentvolumeclaim.yml
kubectl apply -f ../kube/media/media.ingress.yml
kubectl create secret generic openvpn \
    --from-literal=username="${VPN_USERNAME}" \
    --from-literal=password="${VPN_PASSWORD}" \
    --namespace media

source ../kube/media/00-install-transmission-openvpn.sh
source ../kube/media/01-install-jackett.sh
source ../kube/media/02-install-sonarr.sh
source ../kube/media/03-install-radarr.sh

