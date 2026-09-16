# WF2 target architecture: deterministic verification before semantic review

Fix H deliberately does not reorder WF2. The current delivery hardens generation and reviewer policy only.

Phase 1 of the bounded cross-file path deliberately runs `FULL_TEST` twice: once before the dedicated cross-file semantic review, then again through the historical byte-identical `Call Candidate Verification` immediately before the historical Write Guard. The repetition is intentional, not an oversight: it preserves a single proven Git authorization path and rebinds authorization to the exact final candidate digest.

The target architecture is:

```text
complete candidate manifest
  -> isolated, non-mutating compile/tests
  -> semantic review supplied with hash-bound deterministic evidence
  -> Write Guard and remote Git operations
```

The verifier must use the exact complete manifest and baseline SHA, return evidence bound to the candidate-set digest, and distinguish candidate failure from verifier infrastructure failure. A matching successful result may be reused after review only while the manifest digest and relevant environment identity remain unchanged.

Required sandbox controls: ephemeral checkout, no production credentials, no remote writes, no privileged user, network disabled after controlled dependency resolution, allowlisted build commands, bounded CPU/memory/processes/time/disk, and explicit handling of build plugins and annotation processors as untrusted code.

This remains a future structural change because moving verification ahead of review expands the unreviewed-code execution surface and requires a dedicated sandbox/security design. Fix H does not change nodes or connections and does not implement this architecture.
