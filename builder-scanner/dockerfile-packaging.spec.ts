/** V1.7 bootstrap-packaging-fix phase — deterministic proof that the image
 * actually contains everything the out-of-band Trivy bootstrap step needs
 * to run inside it.
 *
 * Real defect this guards against: builder-scanner/Dockerfile copied
 * package.json/tsconfig/src into the image but never copied
 * builder-scanner/scripts/, so bootstrap-trivy-cache.sh's own documented
 * invocation (`docker compose run --rm builder-scanner sh
 * scripts/bootstrap-trivy-cache.sh`) had no scripts/ directory to run
 * against -- proven by building the real image and finding the file
 * genuinely absent, not by inspecting the host source tree.
 *
 * This is a source-text check, not a real image build -- deliberately,
 * matching this codebase's own established split (see containers-
 * conf.spec.ts's own header comment): a real `docker compose build` was
 * run once by hand this phase to prove the fix (file present, root-owned
 * 0644, readable by USER node, real script executed end-to-end against a
 * fake trivy shim with zero network contact) -- paying for that on every
 * regression run isn't worth it when the Dockerfile's own COPY line is a
 * stable, cheap, deterministic proxy for the same fact.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const dockerfile = fs.readFileSync(path.join(__dirname, 'Dockerfile'), 'utf8');

// 1. The scripts/ directory is actually copied into the image.
assert.match(dockerfile, /COPY builder-scanner\/scripts \.\/scripts/,
  'Dockerfile must COPY builder-scanner/scripts into the image -- without this, bootstrap-trivy-cache.sh does not exist inside the built image at all');

// 2. It lands under the declared WORKDIR, i.e. at the exact path the
// script's own documented invocation (`sh scripts/bootstrap-trivy-
// cache.sh`, run from WORKDIR) expects: /builder-scanner/scripts/...
assert.match(dockerfile, /WORKDIR \/builder-scanner/,
  'WORKDIR must stay /builder-scanner -- the scripts/ COPY destination and the documented invocation both assume this');
const workdirIndex = dockerfile.indexOf('WORKDIR /builder-scanner');
const scriptsCopyIndex = dockerfile.indexOf('COPY builder-scanner/scripts ./scripts');
assert.ok(workdirIndex > -1 && scriptsCopyIndex > -1 && workdirIndex < scriptsCopyIndex,
  'the scripts/ COPY must happen after WORKDIR /builder-scanner is set, so it lands at /builder-scanner/scripts, not somewhere else');

// 3. Not accidentally routed into ./src (scripts/ is `sh`, not compiled
// TypeScript -- it must stay its own top-level directory, never merged
// into the src COPY that tsc's build step consumes).
assert.doesNotMatch(dockerfile, /COPY builder-scanner\/scripts \.\/src/,
  'scripts/ must not be copied into ./src -- it is not part of the TypeScript build');

console.log('dockerfile-packaging: PASS (builder-scanner/scripts is copied into the image at /builder-scanner/scripts, after WORKDIR, separate from ./src -- real end-to-end proof recorded separately: file present, root:root 0644, readable by USER node, script executes against a fake trivy shim with zero network contact)');
