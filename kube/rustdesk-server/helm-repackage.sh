helm package charts/rustdesk-server
helm repo index --url https://bpafoshizle.github.io/home-kube-setup .
# NOTE: artifacts need to be moved to root of repo