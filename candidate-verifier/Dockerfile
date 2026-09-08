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
    && rm -rf /var/lib/apt/lists/*

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
COPY candidate-verifier/src ./src

# Shared-contract files, copied into the SAME relative position the local
# dev layout uses (../backend/src/... from candidate-verifier/), so the
# already-compiled import paths in src/*.ts resolve identically without
# any path rewriting at build time.
COPY backend/src/candidate-verification/candidate-verification.types.ts /backend/src/candidate-verification/candidate-verification.types.ts
COPY backend/src/candidate-verification/candidate-digest.ts /backend/src/candidate-verification/candidate-digest.ts
COPY backend/src/context/scope-lock.service.ts /backend/src/context/scope-lock.service.ts

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

EXPOSE 4100
CMD ["node", "dist/candidate-verifier/src/server.js"]
