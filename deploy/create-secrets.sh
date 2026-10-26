#!/usr/bin/env bash
# Creates the cluster's secrets with random values.
# Safe to re-run: a secret that already exists is never overwritten,
# because replacing a database password would lock the app out of its own data.
set -euo pipefail

NS=url-shortener

kubectl get namespace "$NS" >/dev/null 2>&1 || kubectl create namespace "$NS"

rand_hex() { openssl rand -hex "${1:-24}"; }

create_if_missing() {
  local name="$1"; shift
  if kubectl -n "$NS" get secret "$name" >/dev/null 2>&1; then
    echo "secret/$name already exists, leaving it alone"
  else
    kubectl -n "$NS" create secret generic "$name" "$@"
  fi
}

create_if_missing postgres-secret --from-literal=POSTGRES_PASSWORD="$(rand_hex)"
create_if_missing analytics-db-secret --from-literal=POSTGRES_PASSWORD="$(rand_hex)"
create_if_missing rabbitmq-secret \
  --from-literal=RABBITMQ_DEFAULT_USER=app \
  --from-literal=RABBITMQ_DEFAULT_PASS="$(rand_hex)"
create_if_missing auth-secret --from-literal=JWT_SECRET="$(rand_hex 32)"