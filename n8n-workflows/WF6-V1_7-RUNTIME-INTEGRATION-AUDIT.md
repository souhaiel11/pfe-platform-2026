# V1.7 runtime integration — Blocker A / Blocker B continuation

Supersedes the prior state recorded in this same file (same filename,
rewritten this phase). [The offline fixture-closure audit](WF6-V1_7-OFFLINE-AUDIT.md)
is unchanged, historical evidence from an earlier phase and is not
re-litigated here. Full field values are in [the JSON companion](WF6-V1_7-RUNTIME-INTEGRATION-AUDIT.json).

**Latest phase (runtime stabilization before predeploy) is recorded ONLY
in the JSON companion's `RUNTIME_STABILIZATION_BEFORE_PREDEPLOY_PHASE`
block** — implemented a persistent Maven cache and persistent Podman
graph-root/layer cache for builder-scanner, separated base-image-pull
timing from build-execution timing (which correctly and immediately
attributed a real failure this same phase), documented the registry
freshness/staleness tradeoff without weakening it, and revalidated the
orphan-process fix across all 5 required real failure shapes plus a
direct real-container proof that `init: true` reaps adopted children.
Phase G's required 5-warm-run measurement could NOT be completed: 5
consecutive real attempts to pull an unchanged base image all failed or
timed out against the container registry, from 3 different CDN edge
IPs — a real, currently-degraded network condition, disclosed rather
than retried indefinitely. `WORKER_DEADLINE_MS` stays at `900000`
(unrevised — no new evidence to move it either way this phase).
`READY_FOR_V1_7_PREDEPLOY_REVIEW = NO`, for the same reason as before
plus this new, arguably more urgent registry-reachability finding.

**Historical framing below (kept verbatim); see "Update 6" further down —
the three FINAL closure items (service-to-service authentication,
`CAP_SYS_ADMIN` production placement, deadline re-evaluation) are now all
DECIDED and real-proven, at WORKER_DEADLINE_MS=900000/BACKEND_HTTP_
TIMEOUT_MS=910000/WF6_HTTP_TIMEOUT_MS=920000. A real orphan-process leak
was found and fixed along the way. One honestly-disclosed residual risk
remains open: even the raised 900000ms ceiling was observed to legitimately
bind for real multiple times in this same phase's own validation.**

**READY_FOR_V1_7_PREDEPLOY_REVIEW = NO (as of the original writing below;
see Update 6 for the current, superseding state).**
Blocker A is a confirmed, reproducible
environmental limitation (FAIL_CLOSED, not fixable from inside this session).
Blocker B is now implemented, tested and measured for every phase reachable
in this environment; the two phases Blocker A blocks (`podman build`, `trivy
scan`) remain NOT_PROVEN for real, so the sync-vs-async question is answered
only for the part of the pipeline that could actually be exercised.

