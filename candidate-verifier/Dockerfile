# R22-E2C2 — execution-plane worker image. Debian/Bookworm-based (not
# Alpine): musl-libc has documented friction with some JVM/Maven builds,
# and Maven isn't in Alpine's default package set without extra repos
# (R22-E2C1 Phase 3 recommendation). Pinned package versions where the
# Debian archive makes that practical, to avoid floating-version drift.
#
# Build context is the repository ROOT (see ../docker-compose.yml's
# `build.context: .`), not this directory -- required so this Dockerfile
# can COPY the two shared-contract files (candidate-verification.types.ts,
# candidate-digest.ts) and scope-lock.service.ts out of backend/src/,
# which Docker cannot reach from a build context scoped to
# ./candidate-verifier alone.
FROM node:20-bookworm-slim

# git: repository materialization (WorkspaceManager/RepoCacheService).
# openjdk-17-jdk-headless + maven: compile/test the audited target project
# (pfe-app-test targets Java 17, per R22-B). No GUI/X11 dependencies
# (headless), no unnecessary packages.
# curl + unzip: fetch/extract the pinned Gradle binary distribution below
# (Debian's `gradle` package is 4.4.1 -- far too old for any modern build).
# python3 + python3-venv + python3-pip: PythonBuildAdapter builds a throwaway
# venv per candidate and runs pytest in it (Bookworm ships Python 3.11, new
# enough for pytest 8.x). Unpinned, like git/maven/openjdk above -- Debian
# point-release drift on these is acceptable and pinning is impractical once
# apt lists are removed.
# podman + uidmap: the default TrivyImageArtifactValidator adapter
# (security-artifact-validator.ts) execs `podman` directly from this same
# process to build/save the candidate image -- see the V1.7 runtime-
# integration audit (n8n-workflows/WF6-V1_7-RUNTIME-INTEGRATION-AUDIT.md)
# for why this must run rootless: `uidmap` provides newuidmap/newgidmap,
# the setuid helpers rootless Podman's multi-ID user-namespace mapping
# needs (this image's built-in `node` user already has a subuid/subgid
# range from the base node:20-bookworm-slim image -- see USER node below).
# Unpinned via apt, like git/maven/openjdk above -- Debian point-release
# drift on these is acceptable; Trivy (the actual security-sensitive,
# version-pinned tool the adapter checks against) is pinned explicitly
# further down, from upstream with a verified checksum, never via apt.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        openjdk-17-jdk-headless \
        maven \
        curl \
        unzip \
        python3 \
        python3-venv \
        python3-pip \
        podman \
        uidmap \
    && rm -rf /var/lib/apt/lists/*

# Rootless Podman storage configuration -- vfs driver, same choice already
# proven working (without needing fuse-overlayfs or extra kernel/mount
# capabilities beyond a plain unprivileged container) in the V1.7 runtime-
# integration audit's own host-side probe. System-wide so it applies
# regardless of which user podman runs as, without needing a per-user
# ~/.config/containers/storage.conf.
RUN mkdir -p /etc/containers && printf '%s\n' \
        '[storage]' \
        'driver = "vfs"' \
    > /etc/containers/storage.conf

# JAVA_HOME is unset in the base image (Maven resolves Java via /usr/bin/java);
# set it explicitly so Gradle's toolchain auto-detection is deterministic and
# reuses the SAME JDK 17 already installed above -- no second JDK.
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

# Gradle: installed from the official binary distribution (not the ancient
# Debian package), pinned + SHA-256 verified against gradle.org/release-checksums
# -- same anti-drift rule this Dockerfile already applies to apt packages.
# Any recent 8.x runs on JDK 17; bump GRADLE_VERSION + GRADLE_SHA256 together.
ENV GRADLE_VERSION=8.10.2
ENV GRADLE_SHA256=31c55713e40233a8303827ceb42ca48a47267a0ad4bab9177123121e71524c26
ENV GRADLE_HOME=/opt/gradle/gradle-${GRADLE_VERSION}
RUN curl -fsSL -o /tmp/gradle.zip "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" \
    && echo "${GRADLE_SHA256}  /tmp/gradle.zip" | sha256sum -c - \
    && mkdir -p /opt/gradle \
    && unzip -q /tmp/gradle.zip -d /opt/gradle \
    && rm /tmp/gradle.zip \
    && ln -s "${GRADLE_HOME}/bin/gradle" /usr/local/bin/gradle

# V1.7 real-validation phase -- standard Podman boilerplate discovered
# missing when the real Logback base image's Dockerfile (`FROM
# maven:3.8.6-openjdk-11`) failed to resolve: Debian's podman package ships
# no unqualified-search-registries default, so ANY short image name (no
# registry host prefix) is refused outright ("did not resolve to an alias
# and no unqualified-search registries are defined"), before any pull is
# even attempted. docker.io is the same registry Docker itself defaults to
# for unqualified names -- not a new trust decision, just making Podman
# resolve names the same way every image referenced by this repository
# already assumes. No security/CVE/remediation logic involved.
RUN mkdir -p /etc/containers && printf '%s\n' \
        'unqualified-search-registries = ["docker.io"]' \
    > /etc/containers/registries.conf

# Trivy: pinned + SHA-256 verified against the official release checksums
# file (github.com/aquasecurity/trivy/releases/download/v0.72.0/
# trivy_0.72.0_checksums.txt), same anti-drift rule as Gradle above, and the
# exact version SECURITY_ARTIFACT_RUNTIME.trivyVersion (security-artifact-
# validator.ts) already requires the adapter's own preflight to match.
# Never `latest`, never via apt (Debian's own trivy package version floats
# independently of this pin).
ENV TRIVY_VERSION=0.72.0
ENV TRIVY_SHA256=bbb64b9695866ce4a7a8f5c9592002c5961cab378577fa3f8a040df362b9b2ea
RUN curl -fsSL -o /tmp/trivy.tar.gz "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" \
    && echo "${TRIVY_SHA256}  /tmp/trivy.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/trivy.tar.gz -C /usr/local/bin trivy \
    && rm /tmp/trivy.tar.gz

# WORKDIR is named /candidate-verifier (not /app) so tsc's rootDir
# auto-computation (tsconfig's rootDir:"../", relative to wherever this
# tsconfig.json actually lives) mirrors the SAME relative shape as the
# local dev checkout (platform/candidate-verifier/ + platform/backend/,
# both one level under platform/) -- proven empirically: naming this /app
# instead put the compiled entry point at dist/app/src/server.js, not
# dist/candidate-verifier/src/server.js as package.json's `start` script
# and CMD below both assume.
WORKDIR /candidate-verifier
COPY candidate-verifier/package*.json ./
RUN npm install
COPY candidate-verifier/tsconfig.json ./
COPY candidate-verifier/tsconfig.build.json ./
COPY candidate-verifier/src ./src

# Shared-contract files, copied into the SAME relative position the local
# dev layout uses (../backend/src/... from candidate-verifier/), so the
# already-compiled import paths in src/*.ts resolve identically without
# any path rewriting at build time.
#
# V1.7 image-provisioning phase -- this is now the EXACT, minimal compile
# closure `npx tsc -p tsconfig.build.json --listFilesOnly` reports for
# candidate-verifier (verified this phase; re-verify the same way if a new
# backend/src/security-remediation import is ever added and this build
# starts failing with TS2307 again -- update this list, never widen to a
# whole-tree COPY). A prior version of this Dockerfile briefly used `COPY
# backend/src /backend/src` after discovering the narrower, three-file list
# below it replaced was incomplete; that whole-tree copy was itself
# discovered to be unnecessarily broad once security-patch-guard.ts's
# stray import of incidents.service.ts (a full NestJS/TypeORM-coupled
# service, pulled in for ONE pure utility function) was fixed by moving
# that function into candidate-digest.ts below (see that file's own
# comment) -- confirmed empirically: with that fix, this exact 17-file list
# is sufficient, zero TypeORM/NestJS-entity files are ever reached, and
# `npm run build` succeeds. backend/src contains only TypeScript source (no
# .env, no secret VALUES); this changes what compiles, not what the running
# worker process is handed at runtime (still only PORT/WORKSPACE_ROOT/
# REPO_CACHE_ROOT, per docker-compose.yml -- verified by
# candidate-verifier/isolation.spec.ts).
COPY backend/src/candidate-verification/candidate-digest.ts /backend/src/candidate-verification/candidate-digest.ts
COPY backend/src/candidate-verification/candidate-verification.types.ts /backend/src/candidate-verification/candidate-verification.types.ts
COPY backend/src/context/scope-lock.service.ts /backend/src/context/scope-lock.service.ts
COPY backend/src/security-remediation/dependency-provenance.types.ts /backend/src/security-remediation/dependency-provenance.types.ts
COPY backend/src/security-remediation/fixed-version-normalizer.ts /backend/src/security-remediation/fixed-version-normalizer.ts
COPY backend/src/security-remediation/grounded-maven-provenance.types.ts /backend/src/security-remediation/grounded-maven-provenance.types.ts
COPY backend/src/security-remediation/maven-dependency-resolution-check.ts /backend/src/security-remediation/maven-dependency-resolution-check.ts
COPY backend/src/security-remediation/maven-provenance-resolver.ts /backend/src/security-remediation/maven-provenance-resolver.ts
COPY backend/src/security-remediation/maven-remediation-scope.ts /backend/src/security-remediation/maven-remediation-scope.ts
COPY backend/src/security-remediation/maven-security-patch-writer.ts /backend/src/security-remediation/maven-security-patch-writer.ts
COPY backend/src/security-remediation/maven-parent-patch-writer.ts /backend/src/security-remediation/maven-parent-patch-writer.ts
COPY backend/src/security-remediation/parent-version-effective-model-check.ts /backend/src/security-remediation/parent-version-effective-model-check.ts
COPY backend/src/security-remediation/security-candidate-identity.ts /backend/src/security-remediation/security-candidate-identity.ts
COPY backend/src/security-remediation/security-eligibility-classifier.ts /backend/src/security-remediation/security-eligibility-classifier.ts
COPY backend/src/security-remediation/security-finding-decision.types.ts /backend/src/security-remediation/security-finding-decision.types.ts
COPY backend/src/security-remediation/security-patch-guard.ts /backend/src/security-remediation/security-patch-guard.ts
COPY backend/src/security-remediation/security-patch-request.types.ts /backend/src/security-remediation/security-patch-request.types.ts
COPY backend/src/security-remediation/security-remediation-orchestration.types.ts /backend/src/security-remediation/security-remediation-orchestration.types.ts
COPY backend/src/security-remediation/version-selection-policy.ts /backend/src/security-remediation/version-selection-policy.ts
COPY backend/src/security-remediation/security-remediation-deadline-contract.ts /backend/src/security-remediation/security-remediation-deadline-contract.ts
COPY backend/src/security-remediation/security-artifact-scan.ts /backend/src/security-remediation/security-artifact-scan.ts

# scope-lock.service.ts's `import { Injectable } from '@nestjs/common'`
# resolves via Node's normal upward node_modules search starting at
# /backend/src/context/ -- which finds nothing in this image (unlike the
# local dev checkout, where backend/ has its own real `npm install`).
# Symlinking /backend/node_modules to the worker's own node_modules (which
# already has @nestjs/common/reflect-metadata/rxjs, per package.json) makes
# that lookup succeed the same way the sibling backend/ checkout does
# locally, without vendoring a second copy of the packages.
RUN ln -s /candidate-verifier/node_modules /backend/node_modules

RUN npm run build

# V1.7 runtime provisioning -- run as the base image's EXISTING `node` user
# (uid 1000), never root: the default adapter's own preflight requires
# `podman info --format '{{.Host.Security.Rootless}}'` to report `true`,
# which a root-invoked Podman can never satisfy (root doesn't consult
# /etc/subuid at all -- see the V1.7 Podman execution-location audit). The
# base image already registers a subuid/subgid range for this exact user
# (confirmed: `node:100000:65536` in /etc/subuid and /etc/subgid) -- no new
# range is created here, only actually used.
#
# WORKSPACE_ROOT/REPO_CACHE_ROOT: match docker-compose.yml's env vars
# exactly (WorkspaceManager/RepoCacheService default to these paths when
# unset, so this Dockerfile ownership fix stays correct even if a caller
# overrides them at runtime is NOT assumed -- these two are the paths
# actually configured today). Owned by node, not world-writable.
#
# XDG_RUNTIME_DIR: rootless Podman needs a real, writable, mode-0700
# per-user runtime directory. Non-interactive containers have no
# systemd-logind session to create /run/user/<uid> automatically, so it is
# created and owned explicitly here rather than left to Podman's own
# fallback guessing -- the exact "do not guess values without testing"
# requirement this phase was given.
ENV WORKSPACE_ROOT=/var/pfe-remediation-workspaces
ENV REPO_CACHE_ROOT=/var/pfe-remediation-repos
ENV XDG_RUNTIME_DIR=/run/user/1000
ENV HOME=/home/node
RUN mkdir -p "$WORKSPACE_ROOT" "$REPO_CACHE_ROOT" "$XDG_RUNTIME_DIR" \
    && chown node:node "$WORKSPACE_ROOT" "$REPO_CACHE_ROOT" "$XDG_RUNTIME_DIR" \
    && chmod 0700 "$XDG_RUNTIME_DIR"

USER node

EXPOSE 4100
CMD ["node", "dist/candidate-verifier/src/server.js"]
