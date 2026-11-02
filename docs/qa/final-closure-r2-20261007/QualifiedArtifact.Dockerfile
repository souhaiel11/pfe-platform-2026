FROM local/r2-builder-baseline:ebbf25b40eb9
COPY security-artifact-validator.js security-artifact-validator.js.map /builder-scanner/dist/builder-scanner/src/
COPY security-artifact-validator.ts /builder-scanner/src/
LABEL org.opencontainers.image.revision="9038f556d8e8e27eb31c1a31feeac5168e529908" security-remediation.fix="generic-docker-scratch"
