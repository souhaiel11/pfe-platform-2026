# R19.3E trusted WF2 source package

This package preserves the reviewed source material needed to reproduce and
audit R19.3E. It is not a publication or activation record.

## Workflow identity

- Production canonical workflow ID: `9adcV31eaIgJyMR0`
- Currently published version: `31df6eaa-1ff2-4deb-8cc2-a3be8ca38dd3`
- Final verified source artifact version: `06ca5ef6-da75-48db-bddf-6c9581633d30`
- Source artifact internal workflow ID: `e96d6ee1-0a6c-4779-9200-4e2dc87ef9f2`
- Source artifact SHA-256: `9e69246d0e89ea62398b6a0d94a94174afd889286897f9580f03f1bec1571511`

The `e96d6ee1-0a6c-4779-9200-4e2dc87ef9f2` workflow MUST NOT be activated.
Only the verified nodes, connections, and settings graph is intended to be
transferred into a draft of the canonical `9adcV31eaIgJyMR0` workflow using a
supported n8n staging mechanism. The source artifact's workflow identity must
not replace the canonical production identity.

R19.3E is not currently published. Remediation attempt 4 has not occurred.

## Selected files

- `backups/r19-3c-prebuild/wf2-trusted-f95634ef.json`: trusted R19.1 base.
- `backups/r19-3c-prebuild/wf2-current-active-31df6eaa.json`: single selected
  evidence snapshot of the currently published graph.
- `pending-live-update/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.R19_3C-TRUSTED-DRAFT.json`:
  final verified R19.3E source artifact.
- `scripts/harden-wf2-r19-3c.mjs`: deterministic source generator.
- `scripts/wf2-r19-3c.spec.mjs`: exact-artifact static acceptance test.
- `scripts/wf2-branch-context.sim.mjs`: offline R19.1 branch regression test.

The historical fanout test is intentionally excluded because it targets the
older active mirror and its pre-R19.3E node contract, not the final `06ca5ef6`
artifact.
