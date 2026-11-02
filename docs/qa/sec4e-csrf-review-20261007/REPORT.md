# SEC4E_CSRF_HUMAN_REVIEW_EVIDENCE_REPORT

Proposed human decision: **FIX_REQUIRED**, because H2 console is enabled in the shared runtime configuration, not confined to development, and supports browser/URL-session SQL operations outside application JWT authentication. **FINAL_VERDICT = C — H2_CONSOLE_REQUIRES_REMEDIATION.** This is an evidence-based proposal to the human reviewer, not a final Sonar review decision. Nothing was implemented or marked reviewed/safe.

The protected application API independently demonstrated stateless, explicit Bearer authentication. Candidate-specific frontend storage evidence is unavailable, and actual deployment/proxy/browser behavior is not established. EVIDENCE_COMPLETE is therefore NO for all SAFE_AFTER_REVIEW prerequisites, although the H2 configuration/runtime evidence is sufficient to propose a correction. No remote-production exposure or automatic-cookie CSRF exploit is asserted.

```text
CANDIDATE_COMMIT = a216ed75f1cfb30a910aad3b9a6360a3cd81ab3d
HOTSPOT_ID = f4082292-6caa-4a0f-aa31-43921b71d7ab
RULE = java:S4502
FILE = src/main/java/com/pfe/devsecops/config/SecurityConfig.java
LINE = 30

CSRF_CONFIGURATION = Disabled by csrf(csrf -> csrf.disable())
SESSION_MANAGEMENT = SessionCreationPolicy.STATELESS for application security
AUTHENTICATION_MECHANISMS = Explicit JWT Bearer header, backed by registered users/BCrypt and AuthenticationManager
PUBLIC_ROUTES = /api/auth/**; /h2-console/**
PROTECTED_ROUTES = /api/** except public auth prefix; any other application request is authenticated by the authorization rules

JWT_IN_AUTHORIZATION_HEADER = YES (source and exact runtime)
JWT_SENT_VIA_COOKIE = NO in tested API transport; actual external client behavior UNKNOWN
AUTH_COOKIE_USED = NO for tested application API
JSESSIONID_USED_FOR_API_AUTH = NO
HTTP_BASIC_ENABLED = NO
FORM_LOGIN_ENABLED = NO
REMEMBER_ME_ENABLED = NO
CUSTOM_AUTHENTICATION_COOKIE_ENABLED = NO
CLIENT_CERTIFICATE_API_AUTH = NO in tested HTTP runtime (no X509 filter)

BROWSER_AUTO_SENT_CREDENTIAL_PRESENT = NO for protected application API in tested direct runtime
JWT_STORAGE = UNKNOWN for candidate-specific client
JWT_ATTACHMENT_MECHANISM = Explicit Authorization Bearer in diagnostic/test callers; actual external client UNKNOWN
CLIENT_STORAGE_EVIDENCE = INCOMPLETE
STATE_CHANGING_ROUTES_REQUIRE_BEARER = YES for all four declared protected API write routes; NOT for H2 console SQL routes

LOGIN_PATH = POST /api/auth/login
REGISTRATION_PATH = POST /api/auth/register
JWT_RETURN_METHOD = JSON response body, token property
COOKIE_CREATED = NO for login/registration/application API diagnostics
SESSION_CREATED = No authenticated API session established; H2 separately creates its own URL-keyed WebSession
LOGIN_CREATES_SESSION = NO authenticated servlet/API session established
LOGIN_SET_COOKIE = NONE
AUTH_REQUEST_SET_COOKIE = NONE (read and writes)
JSESSIONID_OBSERVED = NO uppercase servlet JSESSIONID cookie; YES lowercase jsessionid URL parameter in H2 console

H2_CONSOLE_ENABLED = YES
H2_CONSOLE_PATH = /h2-console
H2_CONSOLE_PERMITTED_BY_SECURITY = YES, permitAll()
H2_CONSOLE_AVAILABLE_IN_PRODUCTION_PROFILE = YES in disposable local prod-profile probe; no profile guard in committed configuration
H2_CONSOLE_AVAILABLE_IN_TEST_DEV_ONLY = NO
H2_CONSOLE_USES_BROWSER_SESSION_OR_COOKIE = YES, H2 WebSession referenced by URL jsessionid; no cookie/servlet HttpSession observed
H2_CONSOLE_STATE_CHANGING_OPERATIONS_POSSIBLE = YES (diagnostic-only SQL table creation/insertion proved)
H2_REMOTE_ACCESS_ALLOWED = NO in these direct Docker-bridge probes (webAllowOthers restriction returned)
H2_CONSOLE_SECURITY_IMPACT = Non-development-only SQL console and separate URL-session path outside JWT; loopback SQL accepts known session plus attacker Origin without CSRF token

CROSS_SITE_AUTHENTICATED_REQUEST_POSSIBLE = NO automatic victim authentication demonstrated for protected API; H2 known-URL-session cross-origin SQL accepted on loopback, subject to session/reachability assumptions
CORS_ALLOW_CREDENTIALS = NOT SET in source; no Access-Control-Allow-Credentials returned (effective no credential permission)

ANONYMOUS_STATE_CHANGE_REJECTED = YES (403 for all four API write routes)
COOKIE_ONLY_STATE_CHANGE_REJECTED = YES (403 for all four API write routes)
BEARER_LESS_PROTECTED_REQUEST_REJECTED = YES
INVALID_JWT_REJECTED = YES
VALID_BEARER_REQUEST_ACCEPTED = YES (read200, create200, update200, workflow200, delete204 on disposable task)

ZAP_PROVES_CSRF_SAFE = NO
CURRENT_ZAP_RESULT = 0 alerts under unauthenticated profile only
EVIDENCE_COMPLETE = NO (candidate client storage and real deployment/proxy behavior unavailable; decisive H2 evidence obtained)
PROPOSED_HUMAN_DECISION = FIX_REQUIRED
FIX_REQUIRED_DESCRIPTION = Disable H2 console by default in application.properties; optionally opt in only under explicit dev profile with remote access disabled
FIX_IMPLEMENTED = NO
SOURCE_CHANGED = NO
NEW_TESTS_COMMITTED = NO
NEW_LOCAL_COMMIT_CREATED = NO

SONAR_HOTSPOT_STATUS_CHANGED = NO (TO_REVIEW unchanged)
SONAR_QUALITY_GATE_CHANGED = NO (ERROR; new_security_hotspots_reviewed0% <100%)
GITHUB_PUSH = NO
PR_CREATED = NO
JENKINS_REMOTE_BUILD = NO
ACR_PUSH = NO
AZURE_CHANGED = NO
FINAL_VERDICT = C — H2_CONSOLE_REQUIRES_REMEDIATION
```

