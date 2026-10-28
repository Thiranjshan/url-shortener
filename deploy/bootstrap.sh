#!/usr/bin/env bash
# Turns a fresh Ubuntu server into a running copy of the app.
# Safe to re-run: each step checks before it acts.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

echo "==> Installing k3s (Kubernetes)"
if ! command -v k3s >/dev/null 2>&1; then
  curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644
fi

# Make kubectl work for the ubuntu user when logging in over SSH
if [ -d /home/ubuntu ] && ! grep -q KUBECONFIG /home/ubuntu/.bashrc; then
  echo 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml' >> /home/ubuntu/.bashrc
fi

echo "==> Waiting for the node to be ready"
until kubectl get nodes 2>/dev/null | grep -q ' Ready'; do
  sleep 5
done

cd "$REPO_DIR"

echo "==> Creating secrets"
bash deploy/create-secrets.sh

echo "==> Deploying the app"
kubectl apply -k k8s/overlays/aws

echo "==> Done. Watch progress with: kubectl get pods -n url-shortener"