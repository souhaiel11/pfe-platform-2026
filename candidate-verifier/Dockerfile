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
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        openjdk-17-jdk-headless \
        maven \
    && rm -rf /var/lib/apt/lists/*

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