## Exact source and runtime identity

All inspected source is from commit `a216ed75f1cfb30a910aad3b9a6360a3cd81ab3d`, tree `58c443b3e59f9e0f9e8ba431efd6df810c48107f`, clean `/tmp/sec4d-fix`. Numbered source copies are retained beside this report. The runtime image is `sha256:d063a4c52b8478b42efc09f730d072fb33cb61b5cbb2bc256c21fd05305c0e76`; embedded jar SHA256 `8abf6a5dec4359f5523335897844a52facc126605ee7fc62f4aea3625ee0c3ab`, independently verified in both containers against the qualified clean-build jar. The application binary was not rebuilt or changed.

Two disposable local instances were tested: default-profile `sec4e-app` and `sec4e-prod-probe` with only `SPRING_PROFILES_ACTIVE=prod` added. The latter is a local production-profile probe, not a production deployment. Existing image has no console-disabling environment flag or active profile. Only application.properties is packaged; no application-prod/production/dev resource exists. The committed Kubernetes manifest has no profile/console-disable overrides; its presence is not proof it is currently deployed.

Relevant exact SecurityConfig lines:

```java
// 27
public SecurityFilterChain filterChain(HttpSecurity http, JwtRequestFilter jwtRequestFilter) throws Exception {
    http
        .cors(cors -> {})                                     // 29
        .csrf(csrf -> csrf.disable())                         // 30
        .authorizeHttpRequests(auth -> auth                   // 31
            .requestMatchers("/api/auth/**").permitAll()       // 32
            .requestMatchers("/h2-console/**").permitAll()     // 33
            .requestMatchers("/api/**").authenticated()       // 34
            .anyRequest().authenticated())                   // 35
        .sessionManagement(session -> session                // 36
            .sessionCreationPolicy(SessionCreationPolicy.STATELESS)) // 37
        .addFilterBefore(jwtRequestFilter, UsernamePasswordAuthenticationFilter.class); // 38
    http.headers(headers -> headers.frameOptions(frame -> frame.disable())); // 41
    return http.build();                                     // 43
}
```

