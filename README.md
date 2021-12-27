# home-kube-setup
Repo housing documentation and scripts related to setup and provisioning of my home kube cluster

# Initial Setup

## Pi Setup
As a prerequisite to running any ansible playbooks and setting up of kubernetes, first the scripts in the deploy/00-setup-scripts to generate SSH identities, and set up cgroups and swap for docker. Additionally, if replacing bletchley001, you would need to add its key to github keys. 

## Links and Tutorials Followed

Currently provisioning kube with flannel per the guide, but [calico looks like a better overall option](https://rancher.com/blog/2019/2019-03-21-comparing-kubernetes-cni-providers-flannel-calico-canal-and-weave/) that I want to look into. 

[Primary Kube on Pis Article](https://opensource.com/article/20/6/kubernetes-raspberry-pi)

[Ubuntu's Guide to installing on RPi](https://ubuntu.com/tutorials/how-to-install-ubuntu-on-your-raspberry-pi#4-boot-ubuntu-server)

[Ansible smoke test](https://www.digitalocean.com/community/tutorials/how-to-install-and-configure-ansible-on-ubuntu-20-04)

[Ansible inventory config docs](https://docs.ansible.com/ansible/latest/user_guide/intro_inventory.html#id8)

## Commands for setup

Command to test some variables:
```ansible-playbook -i ./ansible/inventory/hosts ./ansible/99-test.yml```

Command to check validity of main config: 
```ansible-playbook -i ./ansible/inventory/hosts ./ansible/01-kube.yml --check```

Command to run kube setup playbook:
```./deploy/01-run-kube-playbook.sh```

# Hardening

## Background

Hardening playbook uses a community galaxy role for [fail2ban](https://github.com/robertdebock/ansible-role-fail2ban), provided by robertdebock. To use, it must first be installed via the following run from the repo root:

## Preconfiguration Setup

```mkdir ./ansible/roles```

```ansible-galaxy install --roles-path ./ansible/roles robertdebock.fail2ban```


## Commands for hardening

Command to check validity of harden config: 
```ansible-playbook -i ./ansible/inventory/hosts ./ansible/02-harden.yml --check```

Command to run harden playbook:
```./deploy/02-run-harden-playbook.sh```

# Add additional hosts to cluster

Command to check validity of add local hosts config:
```ansible-playbook -i ./ansible/inventory/hosts ./ansible/03-add-local-hosts.yml --check```

Command for adding additional local hosts to each cluster host's `/etc/hosts` file:
```./deploy/03-run-add-local-hosts-playbook.sh```

# Install additional packages to all cluster hosts

Command to check the validity of installing packages:
```ansible-playbook -i ./ansible/inventory/hosts ./ansible/03-add-packages.yml --check```

Command to run playbook for installing packages:
```./deploy/03-run-add-packages-playbook.sh```

# Setting up Persistent Storage

## Preconfiguration Setup 
This setup involves mostly kubernetes config and kubectl only. The ansible additions are for adding the hostname of the NFS server, [lynott (inventor of the magnetic disk drive)](https://www.invent.org/inductees/john-joseph-lynott), to every cluster host hosts file, and for installing the nfs-common package from apt to every host.

[Persistent volumes, like nodes, are not scoped to any namespace, but persistent volume claims are](https://stackoverflow.com/questions/32316178/does-kubernetes-pv-recognize-namespace-when-created-queried-with-kubectl). My original plan was to create a persistent volume for the cluster, following [official kube examples](https://github.com/kubernetes/examples/tree/master/staging/volumes/nfs) but I have decided to use the [Kubernetes NFS Subdir External Provisioner](https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner), after reading [this stack overflow thread](https://stackoverflow.com/questions/44204223/kubernetes-nfs-persistent-volumes-multiple-claims-on-same-volume-claim-stuck) and confirming my understanding of [the official documentation on persistent volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/), which states:

> Once bound, PersistentVolumeClaim binds are exclusive, regardless of how they were bound. A PVC to PV binding is a one-to-one mapping, using a ClaimRef which is a bi-directional binding between the PersistentVolume and the PersistentVolumeClaim.

The [Kubernetes NFS Subdir External Provisioner](https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner) uses dynamic provisioning with a default storage class to simplify volume provisioning by dynamically creating persistent volumes as directories on the existing NFS share when defining a persistent volume claim per application need. 

Prior to running these commands, I have done some preconfiguration steps. 

- I have preconfigured my synology NAS server (hostname: lynott) for a storage pool, volume, and shared NFS folder. 
    - NAS Storage Pool Config
      - ![NAS storage pool config](documentation/images/synology-nas-storage-pool-config.png)
    - NAS Volume Config
      - ![NAS volume config](documentation/images/synology-nas-volume-config.png)
    - NAS Shared Folder and NFS Config
      - ![NAS shared folder and nfs config](documentation/images/synology-nase-shared-folder-nfs-config.png)
    - Note that NFS does not really do security based on username and password, but is [based on hosts/ip of the clients](https://unix.stackexchange.com/questions/341854/failed-to-pass-credentials-to-nfs-mount). We have configured to allow all hosts. According to [this Synology documentation](https://kb.synology.com/en-global/DSM/help/DSM/AdminCenter/file_share_privilege_nfs?version=7), with the sys (AUTH_SYS) security option, "The client must have exactly the same numerical UID (user identifier) and GID (group identifier) on the NFS client and Synology NAS, or else the client will be assigned the permissions of others when accessing the shared folder. To avoid any permissions conflicts, you can select Map all users to admin from Squash or give "Everyone" permissions to the shared folder." So since all my kube services are running as root, and root is standard UID and GID 0 on linux, the mapping should work fine. This was confusing, because on my MacBook, where I am not root, I have to log in to the NAS with a preconfigured user to have permission. 
- I have also configured an IP address reservation of the NAS to its MAC address in my router to ensure the IP of the NAS is fixed. 
- I have a running kubernetes cluster as configured from the previous steps using Ansible.
- I have run the ansible playbooks above to add additional hosts (including the NFS host) and install additional packages (including nfs-common) to the cluster.
- I have forked the [nfs-subdir-external-provisioner](https://github.com/bpafoshizle/nfs-subdir-external-provisioner) repo and pulled the forked repo in as a [subtree](https://www.atlassian.com/git/tutorials/git-subtree) for editing.

## NFS Kube Service Setup
Change to the nfs-subdir-external-provisioner folder/repo: 
```cd kube/nfs-subdir-external-provisioner```

Modify the namespace (or leave it as default, which is what this did in my case) per the README:

```bash
NS=$(kubectl config get-contexts|grep -e "^\*" |awk '{print $5}')
NAMESPACE=${NS:-default}
sed -i '' "s/namespace:.*/namespace: $NAMESPACE/g" ./deploy/rbac.yaml ./deploy/deployment.yaml
```

Modify the `NFS_SERVER` and `NFS_PATH` env values and the nfs volume server and path properties in the [deployment.yaml](kube/nfs-subdir-external-provisioner/deploy/deployment.yaml) 

Run the kubectl commands to deploy the rbac components, the provisioner deployment, and the storage class (encapsulated in [kube/nfs-subdir-external-provisioner/deploy.sh](kube/nfs-subdir-external-provisioner/deploy.sh))

```bash
kubectl apply -f deploy/rbac.yaml
kubectl apply -f deploy/deployment.yaml
kubectl apply -f deploy/class.yaml
```


# One Off Commands
Command to run test playbook:
```./ansible/99-run-test-playbook.sh```

Command to ping all hosts:
```./ansible/99-ping-test.sh```

Coommand to reboot all hosts:
```./ansible/99-reboot-all.sh```

Command to update all hosts:
```ansible-playbook -i ./ansible/inventory/hosts ./ansible/99-update.yml```

Command to check all CPU temperatures (in millidegrees Celsius):
```ansible -i ~/github/local/home-kube-setup/ansible/inventory/hosts -u ubuntu --become all -m shell -a "cat /sys/class/thermal/thermal_zone*/temp"```


