/** V1.7 runtime stabilization phase, Phase A/D — pure unit tests for
 * parseBaseImages(), which decides which FROM images get their own
 * explicit, separately-timed PODMAN_BASE_IMAGE_PULL stage. */
import * as assert from 'assert';
import { parseBaseImages } from './security-artifact-validator';

// 1. The real Logback fixture's exact shape: two real external images,
// the second stage has no `AS` alias.
assert.deepEqual(parseBaseImages(
  'FROM maven:3.8.6-openjdk-11 AS builder\nWORKDIR /app\nRUN mvn package\nFROM eclipse-temurin:11-jre-alpine\nCOPY --from=builder /app/target/app.jar app.jar\n'
), ['maven:3.8.6-openjdk-11', 'eclipse-temurin:11-jre-alpine']);

// 2. A later stage referencing an EARLIER stage's alias (multi-stage
// cross-reference) must NOT be treated as an external image -- it never
// contacts a registry at all.
assert.deepEqual(parseBaseImages(
  'FROM golang:1.21 AS build\nFROM build AS test\nFROM alpine:3.19\n'
), ['golang:1.21', 'alpine:3.19']);

// 3. Duplicate FROM of the exact same image (common in some multi-stage
// Dockerfiles) is pulled once, not twice.
assert.deepEqual(parseBaseImages('FROM node:20 AS a\nFROM node:20 AS b\n'), ['node:20']);

// 4. `--platform` flag before the image reference is skipped, not treated
// as the image itself.
assert.deepEqual(parseBaseImages('FROM --platform=linux/amd64 python:3.12-slim\n'), ['python:3.12-slim']);

// 5. Case-insensitive `FROM`/`AS`, leading whitespace, no trailing content.
assert.deepEqual(parseBaseImages('  from Ubuntu:22.04 as base\n'), ['Ubuntu:22.04']);

// 6. No FROM lines at all -> empty list, never throws.
assert.deepEqual(parseBaseImages('# just a comment\nRUN echo hi\n'), []);

console.log('parseBaseImages: PASS (real fixture shape, cross-stage aliasing excluded, duplicates deduped, --platform skipped, case-insensitive, empty-safe)');
