#!/bin/bash

# Primary instructions: https://opensource.com/article/20/6/kubernetes-raspberry-pi

# Install the docker.io package
sudo apt install -y docker.io

# Create or replace the contents of /etc/docker/daemon.json to enable the systemd cgroup driver
# Modified from https://stackoverflow.com/questions/10134901/why-sudo-cat-gives-a-permission-denied-but-sudo-vim-works-fine
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "exec-opts": ["native.cgroupdriver=systemd"],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m"
  },
  "storage-driver": "overlay2"
}
EOF

# Append the cgroups and swap options to the kernel command line
# Note the space before "cgroup_enable=cpuset", to add a space after the last existing item on the line
sudo sed -i '$ s/$/ cgroup_enable=cpuset cgroup_enable=memory cgroup_memory=1 swapaccount=1/' /boot/firmware/cmdline.txt
