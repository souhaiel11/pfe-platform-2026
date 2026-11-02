FROM local/practical-verifier-base:pinned
COPY --chown=node:node dist/ /candidate-verifier/dist/
COPY --chown=node:node src/ /candidate-verifier/src/
RUN mvn -B -ntp org.apache.maven.plugins:maven-dependency-plugin:3.3.0:get -Dartifact=org.owasp:dependency-check-maven:12.2.2 -Dtransitive=true
