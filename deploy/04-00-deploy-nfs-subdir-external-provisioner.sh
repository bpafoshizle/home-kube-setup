kubectl apply -f ../kube/nfs-subdir-external-provisioner/deploy/rbac.yaml
kubectl apply -f ../kube/nfs-subdir-external-provisioner/deploy/deployment.yaml
kubectl apply -f ../kube/nfs-subdir-external-provisioner/deploy/class.yaml