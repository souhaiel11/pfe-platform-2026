# Dedicated remediation E2E fixture

Test data only: intentionally vulnerable H2 2.1.212. This repository is exclusively for controlled remediation qualification. It does not run a server.

Build and test with `mvn -B clean package`. The package lifecycle copies runtime dependencies for the scanner Dockerfile. The baseline must remain available for reproduction; candidate changes are qualified in disposable local workspaces.
