#!/bin/sh
# Starts MLflow on Railway's private network with basic auth. Basic auth
# reads its user database only from a config file, so the file is written
# here from the environment: with the default SQLite file every redeploy
# would lose the users. Nobody has access unless granted (NO_PERMISSIONS);
# the admin user is created on the first start from
# MLFLOW_AUTH_ADMIN_PASSWORD.
set -eu
: "${MLFLOW_BACKEND_STORE_URI:?Set MLFLOW_BACKEND_STORE_URI}"
: "${MLFLOW_AUTH_DB_URI:?Set MLFLOW_AUTH_DB_URI}"
: "${MLFLOW_AUTH_ADMIN_PASSWORD:?Set MLFLOW_AUTH_ADMIN_PASSWORD}"
: "${MLFLOW_FLASK_SERVER_SECRET_KEY:?Set MLFLOW_FLASK_SERVER_SECRET_KEY}"
mkdir -p /data/artifacts
# configparser reads % as the start of a reference, so a % in the URI is
# doubled.
auth_uri=$(printf '%s' "$MLFLOW_AUTH_DB_URI" | sed 's/%/%%/g')
cat > /tmp/basic_auth.ini <<INI
[mlflow]
default_permission = NO_PERMISSIONS
database_uri = $auth_uri
admin_username = admin
authorization_function = mlflow.server.auth:authenticate_request_basic_auth
grant_default_workspace_access = false
INI
export MLFLOW_AUTH_CONFIG_PATH=/tmp/basic_auth.ini
# A newer MLflow may refuse to start on the tables an older one made
# ("out-of-date database schema"). When upgrading (docs/tracing.md), once
# the databases are backed up, MLFLOW_DB_UPGRADE=1 runs this version's
# migrations first.
if [ "${MLFLOW_DB_UPGRADE:-}" = 1 ]; then
  mlflow db upgrade "$MLFLOW_BACKEND_STORE_URI"
fi
# :: listens on IPv6, which Railway's private network uses. The port is
# fixed: the app's MLFLOW_TRACKING_URI names it.
exec mlflow server \
  --host "${MLFLOW_HOST:-::}" \
  --port 5000 \
  --workers 1 \
  --backend-store-uri "$MLFLOW_BACKEND_STORE_URI" \
  --artifacts-destination /data/artifacts \
  --serve-artifacts \
  --app-name basic-auth \
  --allowed-hosts "${MLFLOW_ALLOWED_HOSTS:-mlflow.railway.internal,mlflow.railway.internal:5000}"
