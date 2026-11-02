FROM local/pfe-depfix-autoclassify:20261022
COPY security-remediation-lifecycle.js /app/dist/manual-remediation/security-remediation-lifecycle.js
COPY remediation-target-reservation.js /app/dist/manual-remediation/remediation-target-reservation.js
COPY audit-remediation-exports.cjs /tmp/audit-remediation-exports.cjs
RUN node /tmp/audit-remediation-exports.cjs
COPY verify-dispatch.cjs /tmp/verify-security-dispatch.cjs
RUN node /tmp/verify-security-dispatch.cjs
LABEL platform.security-dispatch-fix="20261023"
