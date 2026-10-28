#!/usr/bin/env bash
# Turns a fresh Ubuntu server into a self-updating copy of the app.
# Safe to re-run: each step checks before it acts.
set -euo pipefail

ARGOCD_VERSION="v3.4.12"

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

echo "==> Installing Argo CD ${ARGOCD_VERSION}"
kubectl get namespace argocd >/dev/null 2>&1 || kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts \
  -f "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/install.yaml"

# Scale down components this project does not use, to save memory on a small server
kubectl -n argocd scale deployment \
  argocd-dex-server argocd-notifications-controller argocd-applicationset-controller \
  --replicas=0

kubectl wait --for=condition=Established crd/applications.argoproj.io --timeout=120s

echo "==> Handing the app over to Argo CD"
kubectl apply -f argocd/application.yaml

echo "==> Done. Argo CD now deploys the app and keeps it in sync with Git."
echo "    Watch progress with: kubectl get pods -n url-shortener"