Exact runtime security filters, identical in default/prod probes:

```text
DisableEncodeUrlFilter
WebAsyncManagerIntegrationFilter
SecurityContextHolderFilter
HeaderWriterFilter
CorsFilter
LogoutFilter
JwtRequestFilter
RequestCacheAwareFilter
SecurityContextHolderAwareRequestFilter
AnonymousAuthenticationFilter
SessionManagementFilter
ExceptionTranslationFilter
AuthorizationFilter
```

No BasicAuthenticationFilter, UsernamePasswordAuthenticationFilter, RememberMeAuthenticationFilter or X509AuthenticationFilter is present. The reference to UsernamePasswordAuthenticationFilter.class at source line38 specifies JWT filter ordering; it does not enable a form-login filter. LogoutFilter is present as a framework filter; no persistent API authentication session was established by the tested routes. The declared business state-changing route inventory below covers controller routes, not every internal H2/framework handler.

## Credential transport and session evidence

Exact JwtRequestFilter lines36–44 read `request.getHeader("Authorization")`, require `.startsWith("Bearer ")`, take `.substring(7)` and parse the JWT username. Lines50–56 load the user, validate the JWT, and install a UsernamePasswordAuthenticationToken into the current request's SecurityContext. This token class is the internal authentication representation; it is not evidence that HTTP Basic or form login is enabled. No production source references cookies, HttpSession, request.getSession(), rememberMe, httpBasic, formLogin or X509 configuration. The live filter chain and credential-negative tests agree with this source.

AuthController lines20–27 define login; lines31–35 define registration. AuthService lines34–35 check submitted username/password, line41 creates JWT, and line45 returns LoginResponse. LoginResponse line9 is the JSON `token` property; it has no cookie transport. Registration returns a user response with the password field masked. Successful login/registration and subsequent authenticated read/write responses produced no Set-Cookie header. A valid Bearer read did not authenticate the next tokenless request, which returned403. Exact statuses and relevant response headers for33 diagnostic requests are in `api-runtime-diagnostics.json`. No credentials or JWT values were saved there.

The four declared protected state-changing routes:

| Method | Path | Authentication | Credential mechanism | Source declaration |
|---|---|---|---|---|
| POST | /api/tasks | required | explicit Authorization Bearer JWT | TaskController.java34–36 |
| PUT | /api/tasks/{id} | required | explicit Authorization Bearer JWT | TaskController.java39–41 |
| DELETE | /api/tasks/{id} | required | explicit Authorization Bearer JWT | TaskController.java44–47 |
| POST | /api/tasks/{id}/process | required | explicit Authorization Bearer JWT | TaskController.java57–65 |

No declared PATCH business endpoint exists. Public state-changing login/registration routes accept body credentials or create an account; they do not create browser-managed authenticated API state. H2 login/query handlers are separate public-prefix servlet routes and do not require application Bearer authentication.

For every API write route, anonymous requests, cookie-only requests carrying a valid JWT, invalid Bearer JWT and valid Basic credentials returned403. Cookies tested included Authorization, jwt, token, auth_token, JSESSIONID and remember-me with no Bearer header. A cross-origin simple form POST carrying browser-style cookies also returned403. Valid Bearer requests created, updated, processed and deleted only the diagnostic task with expected200/204 responses. This proves credential handling in the direct tested server; it does not prove external proxy translation rules.

