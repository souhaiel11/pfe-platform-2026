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

# V1.7 bootstrap-timeout-split phase — the vulnerability DB (~118MiB) and
# the Java DB (~927MiB, ~8x larger) are two independently-sized OCI blobs,
# each pulled in a single non-resumable shot (no --retry flag exists on
# `trivy image`'s DB fetch; a failed attempt restarts from byte 0). A single
# shared timeout tuned for one is provably wrong for the other. Real
# mirror.gcr.io throughput samples this phase: 877135 / 1210679 / 1642571
# B/s. At the worst of those, vuln DB finishes in ~140s (10m has ~4.3x
# margin); Java DB needs ~1108s, which a shared 10m (600s) budget cannot
# cover but a dedicated 30m (1800s) budget covers with ~62% headroom
# (~540234 B/s minimum sustained average required for 30m; not a guarantee
# against a complete outage, just headroom against the measured jitter).
# Each DB keeps its own bounded, finite timeout; neither retries.
TRIVY_VULN_DB_BOOTSTRAP_TIMEOUT=10m
TRIVY_JAVA_DB_BOOTSTRAP_TIMEOUT=30m

echo "Bootstrapping Trivy vulnerability DB into ${SECURITY_TRIVY_CACHE_DIR:?SECURITY_TRIVY_CACHE_DIR must be set}..."
trivy image --cache-dir "$SECURITY_TRIVY_CACHE_DIR" --download-db-only --timeout "$TRIVY_VULN_DB_BOOTSTRAP_TIMEOUT"

echo "Bootstrapping Trivy Java DB into ${SECURITY_TRIVY_CACHE_DIR}..."
trivy image --cache-dir "$SECURITY_TRIVY_CACHE_DIR" --download-java-db-only --timeout "$TRIVY_JAVA_DB_BOOTSTRAP_TIMEOUT"

echo "Done. Verifying readiness..."
trivy --version
