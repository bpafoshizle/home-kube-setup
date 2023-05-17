
# Install 
kubectl apply -f ../kube/media/media.namespace.yml
kubectl apply -f ../kube/media/media.persistentvolumeclaim.yml
kubectl apply -f ../kube/media/media.ingress.yml
kubectl create secret generic openvpn \
    --from-literal=username="${VPN_USERNAME}" \
    --from-literal=password="${VPN_PASSWORD}" \
    --namespace media