## Client storage evidence

The exact committed candidate has no frontend JS/TS/HTML application or client JWT storage implementation. Its tracked-file inventory is retained. Candidate tests and temporary diagnostics explicitly supply Authorization Bearer; that demonstrates caller/test transport, not actual frontend storage.

The platform Angular UI separately uses localStorage and a Bearer interceptor, but it is not this candidate's client: its login payload uses email and its own backend auth contract, whereas this candidate uses username and LoginResponse with username/role. It must not be attributed to the candidate. Thus JWT_STORAGE and actual candidate-client attachment behavior remain UNKNOWN, CLIENT_STORAGE_EVIDENCE=INCOMPLETE. Whether an external client stores a JWT in a cookie is not inferred from the absence of server cookie authentication.

## Mandatory H2 console review

Exact shared application.properties:

```properties
# 4
spring.datasource.url=jdbc:h2:mem:testdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE
# 5
spring.datasource.driverClassName=org.h2.Driver
# 6
spring.datasource.username=sa
# 7
spring.datasource.password=
# 9
spring.h2.console.enabled=true
# 10
spring.h2.console.path=/h2-console
# 13
spring.jpa.hibernate.ddl-auto=create-drop
```

No development profile guard is present. SecurityConfig line33 permits /h2-console/** and line41 disables frame-options headers globally. The packaged H2 version is2.3.232. Spring Boot3.5.15's compiled H2 settings default webAllowOthers tofalse, verified from bytecode and direct runtime behavior.

Observed boundaries:

- HTTP requests through the local host/Docker-bridge mapping to both instances received an HTTP200 **denial page** saying remote connections/webAllowOthers are disabled. HTTP200 here does not mean the SQL console was accessible. This mitigates direct remote reachability and is retained explicitly.
- Requests from loopback inside each exact candidate served the console entry/login form and created an H2 WebSession. The session identifier appeared as lowercase `?jsessionid=...` in generated URLs/forms; no Set-Cookie header appeared.
- Compiled JakartaWebServlet reads the `jsessionid` parameter and calls H2 WebServer.getSession(), returning H2 WebSession. It does not use a servlet JSESSIONID cookie or HttpServletRequest.getSession() in the inspected implementation. H2's URL-session identifier is distinct from authenticated application API state.
- H2 console login to the disposable application database with its configured account succeeded in both default/prod instances, without an application JWT.
- POST query.do with a known H2 URL-session ID, attacker Origin/Referer and no CSRF token successfully created and inserted a marker into **SEC4E_REVIEW_PROBE only**. A follow-up SELECT confirmed the marker table. No business records were altered through SQL. All probe data vanished when the in-memory local runtimes stopped.

These diagnostics prove a browser/URL-session administrative SQL path remains available in the production-profile configuration and does not enforce a CSRF token/Origin check for the demonstrated known-session loopback request. They do **not** prove that a remote attacker can automatically obtain/send a victim's console session identifier, bypass webAllowOthers, or access a real production deployment. Actual proxy behavior and browser private-network controls were not simulated. The intended production application does not need this development SQL console according to the available configuration/documentation; no production necessity/justification is supplied.

[Spring Boot's H2-console guidance](https://docs.spring.io/spring-boot/3.5/reference/data/sql.html) identifies it as development-only and explicitly cautions against enabling it in production; it also explains that the console lacks CSRF protection. This corroborates the proposed development-only restriction, without treating a URL-session diagnostic as proof of cookie-based CSRF.

## Cross-site threat model

For the direct application API, an attacker-controlled origin cannot cause the browser to attach this application's valid JWT automatically: there is no server-issued authentication/session cookie, no Basic/form/remember-me mechanism, and no client-certificate authentication in the HTTP runtime. The JWT filter ignores cookie values, and the request must explicitly carry a valid Authorization Bearer header. Tokenless/cookie-only state changes returned403. A browser script explicitly supplying a stolen/known JWT would be a separate explicit-credential attack; no JWT theft or client-storage safety claim is made here.

H2 is separate: SQL authorization resides in a URL-keyed console WebSession and its database connection. Cross-origin POST was accepted when the diagnostic caller already knew that session ID and had loopback reachability. A browser does not automatically append an unknown H2 session ID to arbitrary attacker URLs as it would an authentication cookie. Therefore no automatic-victim-credential CSRF exploit is established. Nonetheless, retaining an unnecessary development console in default/prod runtime prevents recommending SAFE_AFTER_REVIEW under the required H2 prerequisite, without explicit security justification and deployment/client evidence.

The real deployment/client/proxy contract remains a human verification boundary. No claim is made that a proxy could not convert cookies or otherwise introduce ambient credentials. [Spring Security's CSRF guidance](https://docs.spring.io/spring-security/reference/features/exploits/csrf.html) distinguishes statelessness from the presence of automatically submitted browser credentials.

## CORS context and ZAP limitation

SecurityConfig lines51–55 configure allowedOrigins["*"], allowedMethods[GET,POST,PUT,DELETE,OPTIONS,PATCH], allowedHeaders["*"], exposedHeaders[Authorization,Content-Type]. setAllowCredentials is absent: source value is unset/null, not an explicit true setting. Runtime cross-origin preflight returned Access-Control-Allow-Origin:* and no Access-Control-Allow-Credentials header. The browser-style simple write still failed403 without a Bearer header.

CORS is not a replacement for CSRF protection. It does not prevent all cross-origin submissions, nor make H2 console safe. Its successful preflight here does not establish authenticated automatic-credential access.

**Current ZAP result = 0 alerts under unauthenticated profile only. ZAP_PROVES_CSRF_SAFE = NO.** No ZAP result is used to justify a SAFE decision. This phase did not rerun or alter scanner policy.

## Two possible human outcomes

SAFE_AFTER_REVIEW can become a legitimate human decision only if the reviewer verifies the complete actual client/deployment credential contract, retains explicit stateless Bearer-only protection for all application writes, verifies no authenticated JSESSIONID/cookie/Basic/form mechanism is introduced, and eliminates or explicitly justifies the H2 production browser-session path. The current candidate does not meet that complete evidence bar: H2 remains enabled in default/prod and candidate frontend evidence is missing. SAFE is not proposed for this tree.

FIX_REQUIRED is the proposed outcome for this tree under the requested H2 criteria. The smallest proposed correction is one durable default setting:

| Proposed file/settings | Change | Purpose |
|---|---|---|
| src/main/resources/application.properties:9 | spring.h2.console.enabled=false | Disable console by default, including prod |
| Optional src/main/resources/application-dev.properties | spring.h2.console.enabled=true and spring.h2.console.settings.web-allow-others=false | Explicit local development-only opt-in, if needed |

A deployment override SPRING_H2_CONSOLE_ENABLED=false can disable the console but is not evidence that the current shared source is development-only. Default source restriction is preferred for the proposed follow-up. The human must approve scope before implementation; subsequently verify production/default console unavailable, desired dev behavior, unchanged Bearer API, and controlled regressions. Removing the public console matcher or changing frame headers may be considered separately if necessary; those are not included in the minimal setting proposal. Globally enabling CSRF for the Bearer API is not proposed without distinguishing browser/session routes.

No change was applied. No conclusion here marks the Sonar hotspot SAFE, FIXED, ACKNOWLEDGED or reviewed. The human retains the final decision.

## Read/test-only audit and stop

Hotspot-before/after JSON records are identical, including status TO_REVIEW; gate-before/after records are identical. No Sonar analysis or review/mutation endpoint was called. No source/test changes, commits, push, PR, remote Jenkins build, ACR push or Azure action occurred. Temporary HTTP probes live outside the application source and are retained only as diagnostic evidence; they were not committed. Candidate worktree remains clean at a216ed75.

Both disposable local containers were stopped; their H2 data was in-memory only. Temporary credential copies used solely for authenticated read-only Sonar calls were deleted. The primary platform status remains unchanged except this evidence directory; protected workstreams were preserved. Final review remains with the human.

STOP.
