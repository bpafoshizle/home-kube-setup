# home-kube-setup
Repo housing documentation and scripts related to setup and provisioning of my home kube cluster

Currently provisioning kube with flannel per the guide, but [calico looks like a better overall option](https://rancher.com/blog/2019/2019-03-21-comparing-kubernetes-cni-providers-flannel-calico-canal-and-weave/) that I want to look into. 

[Primary Kube on Pis Article](https://opensource.com/article/20/6/kubernetes-raspberry-pi)

[Ubuntu's Guide to installing on RPi](https://ubuntu.com/tutorials/how-to-install-ubuntu-on-your-raspberry-pi#4-boot-ubuntu-server)

[Ansible smoke test](https://www.digitalocean.com/community/tutorials/how-to-install-and-configure-ansible-on-ubuntu-20-04)

[Ansible inventory config docs](https://docs.ansible.com/ansible/latest/user_guide/intro_inventory.html#id8)

Command to test some variables:
```ansible-playbook -i ./ansible/inventory/hosts ./ansible/test.yml```

Command to check validity of main config: 
```ansible-playbook -i ./ansible/inventory/hosts ./ansible/kube.yml --check```

Command to check validity of harden config: 
```ansible-playbook -i ./ansible/inventory/hosts ./ansible/harden.yml --check```

Command to update all hosts:
```ansible-playbook -i ./ansible/inventory/hosts ./ansible/update.yml```

Hardening playbook uses a community galaxy role for [fail2ban](https://github.com/robertdebock/ansible-role-fail2ban), provided by robertdebock. To use, it must first be installed via the following run from the repo root:

```mkdir ./ansible/roles```

```ansible-galaxy install --roles-path ./ansible/roles robertdebock.fail2ban```