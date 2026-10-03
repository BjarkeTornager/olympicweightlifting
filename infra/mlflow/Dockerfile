# Lift Journal's diagnostic trace store (docs/tracing-setup.md): MLflow,
# pinned, with a start script that keeps basic auth's users in Postgres.
# Upgrade by changing the tag after reading docs/tracing.md.
FROM ghcr.io/mlflow/mlflow:v3.16.1-full
# MLflow otherwise reports its own usage to its makers.
ENV MLFLOW_DISABLE_TELEMETRY=true DO_NOT_TRACK=true
# No background jobs (online scoring, archival): traces don't use them, and
# their eight worker processes took the server from about 0.4 to 1.6 GB.
ENV MLFLOW_SERVER_ENABLE_JOB_EXECUTION=false
COPY start.sh /start.sh
ENTRYPOINT ["sh", "/start.sh"]
