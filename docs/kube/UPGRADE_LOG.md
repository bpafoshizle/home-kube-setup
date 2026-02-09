# Upgrade & Maintenance Log

This document tracks the history of Kubernetes cluster upgrades, OS migrations, and troubleshooting notes for major maintenance activities.

## Kubernetes Version Upgrades

Upgrading Kubernetes requires updating `kubeadm`, `kubelet`, and `kubectl` on each node. It is unsupported to skip minor versions, but patch versions can be skipped.

### Upgrade History

| From | To |
| :--- | :--- |
| v1.20.0 | v1.21.14 |
| v1.21.14 | v1.22.17 |
| v1.22.17 | v1.23.17 |
| v1.23.17 | v1.24.13 |
| v1.24.13 | v1.25.9 |
| v1.25.9 | v1.26.9 |
| v1.26.9 | v1.27.6 |
| v1.27.6 | v1.28.2 |
| v1.28.2 | v1.29.7 |
| v1.29.7 | v1.30.3 |
| v1.30.3 | v1.30.6 |
| v1.30.6 | v1.31.4 |
| v1.31.4 | v1.32.0 |
| v1.32.0 | v1.33.6 |

### Upgrade Commands
To update the apt key and source list for a specific version:
```bash
ansible-playbook -i ./ansible/inventory/hosts -u ubuntu --become ./ansible/04-upgrade-kube.yml -e "kubeversion=v1.33.6" --tags "set-kubernetes-apt-source"
```

Perform the upgrade across all nodes:
```bash
ansible-playbook -i ansible/inventory/hosts ansible/04-upgrade-kube.yml -e "kubeversion=v1.33.6"
```

---

## OS Migration (Ubuntu 20.04 -> 22.04)

### Background
Migrated in late 2023. This required unholding Kubernetes packages and resolving `cgroups v2` issues.

### Critical Troubleshooting (Cgroups v2)
Ubuntu 22.04 switched to cgroups v2, which initially caused `etcd` and `kube-apiserver` to crash.
- **Symptoms**: `CrashLoopBackOff` for critical system pods; connection errors to apiserver.
- **Fix**: Configure `containerd` to use the systemd cgroup driver.
- **Tooling**: Used `crictl` for debugging when the Kubernetes API was unavailable.
  - `sudo crictl ps --all`
  - `sudo crictl logs -f [container_id]`

### Network Resolution
Required re-applying Flannel after the OS upgrade due to missing binary path errors (`failed to find plugin "flannel" in path [/opt/cni/bin]`).

---

## Historical Troubleshooting Notes

### 1.24 Upgrade (Container Runtime)
Ran into issues pulling images due to the decommissioned `dockershim`. Ensured nodes were correctly configured to use `containerd`.

### 1.28 Authorization Issues
Encountered `Unauthorized` errors after the 1.28.2 upgrade. Fixed by refreshing the local `~/.kube/config` from the control plane node using the `copy-kube-config` Ansible tag.

### Stuck Pods during Drain
If nodes hang during `kubectl drain`, force-kill pods stuck in `Terminating`:
```bash
kubectl delete pod [pod-name] --grace-period=0 --force --namespace [namespace]
```


### 1.33 Upgrade (Sudo for Local Actions)
Encountered `sudo: a password is required` when running `local_action` tasks (drain/uncordon) on the control plane.
- **Fix**: Added `become: false` to tasks using `local_action` to ensure `kubectl` runs as the current user on the Ansible control host, which typically has the necessary `kubeconfig` and permissions.

### 99-update.yml Deprecation
Task `Check if a reboot is needed` failed due to the deprecated `get_md5` parameter in the `stat` module.
- **Fix**: Removed `get_md5: no` from the playbook as it is no longer supported in newer Ansible versions.
