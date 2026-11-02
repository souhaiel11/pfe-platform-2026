#!/bin/sh
# Prépare explicitement les bases Trivy avant les scans, avec un délai propre à chaque base.
set -eu

# Chaque base dispose de son délai : 10 minutes pour les CVE, 30 minutes pour Java.
TRIVY_VULN_DB_BOOTSTRAP_TIMEOUT=10m
TRIVY_JAVA_DB_BOOTSTRAP_TIMEOUT=30m

echo "Bootstrapping Trivy vulnerability DB into ${SECURITY_TRIVY_CACHE_DIR:?SECURITY_TRIVY_CACHE_DIR must be set}..."
trivy image --cache-dir "$SECURITY_TRIVY_CACHE_DIR" --download-db-only --timeout "$TRIVY_VULN_DB_BOOTSTRAP_TIMEOUT"

echo "Bootstrapping Trivy Java DB into ${SECURITY_TRIVY_CACHE_DIR}..."
trivy image --cache-dir "$SECURITY_TRIVY_CACHE_DIR" --download-java-db-only --timeout "$TRIVY_JAVA_DB_BOOTSTRAP_TIMEOUT"

echo "Done. Verifying readiness..."
trivy --version
