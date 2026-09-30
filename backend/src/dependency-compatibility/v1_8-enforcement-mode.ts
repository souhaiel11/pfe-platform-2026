// V1.8 Phase 5 ticket — Phase 9: controlled enforcement switch. Mirrors
// this codebase's own existing convention for a simple env-driven flag
// (e.g. RemoteBuilderArtifactValidator's `process.env.BUILDER_SCANNER_URL`,
// HttpWf6BatchDispatcher's `process.env.N8N_URL` -- a plain env var read
// directly, no config framework) rather than inventing a new feature-flag
// system.
//
// Two modes only, exactly as the ticket specifies:
//   SHADOW   (default, safe) -- current WF6 behavior unchanged; V1.8's
//            gate can be computed and compared/logged, but NEVER blocks or
//            alters a real dispatch.
//   ENFORCED -- canDispatchSecurityRemediationV1_8() becomes authoritative:
//            a BLOCK from it prevents dispatch even when the OLD classifier
//            said AUTO_FIX_ELIGIBLE (Phase 5's "no fallback to old
//            auto-fix" rule).
//
// Default is SHADOW so every existing test and every environment that has
// never set this variable keeps behaving exactly as it does today.
export type V1_8EnforcementMode = 'SHADOW' | 'ENFORCED';

export function v1_8EnforcementMode(): V1_8EnforcementMode {
  return process.env.V1_8_SECURITY_ENFORCEMENT === 'ENFORCED' ? 'ENFORCED' : 'SHADOW';
}
