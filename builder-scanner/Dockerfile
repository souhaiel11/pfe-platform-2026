# V1.7 predeploy phase — dedicated builder/scanner worker image. The ONLY
# component in this platform that execs podman/trivy, and the ONLY one that
# needs CAP_SYS_ADMIN (validation-only per the V1.7 runtime audit; NOT
# applied to production without separate authorization -- see
# n8n-workflows/WF6-V1_7-RUNTIME-INTEGRATION-AUDIT.md). Deliberately does
# NOT install Maven/OpenJDK/Gradle: this process never compiles anything
# itself -- the target repository's OWN Dockerfile (built BY podman, inside
# the container Podman creates) does that.
#
# Build context is the repository ROOT (see ../docker-compose.yml's
# `build.context: .`), matching candidate-verifier/Dockerfile's own
# convention -- needed to COPY the shared, pure security-artifact-scan.ts/
# security-remediation-deadline-contract.ts contracts out of backend/src/.
FROM node:20-bookworm-slim

# git: `trackedSourceDigest()` (git ls-files) against the shared candidate
# workspace. podman + uidmap: real rootless container build/save (uidmap
# provides newuidmap/newgidmap, the setuid helpers rootless Podman's
# multi-ID user-namespace mapping needs -- this image's built-in `node`
# user already has a subuid/subgid range from the base node:20-bookworm
# image). curl: pinned Trivy download below, and used by the readiness
# HEALTHCHECK. ca-certificates: candidate-verifier's own Dockerfile gets
# this transitively via openjdk/maven; this image installs nothing that
# pulls it in, so without it explicitly, curl's own HTTPS trivy download
# fails outright ("error setting certificate file") -- not a floating
# runtime trust decision, just the standard Debian CA bundle every other
# image in this repo already has one way or another.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        curl \
        ca-certificates \
        podman \
        uidmap \
    && rm -rf /var/lib/apt/lists/*

# Rootless Podman storage configuration -- vfs driver (no fuse-overlayfs or
# extra kernel/mount capabilities needed beyond a plain unprivileged
# container), same choice already proven working in the V1.7 runtime
# -integration audit's own probes.
#
# V1.7 runtime stabilization phase, Phase C — `graphroot` pinned to a
# dedicated path (backed by the new `builder_podman_storage` named volume
# in docker-compose.yml) instead of Podman's own rootless default
# ($HOME/.local/share/containers/storage, inside this container's own
# writable layer). Without this, base image layers (maven:3.8.6-openjdk-11,
# eclipse-temurin:11-jre-alpine) survive only for the CURRENT container's
# uptime -- lost on every image rebuild/container recreation, forcing a
# full re-pull on the next deploy even though nothing about those base
# images changed. A dedicated volume, isolated to builder-scanner only
# (never shared with the host Docker daemon's own storage, never
# docker.sock) survives redeploys too.
RUN mkdir -p /etc/containers && printf '%s\n' \
        '[storage]' \
        'driver = "vfs"' \
        'graphroot = "/var/pfe-podman-storage"' \
    > /etc/containers/storage.conf

# Standard Podman boilerplate: Debian's podman package ships no
# unqualified-search-registries default, so a target repository's OWN
# Dockerfile referencing a short image name (e.g. `FROM maven:...`) would
# otherwise be refused outright before any pull is attempted. docker.io is
# the same registry Docker itself defaults to for unqualified names -- not
# a new trust decision. No security/CVE/remediation logic involved.
RUN mkdir -p /etc/containers && printf '%s\n' \
        'unqualified-search-registries = ["docker.io"]' \
    > /etc/containers/registries.conf

# Trivy: pinned + SHA-256 verified against the official release checksums
# file (github.com/aquasecurity/trivy/releases/download/v0.72.0/
# trivy_0.72.0_checksums.txt) -- the exact version SECURITY_ARTIFACT_RUNTIME.
# trivyVersion (security-artifact-validator.ts) already requires the
# adapter's own preflight to match. Never `latest`, never via apt (Debian's
# own trivy package version floats independently of this pin).
ENV TRIVY_VERSION=0.72.0
ENV TRIVY_SHA256=bbb64b9695866ce4a7a8f5c9592002c5961cab378577fa3f8a040df362b9b2ea
RUN curl -fsSL --retry 5 --retry-delay 2 -o /tmp/trivy.tar.gz "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" \
    && echo "${TRIVY_SHA256}  /tmp/trivy.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/trivy.tar.gz -C /usr/local/bin trivy \
    && rm /tmp/trivy.tar.gz

WORKDIR /builder-scanner
COPY builder-scanner/package*.json ./
RUN npm install
COPY builder-scanner/tsconfig.json ./
COPY builder-scanner/tsconfig.build.json ./
COPY builder-scanner/src ./src

# Same minimal, explicitly-enumerated backend/src COPY discipline
# candidate-verifier/Dockerfile uses (never a whole-tree COPY) -- exactly
# the exact 6-file compile closure `npx tsc -p tsconfig.build.json
# --listFilesOnly` reports for this image -- re-verify the same way if a
# future import is ever added here, never widen to a whole-tree COPY.
COPY backend/src/security-remediation/security-artifact-scan.ts /backend/src/security-remediation/security-artifact-scan.ts
COPY backend/src/security-remediation/security-remediation-deadline-contract.ts /backend/src/security-remediation/security-remediation-deadline-contract.ts
COPY backend/src/security-remediation/maven-remediation-scope.ts /backend/src/security-remediation/maven-remediation-scope.ts
COPY backend/src/security-remediation/version-selection-policy.ts /backend/src/security-remediation/version-selection-policy.ts
COPY backend/src/candidate-verification/candidate-digest.ts /backend/src/candidate-verification/candidate-digest.ts
COPY backend/src/candidate-verification/candidate-verification.types.ts /backend/src/candidate-verification/candidate-verification.types.ts

RUN npm run build

# V1.7 runtime provisioning -- run as the base image's EXISTING `node` user
# (uid 1000), never root: the adapter's own preflight requires `podman info
# --format '{{.Host.Security.Rootless}}'` to report `true`, which a
# root-invoked Podman can never satisfy. The base image already registers a
# subuid/subgid range for this exact user (node:100000:65536).
#
# WORKSPACE_ROOT: MUST be the SAME path, backed by the SAME shared volume,
# candidate-verifier's own WORKSPACE_ROOT mounts -- this process builds/
# scans a workspace candidate-verifier already materialized and patched, it
# never creates one of its own. SECURITY_TRIVY_CACHE_DIR: the persistent,
# out-of-band-provisioned Trivy cache volume (Phase B) -- never baked into
# this image, never downloaded by this image at startup or on first use.
ENV WORKSPACE_ROOT=/var/pfe-remediation-workspaces
ENV SECURITY_TRIVY_CACHE_DIR=/var/pfe-trivy-cache
ENV XDG_RUNTIME_DIR=/run/user/1000
ENV HOME=/home/node
# V1.7 final predeploy phase — real bug found during production-like
# validation: a freshly `docker volume create`d named volume (e.g.
# trivy_scanner_cache in docker-compose.yml) is root:root 0755 the first
# time anything mounts it -- UNLESS the image already has a directory at
# that exact path with different ownership, in which case Docker seeds the
# new, empty volume from the image's own copy (owner, mode and all) on
# first mount. Without this, the out-of-band bootstrap script
# (bootstrap-trivy-cache.sh) ran as `node`, downloaded both DBs completely,
# then failed writing them into the cache directory it had no permission
# on -- exiting nonzero and leaving the volume silently empty, discovered
# only by inspecting it directly, not from the download's own progress
# output. Pre-creating and chowning it here, even though the volume mount
# will normally shadow it, is exactly what makes Docker's own "seed from
# image on first mount" behavior land it owned by `node` instead of `root`.
#
# The SAME reasoning applies to WORKSPACE_ROOT (candidate_workspace_shared)
# and REPO_CACHE_ROOT (candidate_repo_cache): both are volumes ALSO mounted
# into candidate-verifier, whose own Dockerfile already pre-creates and
# chowns them to `node`. But docker-compose declares no `depends_on`
# between the two services, so which container's image "wins" the
# one-time volume-seed race on a genuinely fresh deployment is otherwise
# unspecified -- if builder-scanner's container happened to attach a brand
# new candidate_workspace_shared volume first, and this image had no
# directory there to seed FROM, Docker would seed it as an empty
# root-owned directory instead, and candidate-verifier (running as `node`)
# would then fail to write its own workspaces into it. Declaring the SAME
# ownership here as candidate-verifier already does removes the race
# entirely: whichever image seeds the volume first, the result is
# node:node either way.
ENV REPO_CACHE_ROOT=/var/pfe-remediation-repos
# V1.7 runtime stabilization phase, Phase B/C — two more persistent,
# out-of-band, artifact-only caches, same ownership-race reasoning as
# SECURITY_TRIVY_CACHE_DIR above: MAVEN_CACHE_DIR is bind-mounted straight
# into the nested `podman build`'s default Maven local-repo location
# (`/root/.m2`, root being whatever user the TARGET repository's own
# Dockerfile's build stage runs its `mvn` calls as -- verified against the
# real Logback fixture's own Dockerfile, which never sets `USER` before
# its `mvn` RUN steps) via `--volume`, never by rewriting that repository's
# own Dockerfile. PODMAN_GRAPH_ROOT_DIR mirrors storage.conf's `graphroot`
# above. Both contain only downloaded package artifacts / OCI image
# layers -- never a secret, never a candidate decision input; Maven's own
# checksum verification is completely unaffected by where a valid,
# already-verified artifact happens to be read from.
ENV MAVEN_CACHE_DIR=/var/pfe-maven-cache
ENV PODMAN_GRAPH_ROOT_DIR=/var/pfe-podman-storage
RUN mkdir -p "$XDG_RUNTIME_DIR" "$SECURITY_TRIVY_CACHE_DIR" "$WORKSPACE_ROOT" "$REPO_CACHE_ROOT" "$MAVEN_CACHE_DIR" "$PODMAN_GRAPH_ROOT_DIR" \
    && chown node:node "$XDG_RUNTIME_DIR" "$SECURITY_TRIVY_CACHE_DIR" "$WORKSPACE_ROOT" "$REPO_CACHE_ROOT" "$MAVEN_CACHE_DIR" "$PODMAN_GRAPH_ROOT_DIR" \
    && chmod 0700 "$XDG_RUNTIME_DIR"

# V1.7 network-resilience predeploy phase — promotes the validated Podman
# transport tuning from a validation-only runtime override into the
# committed image. `image_parallel_copies = 1` is a PURE TRANSPORT
# setting: it changes how many blob downloads Podman keeps in flight at
# once, nothing else. It does NOT touch pull policy, TLS verification,
# registry authentication, manifest/digest resolution, or any
# security/supply-chain guarantee -- registries.conf/storage.conf above
# are completely untouched by this file. Proven this predeploy phase on
# this exact rootless Podman 4.3.1 / containers-common 0.50.1 install:
# real debug logs showed 8 near-simultaneous blob GETs by default, 1 after
# this setting (each blob's GET -> Copying -> Untar completing fully
# before the next one's GET fires); 3/3 isolated real pulls of the actual
# Logback fixture's own base image succeeded with it, against 0/5 real
# attempts at default concurrency. The rationale is capacity, not
# correctness: this environment's real available bandwidth to the
# registry is small enough that Podman's own default fan-out (several
# blobs at once) fragments it across multiple long-lived connections,
# measurably raising the chance that at least one gets reset mid-transfer
# -- a single in-flight transfer is far more likely to complete, and on
# the rare reset, Podman's own existing internal retry only has to redo
# ONE blob rather than several. This is the SAME
# `/home/node/.config/containers/containers.conf` rootless user-override
# path Podman itself already searches (confirmed via its own debug log:
# `Merged system config ".../containers.conf"`) -- not a host-global or
# system-wide change, and completely inert for any OTHER Podman
# invocation on this host (candidate-verifier holds no Podman at all;
# nothing else in this platform runs Podman).
RUN mkdir -p /home/node/.config/containers \
    && printf '%s\n' '[engine]' 'image_parallel_copies = 1' > /home/node/.config/containers/containers.conf \
    && chown -R node:node /home/node/.config

USER node

EXPOSE 4200
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:4200/healthz || exit 1
CMD ["node", "dist/builder-scanner/src/server.js"]
