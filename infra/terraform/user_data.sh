#!/bin/bash
set -eux
apt-get update -y
apt-get install -y git curl
curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644
echo 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml' >> /home/ubuntu/.bashrc