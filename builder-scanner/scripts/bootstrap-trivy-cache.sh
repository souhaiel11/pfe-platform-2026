#!/bin/sh
# V1.7 Phase B — the ONLY sanctioned way the Trivy DB cache is ever
# populated. Never run implicitly by a business evaluation; run this
# explicitly, out-of-band, before the builder is expected to serve real
# traffic, and again on whatever periodic schedule TRIVY_DB_UPDATE_POLICY/
# TRIVY_JAVA_DB_UPDATE_POLICY call for (see n8n-workflows/
# WF6-V1_7-RUNTIME-INTEGRATION-AUDIT.md).
#
# Usage (from the repo root, once the builder-scanner image exists):
#   docker compose run --rm builder-scanner sh scripts/bootstrap-trivy-cache.sh
#
# This writes into trivy_scanner_cache (the SAME persistent named volume the
# real builder-scanner service mounts at SECURITY_TRIVY_CACHE_DIR), so a
# freshly (re)started builder-scanner container immediately finds a
# populated, ready cache -- it never has to download anything itself.
set -eu

echo "Bootstrapping Trivy vulnerability DB into ${SECURITY_TRIVY_CACHE_DIR:?SECURITY_TRIVY_CACHE_DIR must be set}..."
trivy image --cache-dir "$SECURITY_TRIVY_CACHE_DIR" --download-db-only --timeout 10m

echo "Bootstrapping Trivy Java DB into ${SECURITY_TRIVY_CACHE_DIR}..."
trivy image --cache-dir "$SECURITY_TRIVY_CACHE_DIR" --download-java-db-only --timeout 10m

echo "Done. Verifying readiness..."
trivy --version