> **Update 6 (V1.7 final security/deadline predeploy closure, same repo,
> later phase).** Closed the three remaining named decisions.
>
> **Authentication (Phase A):** candidate-verifier now authenticates to
> builder-scanner's `/internal/build-scan` with a shared-secret
> `X-Internal-Secret` header — the SAME mechanism the codebase already
> uses one hop up (`backend/src/auth/internal-secret.guard.ts`), reused by
> design rather than inventing a second kind of credential system, but
> with its own dedicated `BUILDER_INTERNAL_SECRET` so the two trust
> domains stay independent. The header value is written to a mode-0600
> temp file and handed to `curl` via `-K`, never `-H`, specifically so it
> never appears in `ps`/`/proc/<pid>/cmdline` output. Real HTTP proof:
> NO_AUTH and BAD_AUTH both get a real 401 `AUTH_REJECTED` before any
> business logic runs (not even the request body is read); VALID_AUTH
> reaches the real validator.
>
> **`CAP_SYS_ADMIN` placement (Phase B/C):** decided. `docker-compose.yml`
> now grants `cap_add: [SYS_ADMIN]` to `builder-scanner` and ONLY
> `builder-scanner` — never `candidate-verifier`, which stays at zero
> elevated capability. Every other control verified structurally (not just
> asserted) via a real `docker compose config` parse: not privileged, no
> `security_opt` (default seccomp), no host pid/network, no published
> port, `builder-scanner-net`'s membership exactly
> `{candidate-verifier, builder-scanner}`, no forbidden secret key on
> either service.
>
> **Deadline re-evaluation (Phase D/E):** re-derived from scratch, not
> kept merely because `600000` pre-existed. A dedicated measurement first
> caught its own mistake — four early attempts requesting a "generous
> 900000ms" budget were silently clamped to the still-`600000` contract,
> since the contract file itself hadn't been edited yet. Corrected by
> temporarily raising it to `1500000` purely to observe the TRUE uncapped
> natural completion time: a real, disclosed outlier of **1,278,378ms**
> (~21.3min) resulted — not discarded. **`WORKER_DEADLINE_MS` is now
> `900000`** (the more conservative of the two evaluated candidates, not
> `720000`) — `BACKEND_HTTP_TIMEOUT_MS=910000`, `WF6_HTTP_TIMEOUT_MS=920000`.
> **Honest finding, not smoothed over:** confirming this exact 900000ms
> ceiling afterward, it was legitimately reached for real TWICE more
> (`900125ms`, `900047ms`) before one clean `CANDIDATE_READY` at
> `662455ms` finally landed. 900000ms is the best-evidenced choice between
> the two offered candidates, but it is not a comfortable guarantee under
> this environment's real network conditions — carried forward explicitly
> as a residual, disclosed risk, not resolved by quietly picking a third,
> larger, unauthorized number.
>
> **A real bug found and fixed along the way (Phase F/G):** direct `/proc`
> inspection during that same measurement work found dozens of
> accumulated zombie processes and — far more seriously — at least one
> STILL-LIVE, actively CPU-consuming orphaned `mvn` process, minutes after
> its build had been reported as killed. Root cause: `execFileSync`'s own
> timeout only SIGKILLs the one tracked child (`podman build` itself); a
> `--isolation=chroot` RUN-step process shares this container's own pid
> namespace rather than getting its own, so it survives when its immediate
> parent is killed without the chance to run its own teardown, becoming
> orphaned to this image's PID 1 (`node`), which never reaps a process it
> did not itself spawn. Fixed at two levels: a PID-snapshot-before/
> kill-new-orphans-after sweep in `security-artifact-validator.ts`
> (single-tenant by construction, so any new PID is unambiguously this
> call's own), proven with a REAL reproduction test that substitutes a
> real backgrounding shell for `podman build` and confirms the marker
> process does not survive; and `init: true` on builder-scanner's compose
> service (Docker's built-in `tini`) so any orphan that does die on its
> own gets reaped instead of accumulating as a permanent zombie. This
> orphan contention likely inflated some of the timing evidence above —
> disclosed as a confound, not fully re-isolated given the real time cost
> of each attempt.
>
> Also hardened, found during the same investigation: `effectiveBudgetMs()`
> (the function deciding what budget the client forwards to the builder)
> previously let a budget that was PASSED but floored to zero or below
> silently fall back to the FULL `WORKER_DEADLINE_MS` ceiling instead of
> failing fast — fixed to clamp to a 1ms floor instead, matching
> `worker-deadline.ts`'s own existing discipline, and unit-tested directly.
>
> Full fresh regression, all green: `68/68` backend, `27/27`
> candidate-verifier (24 + the 3 that have always run via `ts-node`),
> `6/6` builder-scanner (5 + the new orphan-sweep reproduction), `127/127`
> WF6, `14/14` n8n-compatibility, all TypeScript projects clean, real
> `docker compose build` for both services clean, `docker compose config`
> clean, `git diff --check` clean, WF6 artifact regenerated twice,
> byte-identical
> (`b935367e4bf7bae07fdb66a5f62e982149c5d965aead4dc2606a374c7fdddd57`).
> No routing/PR/GitHub/live-n8n/deployment/commit/push action taken; all
> disposable validation containers/network/volumes/images destroyed
> afterward; `docker ps` confirmed unchanged production containers
> throughout. Full detail in the
> `FINAL_SECURITY_DEADLINE_PREDEPLOY_CLOSURE_PHASE` block of the JSON
> companion.
>
> **What this does and does not settle:** authentication, capability
> placement, and a re-evaluated deadline are all now DECIDED, not merely
> analyzed. What remains is a genuine, disclosed judgment call reserved for
> the user: whether a 900000ms ceiling's real, repeatedly-observed
> (imperfect) success rate is an acceptable bounded risk to predeploy with,
> or whether it warrants a further-authorized ceiling increase or real
> infrastructure work (a closer/faster Maven mirror, pre-warmed dependency
> caches) before sign-off.
>
> **Update 5 (V1.7 final predeploy implementation: timeout contract +
> Trivy cache + dedicated builder, same repo, later phase).** Implemented
> all three concrete blockers from the runtime audit as real, tested code
> (not just design):
>
> **Deadline contract** — `backend/src/security-remediation/
> security-remediation-deadline-contract.ts` (new) is now the single
> source of truth: `WORKER_DEADLINE_MS=600000`,
> `BACKEND_TRANSPORT_SLACK_MS=10000`,
> `BACKEND_HTTP_TIMEOUT_MS=610000` (derived, not a second hand-maintained
> literal). Both candidate-verifier's `worker-deadline.ts` and backend's
> `candidate-verification.service.ts` import it; new tests prove
> `599999`/`600000` pass through unchanged and the worker itself clamps
> anything above `600000` down to it, and that the backend always waits
> longer than the worker.
>
> **Trivy cache contract** — a new persistent named volume
> (`trivy_scanner_cache`) and an explicit, documented, out-of-band
> bootstrap script (`--download-db-only`/`--download-java-db-only`,
> matching the DB-bootstrap gap found and correctly classified in Update
> 4 — never patched around by touching `--skip-db-update` in source). A
> new readiness check (`trivy-readiness.ts`) parses Trivy's own stable
> `--version` text output and fails closed (`TRIVY_DB_NOT_PROVISIONED`)
> both at `/healthz` and defensively inside the scan handler itself if
> either DB is missing or stale — catching a real bug in its own first
> draft (it wasn't pointed at the configured cache directory at all,
> which would have silently checked the wrong location in production).
>
> **Dedicated builder/scanner split** — a new, minimal `builder-scanner/`
> component now does ONLY the untrusted-repo-controlled build+scan step
> (rootless Podman `--isolation=chroot` + Trivy), moved verbatim out of
> candidate-verifier, which keeps 100% of the decision logic (grounding,
> patch generation, guard, CVE-closure, write authorization) and now holds
> **zero** elevated capability. The two talk over one narrow HTTP
> endpoint (`POST /internal/build-scan`, structured JSON in and out, no
> shell/command field) across a brand-new, dedicated
> `builder-scanner-net` Docker network — network isolation is the entire
> trust boundary, no new authentication system, matching the existing
> backend↔candidate-verifier precedent. `builder-scanner` runs as
> `USER node`, no `privileged`, no `docker.sock`, Docker's default
> seccomp untouched, and **`CAP_SYS_ADMIN` is explicitly NOT granted in
> the committed `docker-compose.yml`** — that remains a reserved,
> undecided production question, exactly as instructed.
>
> Proved the whole split for real, not just unit-tested: two disposable
> containers (`v17-split-verifier`/`v17-split-builder`) on a throwaway
> network, real HTTP call, real rootless Podman build, real Trivy 0.72.0
> scan against a warm persistent cache, real CVE-2023-6378 closure
> decision made by candidate-verifier purely from the builder's structured
> response. Along the way, found and fixed two real bugs: a sub-millisecond
> float deadline value crashing Node's `execFileSync` timeout option
> (misclassified as "executable unavailable" for the first ~1ms of every
> call), and a `git worktree`'s `.git` file pointing at metadata under
> `REPO_CACHE_ROOT` that wasn't shared into the builder container (fixed
> with a read-only volume mount). After both fixes: one real deadline-kill
> (correctly `TECHNICAL_FAILURE`, zero leaked containers/images/
> workspaces), one transient network failure (same category observed all
> session), then a clean **`CANDIDATE_READY`** —
> `logback-classic`/`logback-core` both `1.2.13`, CVE match count `0`,
> `TARGET_CVE_CLOSED=YES` — at `TOTAL_WORKER_DURATION_MS=576432`, i.e.
> **inside** the 600000ms ceiling, which was deliberately **not** raised
> this phase.
>
> **Honest margin finding, not smoothed over:** that clean pass leaves
> only ~3.9% headroom under the ceiling, and in the very same run log a
> separate attempt was correctly killed AT the ceiling under transient
> network conditions. This session has observed real build/scan time
> ranging roughly 190s–600s+ under varying network conditions throughout
> — treat 600000ms as thinly, not comfortably, proven, and as a candidate
> for deliberate, separately-authorized follow-up (larger ceiling, or
> infra changes to cut real build time), not as settled.
>
> With the backend contract proven first, exactly per instruction, WF6's
> `n8n-workflows/scripts/build-wf6-security-remediation.mjs` was then
> updated to raise **only** the 4 real security-evaluation/revalidation
> HTTP nodes (`Evaluate Security Remediation`, all 3 `Revalidate Before
> Write (...)` nodes) from `30000ms` to `620000ms` (=`BACKEND_HTTP_
> TIMEOUT_MS` + a further 10s n8n-side slack); every other HTTP node in
> the workflow stays at `30000ms`, proven by an explicit test asserting
> both the 4 changed nodes and the >10 unaffected ones. This necessarily
> required updating one pre-existing `wf6-n8n-compatibility.spec.mjs`
> assertion that had blindly checked `timeout===30000` for every node —
> updated with a visible, commented allowlist rather than silently
> patched. All three full revalidations on the create path are retained
> unchanged (`FULL_SCAN_CALL_COUNT_CREATE_PATH=3`) — no optimization-away
> attempted, out of scope.
>
> Full fresh regression, everything green: `68/68` backend, `25/25`
> candidate-verifier, `4/4` builder-scanner (new), `127/127` WF6 (126 +
> 1 new), `14/14` n8n-compatibility (after the necessary update), all
> three TypeScript projects clean, both/all images rebuilt fresh,
> `git diff --check` clean, and the WF6 artifact regenerated twice,
> byte-identical both times
> (`9a3f04d687093169c93f23cf94d36923d9df6434250b363ad79666f5a456bcd0` —
> changed from the pre-phase hash, expected, reflects only the intentional
> timeout change). No routing/PR/GitHub/live-n8n/deployment/commit/push
> action taken. Full detail in the `FINAL_PREDEPLOY_IMPLEMENTATION_PHASE`
> block of the JSON companion.
>
> **What this does and does not settle:** the three concrete blockers are
> now genuinely implemented and real-proven, and WF6's timeout is
> reconciled to match. Two decisions remain, deliberately not made here:
> `builder-scanner`'s production `CAP_SYS_ADMIN` placement, and whether
> the 600000ms ceiling's thin real-world margin needs to change before an
> actual predeploy sign-off.
>
> **Update 4 (authorized `--isolation=chroot` + complete real validation,
> same day) — V1.7's real Podman/Trivy/CVE-closure prerequisite is now
> PROVEN.** Added `--isolation=chroot` to the one `podman build` call in
> `security-artifact-validator.ts` (exactly that one argument; deterministic
> construction now regression-tested, scoped to `build` only, no other
> command touched). A second, unrelated provisioning gap surfaced and was
> fixed: `candidate-verifier/Dockerfile` never configured
> `/etc/containers/registries.conf`, so Podman refused to resolve
> unqualified image names like `maven:3.8.6-openjdk-11` at all — added
> standard `unqualified-search-registries = ["docker.io"]` boilerplate
> (zero security/CVE logic). A fresh source image build passed.
>
> In the same disposable, `CAP_SYS_ADMIN`-only, default-seccomp validation
> container: audited Trivy's DB cache contract honestly — a genuinely fresh
> runtime has NO cache, and `--skip-db-update`/`--skip-java-db-update` both
> fail on a first run exactly as the adapter's own flags would hit in a
> real fresh deployment (`TRIVY_DB_BOOTSTRAP_CONTRACT_GAP`, correctly
> classified, never patched around in source). Provisioned both DBs via
> Trivy's own official `--download-db-only`/`--download-java-db-only`
> flags — a one-time, documented bootstrap step, not a code change.
>
> Then ran the REAL, completely unmodified default adapter (compiled
> `dist/` JS, no fixture scanner, no injected command) against the real
> Logback fixture, repeatedly, through several real-but-transient network
> resets during large Maven-Central/registry downloads (each independently
> reproduced as transient — an identical manual rebuild succeeded moments
> later every time) — and twice reached a clean, real result:
> **`CANDIDATE_READY`, `logback-classic`/`logback-core` both `1.2.13`,
> `CVE-2023-6378` match count `0`, `TARGET_CVE_CLOSED = YES`.** No fixture
> scanner anywhere in this path. Real timing (n=2 clean completions, ~7–9
> min of real wall time each): `464,981ms` / `475,195ms` — dominated by the
> real Podman image build (~440s of it), confirming the prior phase's
> concern that WF6's 30-second timeout is roughly two orders of magnitude
> too small once these real phases are included. Also captured, for real:
> **two independent genuine `podman build` subprocess timeouts** (the
> enforced worker deadline correctly `SIGKILL`ing a real, in-flight build),
> both with zero leaked containers/images/workspaces afterward — the
> earlier Blocker B deadline work, now proven against real infrastructure,
> not fixtures. A dedicated real Trivy-specific timeout was attempted but
> not reliably isolated (real build-time variance made the ~2-second scan
> window hard to land precisely); the identical code path is already
> proven for real via the build-timeout case and extensively via fixture
> tests, disclosed rather than silently assumed. Validation container and
> network destroyed afterward; full regression re-run fresh, all suites,
> none skipped: 68/68 + 26/26 + 126/126 + 14/14 + both TSC + fresh Docker
> build + `git diff --check`, all PASS. Full detail in the
> `AUTHORIZED_CHROOT_BUILD_AND_COMPLETE_REAL_VALIDATION_PHASE` block of the
> JSON companion, including the exact full run log (successes and
> transient failures alike).
>
> **What this does and does not settle:** rootless Podman + real Trivy +
> real CVE closure are now genuinely proven possible in this environment
> under `CAP_SYS_ADMIN` (validation-only, never applied to production).
> Two decisions remain, deliberately not made here: whether `CAP_SYS_ADMIN`
> is acceptable for the actual production deployment, and the WF6 timeout
> reconciliation itself (real data now strongly supports it, per the
> instruction this phase did not act on it).
>
> **Update 3 (authorized `CAP_SYS_ADMIN` validation, same day).** User
> explicitly authorized `--cap-add SYS_ADMIN` for exactly one disposable
> validation container (default seccomp retained, dedicated network, no
> other privilege). Phase H (rootless preflight): **PASS** —
> `PODMAN_ROOTLESS=true`, vfs/crun, real graph/run roots. Phase I (minimal
> build + Trivy): the DEFAULT Podman build isolation still failed —
> `pivot_root: Operation not permitted` — because `pivot_root` is not in
> Docker's default seccomp allowlist AT ALL, under any capability
> (confirmed against moby's actual default.json); `CAP_SYS_ADMIN` cannot
> unlock a syscall the profile never conditionally permits. `podman build
> --isolation=chroot` (a real, documented Podman mode that skips the OCI-
> runtime/`pivot_root` path entirely) worked — harmless build **PASS**,
> real Trivy 0.72.0 DB bootstrap + scan **PASS**, valid JSON. Phase J (the
> real, UNMODIFIED default adapter, compiled `dist/` JS, no fixture
> scanner): grounding/scope-evidence/patch/guard/dependency-resolution all
> ran for real (86.6s), then failed at the identical `pivot_root` point —
> the production adapter's own `podman build` call doesn't pass
> `--isolation=chroot`. Fail-closed held correctly (`TECHNICAL_FAILURE`,
> zero leaked containers/images/workspaces). This is now a precise,
> narrow, two-option decision, **not applied without asking**: (a) add
> `--isolation=chroot` to that one `podman build` call in
> `security-artifact-validator.ts` (small, non-security-logic runtime
> change), or (b) authorize a custom seccomp addition for `pivot_root` on
> top of `CAP_SYS_ADMIN`. Validation container and network destroyed
> afterward, exactly as required. Full detail in the
> `AUTHORIZED_CAP_SYS_ADMIN_VALIDATION_PHASE` block of the JSON companion.
>
> **Update 2 (source-boundary fix + seccomp diagnosis phase, same day).**
> Extracted `isFullGitSha` out of `incidents.service.ts` (a full NestJS/
> TypeORM-coupled service) into `candidate-digest.ts` (already a pure,
> dependency-free, already-shared module) and re-pointed its 5 other
> consumers at the new location, with a re-export left in
> `incidents.service.ts` for backward compatibility. `npx tsc -p
> tsconfig.build.json --listFilesOnly` now shows candidate-verifier's
> REAL, complete compile closure: exactly 17 backend files, zero
> TypeORM/NestJS-entity files. `candidate-verifier/Dockerfile`'s `COPY` was
> narrowed from the whole `backend/src` tree back down to those exact 17
> files. A completely fresh `docker build` (no live-snapshot workaround)
> then succeeded end to end: `npm run build` passes, the image runs as
> `USER node` (uid 1000) with podman/newuidmap/newgidmap/Trivy 0.72.0 all
> present. `CANDIDATE_VERIFIER_TYPEORM_REQUIRED = NO`,
> `CANDIDATE_VERIFIER_DB_RUNTIME_REQUIRED = NO`.
>
> Rootless Podman was then re-diagnosed precisely, isolating the true
> cause: Docker's default seccomp profile already contains a conditional
> `SCMP_ACT_ALLOW` rule covering `clone`/`clone3`/`unshare`/`setns`/`mount`/
> etc., gated on `includes: {caps: ['CAP_SYS_ADMIN']}` — our container
> simply lacks that ONE capability. A disposable, `--rm`, `--network none`
> diagnostic confirmed `--cap-add SYS_ADMIN` ALONE (Docker's seccomp
> profile left completely UNMODIFIED, no custom profile needed at all) is
> both necessary and sufficient: `unshare --user --map-root-user` and
> `podman info --format Rootless` both succeed. A narrower, seccomp-only
> custom-profile attempt (permitting just `clone`/`unshare`/`setns`
> unconditionally, everything else untouched) got PAST the initial
> "cannot clone" error but then failed one step later
> (`newuidmap: write to uid_map failed: Operation not permitted`) without
> that capability — proving this is fundamentally a Linux **capability**
> gap, not (only) a seccomp syscall-policy gap, contrary to this task's
> original framing.
>
> `CAP_SYS_ADMIN` is a single, narrowly-named capability (not
> `cap_add: ALL`, not `privileged: true`, not `docker.sock`, not
> `seccomp=unconfined`) but it is also one of the broadest individual
> Linux capabilities that exists in practice (covers mount, several
> unrelated privileged namespace/IPC operations) and is commonly treated
> with nearly the same caution as full privileged mode in container-
> security guidance. Per this task's own established pattern (stop rather
> than self-authorize a broader-than-anticipated grant), this was proven
> and reported but **not applied** to any persistent container, and
> phases requiring it (a real Podman build, a real Trivy scan, the real
> Logback fixture, timing) were not attempted. `ROOTLESS_RUNTIME_PROVEN =
> NO`. `SOURCE_IMAGE_REPRODUCIBLE = YES` (this is new and now proven).
>
> Also this phase: the `n8n compatibility` suite, skipped as unreproducible
> in both prior phases, was actually gotten working — the missing `/tmp/
> wf6-*` fixture files were extracted read-only (`docker cp`, no execution,
> no API call, no activation) from the live `n8n` container's own
> installed n8n@2.14.2 / n8n-nodes-base@2.14.1 package (the version
> numbers differ between those two packages by design; matches what the
> test asserts). All 14 cases now PASS for real. Full detail in the
> `SOURCE_BOUNDARY_AND_SECCOMP_PHASE` block of the JSON companion.
>
> **Update (image-provisioning phase, later the same day).** A read-only
> audit traced Podman execution to inside `pfe-candidate-verifier` itself
> (in-process `execFileSync`, not a remote call) and found the deployed
> image provisioned neither Podman/uidmap/Trivy nor a non-root user.
> `candidate-verifier/Dockerfile` was then updated to add all four (podman,
> uidmap, Trivy 0.72.0 pinned+checksum-verified, `USER node` — the base
> image's own pre-existing uid-1000 user, whose subuid/subgid range was
> already registered). Building and running that image (via a read-only
> `docker commit` snapshot of the already-compiled live container, to work
> around a separate, pre-existing, out-of-scope TypeScript coupling bug —
> see below) proved `newuidmap`/`newgidmap` now work exactly as intended,
> but surfaced a **new, different, more fundamental blocker**: Docker's
> default seccomp profile on this host blocks `clone(CLONE_NEWUSER)` for an
> unprivileged container, so `podman info`/`unshare --user` themselves fail
> with `Operation not permitted` before Podman ever gets to consult
> subuid/newuidmap at all. Per instruction, this was **not** worked around
> (a `--security-opt seccomp=unconfined` diagnostic confirmed the cause but
> was never applied to anything persistent). `RUNTIME_INIT` stays `FAIL`,
> for a corrected, more specific reason than before. Full detail in the
> `BLOCKER_A_IMAGE_PROVISIONING_UPDATE` block of the JSON companion.

No routing, PR, GitHub, live n8n, deployment, commit or push action was
taken this phase, per the request. `git diff --check`: PASS. Backend
TypeScript: PASS. Candidate-verifier TypeScript: PASS. Backend tests:
**68/68 PASS**. Candidate-verifier tests: **26/26 PASS** (23 pre-existing +
3 new files this phase). WF6 offline functional suite: **126/126 PASS**
(unchanged from before this phase — no WF6 workflow JSON/timeout was
touched).

---

## BLOCKER A — rootless runtime

```
RUNTIME_INIT: FAIL
CANDIDATE_GENERATED: NO
TRIVY_EXECUTED_ON_REAL_CANDIDATE: NO
TRIVY_RESULT_PARSED: NO
CVE_POLICY_VERDICT: NOT_PROVEN
```

### What was re-diagnosed this phase

The prior phase's diagnosis (missing `newuidmap`/`newgidmap`) is confirmed
correct; this phase adds the evidence needed to rule out every OTHER
category the request asked to separate out, so the conclusion is not just
"still fails" but "fails for exactly this one reason, and no other."

**Environment/kernel/sandbox limitation — RULED OUT.** Unprivileged user
namespaces themselves work fine in this environment:

```
$ unshare --user --map-root-user echo hello
hello
$ echo $?
0
```

This is the single most important new data point: it proves the kernel
(`5.15.167.4-microsoft-standard-WSL2`) allows `CLONE_NEWUSER` for this user,
and that this session's own Bash sandbox does not block it either. So the
failure is not WSL2, not container/sandbox nesting, and not a kernel
`unprivileged_userns_clone` restriction (the sysctl doesn't even exist on
this kernel — `/proc/sys/kernel/unprivileged_userns_clone`: not present,
meaning it's not gated at all).

**Missing user namespace / subuid-subgid tooling — CONFIRMED, this is the
actual cause.** Subordinate ID ranges ARE configured for this user:

```
/etc/subuid: souhaiel:100000:65536
/etc/subgid: souhaiel:100000:65536
```

But the setuid helper binaries Podman's multi-ID rootless path requires to
apply that range (`newuidmap`/`newgidmap`, from Ubuntu's `uidmap` package)
are not installed and not on `$PATH`:

```
$ which newuidmap newgidmap
(nothing)
$ dpkg -l | grep uidmap
(nothing installed; candidate 1:4.8.1-2ubuntu2.2 available in apt)
```

Podman correctly detects this and refuses to fall back silently:

```
$ podman info ...
Error: command required for rootless mode with multiple IDs: exec: "newuidmap": executable file not found in $PATH
```

**Runtime binary/configuration — the ONE gap is this missing setuid
helper, nothing else.** Podman 3.4.4, conmon 2.0.25 and crun 0.17 (matching
Ubuntu 22.04 package versions) were extracted without a system install and
run correctly once given `PATH`/`XDG_CONFIG_HOME`/`XDG_RUNTIME_DIR`/
`LD_LIBRARY_PATH`: `podman --version` succeeds, `podman info` reaches its
real subuid lookup and produces the exact, expected, correctly-worded
error above — this is Podman functioning correctly and refusing unsafely
unconfigured rootless execution, not Podman itself being broken.

**Privilege escalation to fix it — unavailable in this session.** Installing
`uidmap` requires root (`apt`/`dpkg`). This account is in the `sudo` group,
but non-interactive `sudo` is not usable:

```
$ sudo -n true
sudo: a password is required
```

No root shell, no passwordless sudo, no alternative privileged install path
exists in this session. A single-mapping ("own UID only") rootless
fallback that avoids `newuidmap` entirely does not apply here either: that
path is only Podman's behavior when NO subuid range is registered for the
user, and one already is (`/etc/subuid` above) — using it would require
either removing that system-wide subuid entry or spoofing this user's NSS
identity, both of which are host-identity changes requiring the same
unavailable root access, and neither was done (would not be a "real"
mitigation, only a workaround around a still-broken guarantee).

**Application defect — RULED OUT.** `TrivyImageArtifactValidator` (the
default adapter) does exactly what it should: it runs a real preflight
check, gets a real nonzero exit from a real `podman info`, classifies it as
`RUNTIME_COMMAND_FAILED`, and the orchestrator maps that to
`TECHNICAL_FAILURE` with `candidateManifest: null` / `candidateIdentity:
null` — no fabricated success, no silent fallback to a weaker runtime. This
is the adapter's designed fail-closed contract working correctly.

### Reconfirmed acceptance probe (fresh, this phase)

`candidate-verifier/test-fixtures/run-security-v17-default-runtime.ts`
(unmodified this phase) run twice today, against the **default** adapter
(no injected/fake command, no Docker fallback, no retained scan):

| Run | status | reason | GROUNDING_MS | ARTIFACT_VALIDATION_MS | TOTAL_MS |
| --- | --- | --- | ---: | ---: | ---: |
| 1 | TECHNICAL_FAILURE | RUNTIME_COMMAND_FAILED:PODMAN_PREFLIGHT | 1805 | 1407 | 3253 |
| 2 | TECHNICAL_FAILURE | RUNTIME_COMMAND_FAILED:PODMAN_PREFLIGHT | 1998 | 1562 | 3604 |

Both runs: `LEAKED_WORKSPACE` check PASS (worktree list confirmed clean),
zero containers/images created (build was never reached), fails closed in
~3.2–3.6s. Trivy 0.72.0 was never reached (Podman preflight is checked
first by design) — its own preflight/version-pin was separately verified
working in isolation in the prior phase and is unchanged.

### STOP

Per the instruction: rootless Podman is not made to work by any means
available in this session, and no fake/substitute runtime was used in this
acceptance probe. The default adapter was exercised for real and failed
closed for real. `RUNTIME_INIT: FAIL` stands. Fixing this requires either
root access in the deployment environment to install `uidmap` (the correct
fix — the candidate-verifier container's own Dockerfile should provision
it), or removing the system subuid registration for this specific
account/environment (not recommended: that's removing an existing,
presumably-intentional system configuration, not fixing anything).

---

## BLOCKER B — enforceable deadline

Implemented in `candidate-verifier/src/worker-deadline.ts` and wired through
`SecurityRemediationOrchestratorService`, `TrivyImageArtifactValidator` and
`MavenBuildAdapter`. Forwarded end-to-end from
`CandidateVerificationService.evaluateSecurityRemediation()`'s own existing
`timeoutMs` (previously only used to bound the backend's own HTTP wait,
never reaching the worker) as the new `overallDeadlineMs` request field.

### Design (why this satisfies "not merely Promise.race the HTTP request")

The whole worker call graph (`orchestrate()`) is **synchronous** —
`execFileSync` blocks the event loop until the child exits or Node's own
`timeout` option kills it. There is no way for surrounding JS to preempt a
call already in flight; `Promise.race`/`AbortSignal` around the outer HTTP
request cannot touch it, which is exactly the gap the prior phase's audit
identified. The fix applied at every call site, not just the HTTP layer:

1. **Monotonic clock.** `WorkerDeadline` uses `process.hrtime.bigint()`,
   immune to wall-clock adjustment, created once at `orchestrate()`'s entry.
2. **Remaining budget propagated to every expensive operation.** Every
   `mvn`/`podman`/`trivy` call is now handed `min(its old fixed cap,
   remaining budget)` as its own subprocess timeout — grounding's
   `dependency:tree`, both scope-evidence baseline calls, every per-control
   experiment (loop, not just once), the post-patch `dependency:tree`, the
   candidate `clean package` build, and every stage inside
   `TrivyImageArtifactValidator.inspect()` (preflight/build/save/scan).
3. **Subprocess timeout + real process termination.** Every one of those
   calls already used (or now uses, `maven-build-adapter.ts`) `killSignal:
   'SIGKILL'` — a stuck child cannot outlive its window by ignoring a
   catchable signal.
4. **Cancellation propagation for a synchronous worker == refuse to start.**
   Before every expensive phase (base scan, each control experiment,
   post-patch tree, build, closure scan) the orchestrator checks
   `deadline.expired()` and returns/throws a deterministic result WITHOUT
   ever calling the subprocess, once remaining budget drops below
   `MIN_STAGE_BUDGET_MS` (1000ms). This is what "cancellation" means for a
   call graph that cannot be preempted mid-flight: stop starting new work,
   and shorten whatever IS started to the time actually left.
5. **No orphan process.** Proven with a REAL OS process (see
   `worker-deadline-real-termination.spec.ts` below) — Blocker A prevents
   proving this against real Podman/Trivy, so `sleep` stands in for the
   command via the same fault-injection seam, with the exact timeout/
   killSignal the adapter itself computed.
6. **Deterministic TIMEOUT result, fail-closed.** Every deadline-refusal
   path reuses the EXISTING `TECHNICAL_FAILURE` / `failureClass:
   'VERIFIER_TIMEOUT'` vocabulary (the same one `RUNTIME_OPERATION_TIMEOUT`
   already used) rather than inventing a second parallel taxonomy —
   `reason` carries `WORKER_DEADLINE_EXCEEDED:<STAGE>` for diagnosis.
   `candidateManifest`/`candidateIdentity` are always null on this path.
7. **Cleanup is exempt from the budget gate, on purpose.** Cleanup
   (`IMAGE_EXISTS`/`IMAGE_CLEANUP`/workspace removal) is teardown of
   something already started, not new candidate-evaluation work — gating
   it the same way would leave a real orphaned image/container behind,
   which is the exact outcome the deadline exists to prevent. It always
   runs, capped only by its own fixed `cleanupTimeoutMs` (30s). Cleanup
   FAILURE still fails closed exactly as before (a `finally`-block throw
   supersedes any pending return value, including a pending TIMEOUT
   result — existing JS semantics, now explicitly tested under a timeout,
   not just under `CANDIDATE_READY`).
8. **Remaining-budget exhaustion blocks the next expensive phase.** Tested
   explicitly: a slow post-patch `dependency:tree` call consumes the
   budget, and the build phase (`packageCandidate`) is never invoked at
   all — zero calls, not a call that then times out.
9. **A caller cannot request an unbounded worker.** `overallDeadlineMs` is
   clamped server-side to `MAX_WORKER_BUDGET_MS` (600,000ms); absent falls
   back to `DEFAULT_WORKER_BUDGET_MS` (360,000ms — the SAME figure the
   backend already used for its own HTTP wait, now finally the SAME number
   on both sides of that call instead of two disconnected figures).

### Instrumentation (total / generation / runtime / scanner / revalidation / cleanup)

`executionTimings` on every result now includes, alongside the pre-existing
per-stage keys (all preserved, unchanged, for backward compatibility):

| Key | What it aggregates |
| --- | --- |
| `TOTAL_WORKER_DURATION_MS` | whole `orchestrate()` call (pre-existing) |
| `GENERATION_DURATION_MS` | alias of `PATCH_GENERATION_DURATION_MS` (patch write + guard) |
| `RUNTIME_DURATION_MS` | `PODMAN_PREFLIGHT` + `IMAGE_BUILD` + `IMAGE_SAVE` |
| `SCANNER_DURATION_MS` | `TRIVY_PREFLIGHT` + `TRIVY_SCAN` |
| `CLEANUP_DURATION_MS` | `IMAGE_EXISTS`/`IMAGE_CLEANUP` + workspace cleanup |

`GROUNDING_DURATION_MS` and `MAVEN_RESOLUTION_DURATION_MS` (pre-existing)
remain the "before generation" and "Maven-graph proof" phases respectively.
**Revalidation is not an internal worker phase** — WF6 repeats whole
`orchestrate()` calls (grounding → generation → runtime → scanner, from
scratch, at the four backend nodes the prior audit already named). Each
repeat is now individually bounded by the same enforceable deadline; there
is no separate revalidation instrumentation to add inside one call.

### Regression tests (new this phase, all PASS)

| File | Proves |
| --- | --- |
| `candidate-verifier/src/worker-deadline.spec.ts` | the primitive itself: default/clamp/monotonic/expired/`budgetFor` never returns 0 (9 assertions) |
| `candidate-verifier/src/security-artifact-validator.spec.ts` (+3 scenarios) | budget-exhausted pre-stage refusal (zero calls), a real cap shrunk by budget, legacy no-budget call byte-identical to before |
| `candidate-verifier/src/worker-deadline-real-termination.spec.ts` | **real OS proof**: a real `sleep 61.417s` standing in for `podman build`, killed at ~3.0s against a 3000ms budget; `pgrep` confirms no surviving process afterward |
| `candidate-verifier/src/security-remediation-orchestrator.deadline.spec.ts` | all 5 required scenarios (below) + one generous-budget control case (must still reach `CANDIDATE_READY`) |

The 5 required regression scenarios, all against the real `WorkspaceManager`
+ a real git clone of the fixture repo (only Maven/scanner calls are
injected fakes, per the existing spec file's own established pattern):

1. **Slow generation is cancelled** — a decision-service fake that overruns
   a 150ms budget; zero Maven/scanner calls follow; result
   `TECHNICAL_FAILURE`/`VERIFIER_TIMEOUT`; no leaked workspace directory.
2. **Slow scanner is cancelled** — the base scan overruns a 1300ms budget;
   the closure scan (second `inspect()` call) is never attempted (call
   count stays at 1); no Maven call survives it either.
3. **Timeout leaves no candidate/process behind** — folded into 1, 2 and 5:
   `candidateManifest`/`candidateIdentity` are null on every timeout path,
   and the actual leaf worktree directory
   (`workspaces/<requestId>/<batchId>/attempt-<n>/step-1`) is confirmed
   absent after the call. The real-process side of "no process behind" is
   proven separately (real-termination spec, above), since Blocker A
   prevents proving it against actual Podman/Trivy.
4. **Cleanup failure remains fail-closed** — a `WorkspaceManager` whose
   `cleanupWorkspace` is a no-op, combined with a slow decision-service
   fake: `orchestrate()` still THROWS `RUNTIME_CLEANUP_FAILED:
   WORKSPACE_CLEANUP`, exactly as it already did on the `CANDIDATE_READY`
   path — now proven under a TIMEOUT outcome too.
5. **Remaining-budget exhaustion prevents starting another expensive
   phase** — the post-patch `dependency:tree` call is made deliberately
   slow (1300ms) against a 2000ms budget; it runs (proving earlier phases
   DID complete), but `packageCandidate` (the build) is called **zero**
   times — refused outright, not attempted-then-timed-out.

### Real measurements (this phase)

Blocker A means `podman build`/`trivy scan` cannot be measured for real in
this environment. What CAN be measured for real — and was, 7 times, using
the real `WorkspaceManager`, real git worktrees, the real
`SecurityFindingDecisionService`/`GroundedMavenProvenanceService`, and real
`mvn` (grounding's own dependency:tree, both scope-evidence baseline calls,
2 control experiments × 2 calls each, the post-patch dependency:tree, and a
real `mvn clean package -DskipTests` build) against the same exact-SHA
Logback fixture used throughout V1.7 — only the two `inspect()` calls were
substituted with the retained fixture report:

`candidate-verifier/test-fixtures/run-security-v17-phase-measurement.ts`,
7 runs, all `CANDIDATE_READY`:

| Phase | min | P50 | P95 | max |
| --- | ---: | ---: | ---: | ---: |
| GROUNDING_DURATION_MS | 1732 | 1797 | 1894 | 1894 |
| MAVEN_RESOLUTION_DURATION_MS | 11934 | 12757 | 13582 | 13582 |
| PATCH_GENERATION_DURATION_MS | 38 | 41 | 48 | 48 |
| BUILD_DURATION_MS | 3824 | 3985 | 5679 | 5679 |
| CLEANUP_DURATION_MS | 12 | 13 | 18 | 18 |
| **TOTAL_WORKER_DURATION_MS** | **17754** | **18622** | **21294** | **21294** |

**Number of full rescans:** WF6's create path performs 3 full backend
evaluations (unchanged from the prior audit — Evaluate, then two of the
three Revalidate-Before-Write nodes on that path); each is now
independently bounded by this same enforceable deadline.

**Deadline margin, worker level:** enormous and safe — P95 (21,294ms)
against the new default worker budget (360,000ms) leaves ~338,700ms of
margin; the worker itself cannot hang past its configured deadline.

**Deadline margin, WF6's CURRENT 30,000ms HTTP timeout — the important
finding:** the REAL, measured, Podman/Trivy-free portion of ONE evaluation
already consumes 71% of that budget at P95 (21,294 / 30,000ms), and 62% at
P50. This is with the historically most expensive phases (image build,
image scan — previously capped at 20 minutes EACH) still completely
unmeasured. This is strong circumstantial evidence that WF6's 30-second
timeout is likely too tight once Blocker A is resolved and those two
phases are added — but it is not proof, since neither phase has a real
number yet. Per the explicit instruction, **WF6's 30,000ms timeout is left
unchanged this phase.**

### Sync vs async — evidence-based, partial

**For every phase actually measurable in this environment (grounding
through a real package build): sync is safe.** It is now bounded (a
caller-clamped, monotonic, enforceable deadline — default 360s, hard
ceiling 600s), fails closed deterministically on overrun, terminates its
real subprocesses (SIGKILL, proven against a real process), leaks no
workspace, and its real measured P95 (21.3s) sits nowhere near even the new
worker-level budget.

**For the two phases Blocker A blocks (`podman build`, `trivy scan`): NOT
PROVEN either way.** The old fixed per-call caps for those (20 minutes
each) were never validated against real timings, and still aren't. The
90th-percentile margin against WF6's EXISTING 30s node timeout is already
thin from the Maven-only portion alone (see above), which is a real signal
against "sync is obviously fine end-to-end," but a signal is not a
measurement.

**Recommendation: keep sync. Do not implement async.** The worker-level
architecture the user asked to make safe now IS safe, evidenced, and
tested; nothing here demonstrates async is *required*. What IS recommended,
once Blocker A is resolved: re-run
`run-security-v17-phase-measurement.ts`'s same methodology against the
REAL default adapter end-to-end (removing the fixture-scan substitution),
get real `RUNTIME_DURATION_MS`/`SCANNER_DURATION_MS` numbers, and revisit
WF6's 30,000ms node timeouts against that real P95 — not before.

---

## Files changed this phase

New: `candidate-verifier/src/worker-deadline.ts`,
`candidate-verifier/src/worker-deadline.spec.ts`,
`candidate-verifier/src/worker-deadline-real-termination.spec.ts`,
`candidate-verifier/src/security-remediation-orchestrator.deadline.spec.ts`,
`candidate-verifier/test-fixtures/run-security-v17-phase-measurement.ts`.

Modified: `candidate-verifier/src/security-remediation-orchestrator.service.ts`
(deadline threading + phase-alias instrumentation),
`candidate-verifier/src/security-artifact-validator.ts` (`budgetMs` param,
cleanup exempted from the budget gate), `candidate-verifier/src/
maven-build-adapter.ts` (`timeoutMs` on `packageCandidate`/`effectivePom`,
`killSignal: 'SIGKILL'`), `candidate-verifier/src/security-artifact-
validator.spec.ts` (+3 scenarios), `backend/src/security-remediation/
security-remediation-orchestration.types.ts` (`overallDeadlineMs` field +
validation), `backend/src/candidate-verification/
candidate-verification.service.ts` (forwards its own `timeoutMs` as
`overallDeadlineMs`), `backend/src/candidate-verification/
candidate-verification.service.spec.ts` (updated body-forwarding
assertion).

No file under `n8n-workflows/*.json` (workflow definitions), no WF6 HTTP
node timeout, no PR, no GitHub write, no live n8n execution, no deployment,
no commit, no push.

PR36_MODIFIED = NO; PR36_MERGED = NO; WF6_LIVE_CHANGED = NO; WF6_EXECUTED =
NO; LIVE_GITHUB_WRITE = NO; ROUTING_CHANGED = NO; LIVE_DEPLOYMENT = NO;
COMMIT_PUSH = NO.

**READY_FOR_V1_7_PREDEPLOY_REVIEW = NO** — Blocker A: environmental
FAIL_CLOSED, unresolved, requires root access this session does not have.
Blocker B: implemented, tested (worker-level: PASS, including a real OS
termination proof) and measured for every reachable phase, but its own
completion is gated on Blocker A for the two phases that matter most for
the sync-vs-async question.

---

## Files changed — Update 5 (final predeploy implementation)

New: `backend/src/security-remediation/security-remediation-deadline-contract.ts`,
`backend/src/security-remediation/security-artifact-scan.ts`,
`builder-scanner/` (entire new project: `package.json`, `tsconfig.json`,
`tsconfig.build.json`, `Dockerfile`, `src/security-artifact-validator.ts`
(moved verbatim from candidate-verifier), `src/security-artifact-validator.spec.ts`
(moved), `src/security-artifact-validator-real-termination.spec.ts` (moved/
renamed), `src/trivy-readiness.ts`, `src/trivy-readiness.spec.ts`,
`src/server.ts`, `src/server.spec.ts`, `scripts/bootstrap-trivy-cache.sh`),
`candidate-verifier/src/remote-builder-artifact-validator.ts`,
`candidate-verifier/src/remote-builder-artifact-validator.spec.ts`.

Modified: `candidate-verifier/src/worker-deadline.ts` (imports the shared
`WORKER_DEADLINE_MS`/`MIN_STAGE_BUDGET_MS` contract; `DEFAULT_WORKER_BUDGET_MS`
and `MAX_WORKER_BUDGET_MS` collapsed to the same value),
`candidate-verifier/src/security-artifact-validator.ts` (thinned to the
`SecurityArtifactValidator` interface + re-exports; real implementation
moved out to `builder-scanner`),
`candidate-verifier/src/security-remediation-orchestrator.service.ts`
(default validator is now `RemoteBuilderArtifactValidator`),
`backend/src/candidate-verification/candidate-verification.service.ts` /
`.spec.ts` (use the shared `BACKEND_HTTP_TIMEOUT_MS`/`BACKEND_TRANSPORT_SLACK_MS`
instead of local literals), `candidate-verifier/Dockerfile` (adds the two
new shared backend files to its explicit COPY list),
`docker-compose.yml` (new `builder-scanner-net` network, new
`candidate_workspace_shared`/`trivy_scanner_cache` volumes, new
`builder-scanner` service — explicitly commented that `CAP_SYS_ADMIN` is
NOT granted here — and candidate-verifier joins the new network/volume),
`n8n-workflows/scripts/build-wf6-security-remediation.mjs` (parameterized
`http()` factory; 4 named nodes now request `620000`),
`n8n-workflows/scripts/wf6-security-remediation.spec.mjs` (new timeout
assertion), `n8n-workflows/scripts/wf6-n8n-compatibility.spec.mjs`
(necessary allowlist update for the same 4 nodes).

Deleted: `candidate-verifier/src/security-artifact-validator.spec.ts` and
`candidate-verifier/src/worker-deadline-real-termination.spec.ts` (both
moved to `builder-scanner/`, not duplicated).

`n8n-workflows/pending-live-update/wf6-security-remediation-maven.OFFLINE-DRAFT.json`
regenerated (still a pending, non-live draft) — this is the ONLY workflow
JSON touched, and only its 4 named nodes' `timeout` value changed.

PR36_MODIFIED = NO; PR36_MERGED = NO; WF6_LIVE_CHANGED = NO; WF6_EXECUTED =
NO; LIVE_GITHUB_WRITE = NO; ROUTING_CHANGED = NO; LIVE_DEPLOYMENT = NO;
COMMIT_PUSH = NO.

**READY_FOR_V1_7_PREDEPLOY_REVIEW = SUPERSEDED, see Update 5 above** — the
three blockers this phase set out to resolve are implemented and real-proven;
two decisions remain deliberately unmade: `builder-scanner`'s production
`CAP_SYS_ADMIN` placement, and the 600000ms deadline's thin
(~4%) real-world margin.

---

## Files changed — Update 6 (final security/deadline predeploy closure)

New: `builder-scanner/src/internal-auth.ts`, `builder-scanner/src/internal-auth.spec.ts`,
`builder-scanner/src/security-artifact-validator-orphan-sweep.spec.ts`,
`candidate-verifier/src/remote-builder-artifact-validator-budget.spec.ts`.

Modified: `builder-scanner/src/server.ts` (auth gate on `/internal/build-scan`,
before body parsing), `builder-scanner/src/security-artifact-validator.ts`
(orphan-process sweep), `builder-scanner/Dockerfile` (pre-create/chown
`SECURITY_TRIVY_CACHE_DIR`/`WORKSPACE_ROOT`/`REPO_CACHE_ROOT` to `node:node`
at build time), `candidate-verifier/src/remote-builder-artifact-validator.ts`
(auth header via curl `-K` config file; `effectiveBudgetMs()` extracted and
hardened), `candidate-verifier/src/remote-builder-artifact-validator.spec.ts`
/ `builder-scanner/src/server.spec.ts` (NO_AUTH/BAD_AUTH/VALID_AUTH cases),
`candidate-verifier/compose-config.spec.ts` (updated key-set/network-set
expectations for the two new env vars/networks; new cap_add/init/
network-membership assertions for both services),
`backend/src/security-remediation/security-remediation-deadline-contract.ts`
(`WORKER_DEADLINE_MS` 600000 → 900000, with the full real evidence in its
own comment), `candidate-verifier/src/worker-deadline.spec.ts` /
`backend/src/candidate-verification/candidate-verification.service.spec.ts`
(boundary assertions made relative to `WORKER_DEADLINE_MS` instead of a
second hardcoded literal, so they no longer need editing on the next
reconciliation), `docker-compose.yml` (`cap_add: [SYS_ADMIN]` and `init: true`
on `builder-scanner`; `BUILDER_INTERNAL_SECRET` env var on both services),
`n8n-workflows/scripts/build-wf6-security-remediation.mjs` (`WF6_SECURITY_
EVALUATION_TIMEOUT_MS` 620000 → 920000), `n8n-workflows/scripts/
wf6-security-remediation.spec.mjs` / `wf6-n8n-compatibility.spec.mjs`
(920000 assertions).

`n8n-workflows/pending-live-update/wf6-security-remediation-maven.OFFLINE-DRAFT.json`
regenerated — still the ONLY workflow JSON touched, only the 4 named
nodes' `timeout` value changed (920000).

PR36_MODIFIED = NO; PR36_MERGED = NO; WF6_LIVE_CHANGED = NO; WF6_EXECUTED =
NO; LIVE_GITHUB_WRITE = NO; ROUTING_CHANGED = NO; LIVE_DEPLOYMENT = NO;
COMMIT_PUSH = NO.

**READY_FOR_V1_7_PREDEPLOY_REVIEW = NO** — all three named closure
decisions are made and real-proven; the one honestly-disclosed residual
risk (the 900000ms ceiling's imperfect real-world success rate) is a
judgment call reserved for the user, not a technical gap left by this
phase.

---

## Update 7 (execution-2058 follow-up: bounded git operations, Maven
traceability, warm-up + offline grounding, later phase)

Execution 2058 (a real WF6 run, `souhaiel11/pfe-app-test`,
`7ae0f954f99628b69ce9b42f42c1e2acc8568d99`, CVE-2023-6378) reached
`GROUNDING_FAILED:DEPENDENCY_TREE_TIMEOUT` — git materialization
(`RepoCacheService.ensureRepo()`) succeeded cleanly for real (proof: the
bounded-git-operations fix landed earlier this same phase — `setsid`-based
process-group cleanup replacing the old unattributed PID-diff sweep, a real
per-operation timeout, shared-deadline budget propagation across all three
production `ensureRepo()` call sites), but the real `mvn dependency:tree`
call that follows it exceeded its ~297s share of the 300000ms grounding
budget. Root-caused with direct filesystem forensics (`.m2/repository`'s
own file timestamps — created 3s into the run, zero `.lastUpdated`
retry/failure markers, a real, uninterrupted, steady per-artifact download
cadence, killed mid-flight on an in-progress, unstalled transfer): the
Maven local repository is **not** a persistent volume, so every
candidate-verifier redeploy starts grounding's dependency resolution from a
completely cold cache. Real connectivity to Maven Central (DNS, HTTPS,
latency) was independently verified healthy, both at investigation time and
during the incident window itself — this was never a network-degradation
or repository-availability problem.

**Traceability fix (`maven-build-adapter.ts`).** `dependencyTree()`'s
timeout branch previously discarded whatever stdout/stderr
`execFileSync` had already captured before the SIGKILL, replacing it with
a fixed string — the exact reason this incident's cause had to be
reconstructed from `.m2`'s own timestamps instead of application evidence.
Now captures, bounded and redacted (same discipline as
`repo-cache.service.ts`'s own git-stderr redaction, now exported and
reused): the last N lines of stdout/stderr, the last artifact/repo
transfer line seen, and a retry-count lower bound — both as free text
(`evidenceTail`) and as a structured `timeoutEvidence` field.

**Warm-up + offline primitives, then wired (`maven-build-adapter.ts` /
`maven-dependency-warmup.ts`).** `dependencyTree(..., {offline:true})`
(`-o`), `dependencyGoOffline()` (`dependency:go-offline`, resolves
everything a TRUSTED pom already declares), `resolveArtifact()`
(`dependency:get -Dtransitive=false`, pre-warms one specific remediation
target GAV, verified for real: works with no pom.xml at all). A structured
`DEPENDENCY_NOT_IN_CACHE` failure (real Maven wording captured and
verified: `Cannot access … in offline mode and the artifact <GAV> has not
been downloaded from it before`) carries the exact missing GAV — fail-closed,
never a muted offline miss. Composed into `resolveDependencyTreeOffline()`
with an **active** guard, not just a documented contract: the offline
analysis call is not reachable in that function's own code unless every
warm-up step (baseline `go-offline` + each target `resolveArtifact`)
already reported `SUCCESS`. A warm-up failure is classified
`WARMUP_TIMEOUT` / `WARMUP_NETWORK_FAILURE` (a heuristic over well-known
Java/Maven network-transport wording, disclosed as such) / `WARMUP_FAILED`
— always infrastructure, never imputed to the candidate, and reported
*before* any offline analysis is attempted, so a cache warm-up never
finishing can never surface as a misleading "this dependency doesn't
exist". Single monotonic budget (`createWorkerDeadline`, the same
primitive `worker-deadline.ts` already used elsewhere in this codebase):
120000ms per warm-up stage, 60000ms for the offline analysis, 300000ms
total ceiling.

**Wired into the real grounding call site**
(`grounded-maven-provenance.service.ts`) — the exact `dependencyTree()`
call that timed out in execution 2058. `baselineWorkspacePath ===
analysisWorkspacePath` there deliberately: grounding has no separate
"candidate pom" yet (`writeSecurityPatch()` creates one LATER, in the
orchestrator, only after grounding succeeds and a target version is
selected) and never needs one — it only ever resolves what the baseline
pom already declares, which `go-offline` on that same worktree already
covers completely, so `targetGavs` is `[]` at this call site.
`GroundedMavenProvenanceFailureClass` gained the three new values plus
`DEPENDENCY_NOT_IN_CACHE`; `DEPENDENCY_TREE_FAILED`/`_TIMEOUT` are kept
only as a defensive fallback that offline mode should make unreachable in
practice. Verified real, not just unit-tested: the exact tight-budget
scenario that used to produce `DEPENDENCY_TREE_TIMEOUT` now — through the
warm-up+offline path, real git fetch, real `go-offline` against Maven
Central — produces `WARMUP_TIMEOUT` instead, stable across repeated runs.
The two other new classifications (`WARMUP_NETWORK_FAILURE`,
`DEPENDENCY_NOT_IN_CACHE`) were proven to reach `resolve()`'s own
`result.failureClass` intact via a fake-mvn-on-PATH harness (fast,
deterministic); the further, unchanged
`SecurityFindingDecisionService`/orchestrator chain already carries
`decision.reason` as a plain `GROUNDING_FAILED:${failureClass}` string
regardless of which class it is (verified by direct code read, the same
mechanism execution 2058 itself already demonstrated end-to-end for the
old classes) — no code in that chain had to change, and none did.

**⚠️ Known limitation, deliberately not addressed this phase — decided,
not overlooked.** The offline analysis runs with `mvn -o`, so it cannot
itself reach the network for anything beyond what warm-up already cached.
But this is an **application-level** guarantee only: `candidate-verifier`
carries **no container-level network isolation**.
`candidate-verification-net` and `builder-scanner-net` are both confirmed
`Internal: false` (real `docker network inspect`, re-verified at deploy
time) — full NAT egress, same as any other Docker bridge network. A
`--network=none` / read-only / `cap-drop ALL` sandbox around the analysis
step, as originally envisioned for this correctif, does **not** exist and
was explicitly decided as a **separate, later hardening step** rather than
being built as part of this wiring. Until then, the isolation this warm-up
architecture provides is behavioral (offline flag, cache discipline), not
a security boundary a compromised build tool could not cross by other
means. Do not represent this deployment as network-sandboxed in any future
audit of this area.

Full fresh regression, all green: repo-cache/repo-cache-deadline/
repo-cache-command-failure, maven-build-adapter (+no-orphan +
timeout-evidence + offline, new), maven-dependency-warmup (new),
grounded-maven-provenance (+warmup-classification, new),
security-remediation-orchestrator (+deadline +repo-budget),
candidate-verification-executor (+repo-budget), worker-deadline — all
PASS, stable across repeated runs where network-dependent. `tsc --noEmit`
clean for both candidate-verifier and backend. Deployed in two controlled
phases (traceability alone first, then the warm-up+offline wiring), each
with an explicit tagged rollback image, real `/health` readiness checks
(not just startup logs), and confirmation the compiled code was actually
present and reachable (or deliberately still dormant, phase one) in the
running container each time.

PR36_MODIFIED = NO; PR36_MERGED = NO; WF6_LIVE_CHANGED = NO; WF6_EXECUTED =
NO; LIVE_GITHUB_WRITE = NO; ROUTING_CHANGED = NO; COMMIT_PUSH = NO.
LIVE_DEPLOYMENT = YES (candidate-verifier only, twice, both verified,
rollback tagged both times) — WF6 itself was not invoked at any point in
this phase; only the underlying grounding code it depends on was changed
and deployed.

**READY_FOR_V1_7_PREDEPLOY_REVIEW = NO** — the git-timeout root cause from
execution 2057 and the Maven-timeout root cause from execution 2058 are
both real-proven and fixed at their actual deployed call sites. The
network-isolation gap disclosed above is the one remaining, explicitly
deferred item in this specific area.
