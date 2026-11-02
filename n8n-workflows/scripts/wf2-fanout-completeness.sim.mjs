// Vérifie WF2 fanout completeness sim dans les workflows n8n.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const WF_PATH = new URL('../active/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.json', import.meta.url);
const raw = JSON.parse(readFileSync(WF_PATH, 'utf8'));
const workflow = Array.isArray(raw) ? raw[0] : raw;
assert.equal(workflow.id, '9adcV31eaIgJyMR0', 'wrong workflow file');

const nodeMap = new Map(workflow.nodes.map(n => [n.name, n]));
/** Retrouve ou construit le nœud du workflow demandé. */
const node = name => {
  const n = nodeMap.get(name);
  assert.ok(n, `missing node: ${name}`);
  return n;
};
/** Retrouve les cibles principales du workflow. */
const mainTargets = (name, output = 0) =>
  (workflow.connections[name]?.main?.[output] || []).map(e => e.node);

// ─────────────────────────────────────────────────────────────────────────────
// Canonical batch context
// ─────────────────────────────────────────────────────────────────────────────
const B = {
  incidentId: 'd1f5e9ce-f039-475d-9a50-41f217e6444b',
  projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002',
  buildNumber: 136,
  requestId: '9b62e087-02a8-409d-bfb1-a951629a8814',
  batchId: '6396353230fd100bf80c3417271c70cb7808273ebd6500571a46c2a4505af431',
  attemptCount: 3,
  repository_owner: 'souhaiel11',
  repository_name: 'pfe-app-test',
  githubRepo: 'souhaiel11/pfe-app-test',
  default_branch: 'main',
};
B.batchKey = B.batchId;
const TASK_FILE = 'src/main/java/com/pfe/devsecops/service/TaskService.java';
const SEC_FILE = 'src/main/java/com/pfe/devsecops/config/SecurityConfig.java';
const TASK_FINDING = '39c99e32-2737-419c-b85d-f521ce541f41';
const SEC_FINDING = 'b8305253-8e0c-4fb6-88a8-2eadb6d48a45';

const findings = [
  { findingId: TASK_FINDING, id: TASK_FINDING, key: TASK_FINDING, rule: 'java:S1068', ruleKey: 'java:S1068',
    severity: 'MAJOR', type: 'CODE_SMELL', source: 'SONARQUBE', stage: 'sonar',
    file: TASK_FILE, component: TASK_FILE, line: 14,
    message: 'Remove this unused "userRepository" private field.', remediationType: 'AUTO_FIX_ELIGIBLE' },
  { findingId: SEC_FINDING, id: SEC_FINDING, key: SEC_FINDING, rule: 'java:S125', ruleKey: 'java:S125',
    severity: 'MAJOR', type: 'CODE_SMELL', source: 'SONARQUBE', stage: 'sonar',
    file: SEC_FILE, component: SEC_FILE, line: 22,
    message: 'This block of commented-out lines of code should be removed.', remediationType: 'AUTO_FIX_ELIGIBLE' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Source fixtures (representative of the real repo files)
// ─────────────────────────────────────────────────────────────────────────────
const TASK_SRC_BEFORE = `package com.pfe.devsecops.service;

import com.pfe.devsecops.model.Task;
import com.pfe.devsecops.repository.TaskRepository;
import com.pfe.devsecops.repository.UserRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class TaskService {

    private final TaskRepository taskRepository;
    private final UserRepository userRepository;

    public TaskService(TaskRepository taskRepository, UserRepository userRepository) {
        this.taskRepository = taskRepository;
        this.userRepository = userRepository;
    }

    public List<Task> findAll() {
        return taskRepository.findAll();
    }

    public Task save(Task task) {
        return taskRepository.save(task);
    }
}
`;
/** Prépare le résultat lié à strip S1068. */
const stripS1068 = (src, identifier = 'userRepository') => {
  const typeName = identifier.charAt(0).toUpperCase() + identifier.slice(1);
  return String(src)
    .replace(new RegExp('^\\s*import\\s+[^;]*\\.' + typeName + '\\s*;\\s*', 'gm'), '')
    .replace(new RegExp('^.*\\bprivate\\b.*\\b' + identifier + '\\b.*;\\s*$', 'gm'), '')
    .replace(new RegExp('^.*\\bthis\\.' + identifier + '\\s*=\\s*' + identifier + '\\s*;\\s*$', 'gm'), '')
    .replace(new RegExp('\\b[A-Za-z0-9_$.<>?]+\\s+' + identifier + '\\b\\s*,?', 'g'), '')
    .replace(/\(\s*,/g, '(').replace(/,\s*\)/g, ')').replace(/,\s*,/g, ',');
};
const TASK_SRC_FIXED = stripS1068(TASK_SRC_BEFORE);

const SEC_SRC_BEFORE = `package com.pfe.devsecops.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**").permitAll()
                .anyRequest().authenticated())
            .httpBasic(basic -> {});
        // http.sessionManagement(session -> session.maximumSessions(1));
        // http.formLogin(form -> form.loginPage("/login").permitAll());
        // http.logout(logout -> logout.logoutUrl("/logout"));
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
`;
// Correct S125 remediation: only the commented-out block removed, executable logic identical.
const SEC_SRC_FIXED = `package com.pfe.devsecops.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**").permitAll()
                .anyRequest().authenticated())
            .httpBasic(basic -> {});
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
`;

/** Encode le contenu en Base64. */
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const REPO_FILES = {
  [TASK_FILE]: { name: 'TaskService.java', path: TASK_FILE, sha: 'abff80f1f51e65b358e212f9edbeb5536f72c5a4',
    content: b64(TASK_SRC_BEFORE), encoding: 'base64' },
  [SEC_FILE]: { name: 'SecurityConfig.java', path: SEC_FILE, sha: '08295afb4d1459ff02b22ce9291fb418649822c2',
    content: b64(SEC_SRC_BEFORE), encoding: 'base64' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Minimal n8n Code-node runtime
// ─────────────────────────────────────────────────────────────────────────────
let externalWrites = { branchCreate: 0, prCreate: 0, fileEdit: 0, backendPost: [] };

/** Prépare Accessor. */
function makeAccessor(store) {
  // store: { NodeName: [ {json}, ... ] }  (output items of that node)
  return (name) => {
    const items = store[name] || [];
    return {
      /** Renvoie le premier élément disponible. */
      first: () => items[0],
      /** Renvoie le dernier élément disponible. */
      last: () => items[items.length - 1],
      /** Renvoie tous les éléments disponibles. */
      all: () => items,
      item: undefined, // set per-item by runEach
    };
  };
}

/** Exécute ensemble. */
function runAll(nodeName, store, inputItems) {
  const n = node(nodeName);
  const code = n.parameters.jsCode;
  const $ = makeAccessor(store);
  const $input = {
    /** Renvoie tous les éléments disponibles. */
    all: () => inputItems,
    /** Renvoie le premier élément disponible. */
    first: () => inputItems[0],
    /** Renvoie le dernier élément disponible. */
    last: () => inputItems[inputItems.length - 1],
  };
  /** Simule la lecture des éléments d’un nœud n8n. */
  const $items = (name, _o, _i) => (store[name] || []);
  const $execution = { id: '1889' };
  const $env = { N8N_INTERNAL_SECRET: 'stub', N8N_WF2_ID: '9adcV31eaIgJyMR0' };
  const $json = inputItems[0]?.json;
  const fn = new Function('$', '$input', '$items', '$execution', '$env', '$json', '$now', '$today',
    `${code}`);
  const out = fn($, $input, $items, $execution, $env, $json, Date.now(), Date.now());
  const arr = Array.isArray(out) ? out : [out];
  return arr.map(x => (x && x.json !== undefined ? x : { json: x }));
}

/** Exécute Each. */
function runEach(nodeName, store, inputItems) {
  const n = node(nodeName);
  const code = n.parameters.jsCode;
  const results = [];
  inputItems.forEach((inItem, idx) => {
    /** Simule l’accès à un nœud n8n pour le scénario. */
    const $ = (name) => {
      const items = store[name] || [];
      return {
        /** Renvoie le premier élément disponible. */
        first: () => items[0],
        /** Renvoie le dernier élément disponible. */
        last: () => items[items.length - 1],
        /** Renvoie tous les éléments disponibles. */
        all: () => items,
        /** Prépare l’élément transmis au nœud suivant. */
        get item() {
          // paired-item semantics: same index if available, else first
          return items[idx] || items[0];
        },
      };
    };
    const $input = { item: inItem, 
    /** Renvoie tous les éléments disponibles. */
    all: () => inputItems, 
    /** Renvoie le premier élément disponible. */
    first: () => inputItems[0] };
    /** Simule la lecture des éléments d’un nœud n8n. */
    const $items = (name) => (store[name] || []);
    const $execution = { id: '1889' };
    const $env = { N8N_INTERNAL_SECRET: 'stub' };
    const fn = new Function('$', '$input', '$items', '$execution', '$env', '$json',
      `${code}`);
    const out = fn($, $input, $items, $execution, $env, inItem.json);
    const item = Array.isArray(out) ? out[0] : out;
    results.push(item && item.json !== undefined ? item : { json: item });
  });
  return results;
}

/** Exécute If. */
function runIf(nodeName, inputItems) {
  const n = node(nodeName);
  const cond = n.parameters.conditions.conditions[0];
  const field = cond.leftValue.replace(/^=\{\{\s*\$json\./, '').replace(/\s*\}\}$/, '');
  const want = cond.rightValue;
  const truthy = [];
  const falsy = [];
  for (const it of inputItems) {
    const v = it.json[field];
    (v === want ? truthy : falsy).push(it);
  }
  return [truthy, falsy];
}

/** Regroupe Append. */
const mergeAppend = (...inputs) => inputs.flat();

/** Prépare le résultat lié à GitHub lecture fichier. */
const githubGetFile = (item) => {
  const p = item.json.target_file_path;
  const f = REPO_FILES[p];
  if (!f) throw new Error('mock: unknown file ' + p);
  return { json: { ...f } };
};

/** Prépare le patch de sortie attendu du modèle. */
const claudePatch = (item, { effective }) => {
  // item.json.claudeBodyString carries the prompt; we synthesize a faithful reply.
  const body = JSON.parse(item.json.claudeBodyString);
  const userPrompt = body.messages[0].content;
  const fileName = item.json.targetFile;
  const isTask = fileName === TASK_FILE;
  const patchedCode = isTask
    ? TASK_SRC_FIXED
    : (effective === false ? SEC_SRC_BEFORE /* ineffective: nothing removed */ : SEC_SRC_FIXED);
  const reply = {
    incidentId: B.incidentId,
    patchDescription: isTask ? 'Suppression du champ inutilisé userRepository (S1068).'
                             : 'Suppression du bloc de code commenté (S125).',
    filePath: fileName,
    patchedCode,
    commitMessage: item.json.commitMessage,
    branchName: item.json.branchName,
    targetFile: fileName,
    processedFindingIds: item.json.approvedFindingIdsForFile,
  };
  assert.ok(userPrompt.includes(fileName), 'prompt must reference the per-item file');
  return { json: { content: [{ type: 'text', text: JSON.stringify(reply) }] } };
};

/** Construit le nœud de modification de fichier GitHub. */
const githubEditFile = (item) => {
  externalWrites.fileEdit += 1;
  return { json: {
    content: { name: item.json.targetFile.split('/').pop(), path: item.json.file_path,
      sha: 'newblob' + externalWrites.fileEdit.toString().padStart(34, '0') },
    commit: { sha: 'newcommit' + externalWrites.fileEdit.toString().padStart(31, '0') },
  } };
};

/** Prépare le résultat lié à drive lot. */
function driveBatch({ scenario }) {
  externalWrites = { branchCreate: 0, prCreate: 0, fileEdit: 0, backendPost: [] };
  const store = {};

  // Upstream singleton context nodes (their outputs, as the real workflow produces them)
  const gateJson = {
    ...B, findingId: TASK_FINDING, findingIds: [TASK_FINDING, SEC_FINDING], findings,
    targetFiles: [TASK_FILE, SEC_FILE], target_file_path: TASK_FILE,
    remediationType: 'AUTO_FIX_ELIGIBLE', decision: 'FIX_PROPOSED', riskLevel: 'minor',
    confidenceScore: 1, enrichedData: { sonar: { issues: findings } },
  };
  store['Policy Gate - Validate Constraints'] = [{ json: gateJson }];
  const ctxJson = { ...gateJson, baseSha: 'basesha'.padEnd(40, '0'), baseBranch: 'main',
    targetBranchName: `fix/pfe-${B.incidentId}-${B.requestId}`,
    findingIds: [TASK_FINDING, SEC_FINDING], findings };
  store['Prepare Batch Context'] = [{ json: ctxJson }];

  // 1. Expand Approved Target Files (REAL jsCode)
  const expanded = runAll('Expand Approved Target Files', store, [{ json: ctxJson }]);
  store['Expand Approved Target Files'] = expanded;
  assert.equal(expanded.length, 2, 'FANOUT: Expand Approved Target Files must emit 2 work items');

  // 2. Fetch Repository Files (mock github, per item)
  const fetched = expanded.map(githubGetFile);
  store['Fetch Repository Files'] = fetched;
  assert.equal(fetched.length, 2, 'FANOUT: Fetch Repository Files must carry 2 items');

  // 3. Prepare - Code Patch Body (REAL jsCode, runOnceForEachItem)
  const prepared = runEach('Prepare - Code Patch Body', store, fetched);
  store['Prepare - Code Patch Body'] = prepared;
  assert.equal(prepared.length, 2, 'FANOUT: Prepare - Code Patch Body must emit 2 items (no $input.first collapse)');

  // 4. File Requires Patch? (IF)
  const [needPatch, alreadyOk] = runIf('File Requires Patch?', prepared);

  // 4a. needs-patch lane: de Patch HTTP → Parse → Validate Candidate → Update File → Build File Result
  const claudeReplies = needPatch.map(it => claudePatch(it, {
    effective: scenario === 'failure' && it.json.targetFile === SEC_FILE ? false : true,
  }));
  store['de Patch - HTTP Request'] = claudeReplies;

  let parsed;
  try {
    parsed = runEach('Parse - Code Patch Output', store, claudeReplies);
  } catch (e) { return { failedAt: 'Parse - Code Patch Output', error: e.message, externalWrites, store }; }
  store['Parse - Code Patch Output'] = parsed;
  assert.equal(parsed.length, needPatch.length, 'FANOUT: Parse - Code Patch Output must be 1:1 with patch requests');

  let validated;
  try {
    validated = runEach('Validate Candidate Remediation', store, parsed);
  } catch (e) {
    // ineffective patch → routed to Prepare WF2 Failure Status, PR never reached
    return { failedAt: 'Validate Candidate Remediation', error: e.message, externalWrites, store };
  }
  store['Validate Candidate Remediation'] = validated;

  const edited = validated.map(githubEditFile);
  store['Update File in Branch'] = edited;
  const fileResults = runEach('Build File Result', store, edited);
  store['Build File Result'] = fileResults;

  // 4b. already-ok lane
  const alreadyResults = alreadyOk.length
    ? runEach('Build Already Remediated Result', store, alreadyOk) : [];
  store['Build Already Remediated Result'] = alreadyResults;

  // 5. Merge Effective File Results (append) → Validate Batch Completeness
  const merged = mergeAppend(fileResults, alreadyResults);
  store['Merge Effective File Results'] = merged;
  assert.equal(merged.length, 2, 'FANOUT: merge(append) must preserve both file results');

  let completeness;
  try {
    completeness = runAll('Validate Batch Completeness', store, merged);
  } catch (e) {
    return { failedAt: 'Validate Batch Completeness', error: e.message, externalWrites, store };
  }
  store['Validate Batch Completeness'] = completeness;

  // 6. PR reuse path (resume scenario): Lookup Existing Batch PR → Select Existing PR → Existing PR? → Use Existing PR
  const openPrs = scenario === 'resume'
    ? [{ number: 24, state: 'open', html_url: 'https://github.com/souhaiel11/pfe-app-test/pull/24',
         head: { ref: ctxJson.targetBranchName, sha: 'prhead'.padEnd(40, 'a'),
                 repo: { full_name: B.githubRepo } },
         base: { ref: 'main', repo: { full_name: B.githubRepo } },
         body: `Batch : ${B.batchId}` }]
    : [];
  store['Lookup Existing Batch PR'] = [{ json: openPrs }];
  const selected = runAll('Select Existing PR', store, [{ json: openPrs }]);
  store['Select Existing PR'] = selected;

  const createRequired = selected[0].json.createRequired;
  let prResult;
  if (!createRequired) {
    prResult = runAll('Use Existing PR', store, selected);
    store['Use Existing PR'] = prResult;
  } else {
    externalWrites.prCreate += 1;
    prResult = [{ json: { number: 25, html_url: 'https://github.com/souhaiel11/pfe-app-test/pull/25',
      head: { sha: 'freshpr'.padEnd(40, 'b'), ref: ctxJson.targetBranchName } } }];
  }

  // 7. Save Execution Result to Backend (PR_CREATED) — payload the real node builds
  const pr = prResult[0].json;
  const vc = completeness[0].json;
  externalWrites.backendPost.push({
    status: 'PR_CREATED', completenessPassed: vc.completenessPassed,
    processedFindingIds: vc.processedFindingIds, effectiveRemediatedFindingIds: vc.effectiveRemediatedFindingIds,
    verifiedFiles: vc.verifiedFiles, updatedFiles: vc.updatedFiles,
    prNumber: pr.number, prHeadSha: pr.head?.sha || '',
  });

  return { completeness: vc, prNumber: pr.number, createRequired, externalWrites, store };
}

/** Prépare le résultat lié à structural Checks. */
function structuralChecks() {
  const perItem = ['Prepare - Code Patch Body', 'Parse - Code Patch Output',
    'Validate Candidate Remediation', 'Build File Result', 'Build Already Remediated Result'];
  for (const name of perItem) {
    assert.equal(node(name).parameters.mode, 'runOnceForEachItem',
      `${name} must run once per item (fan-out safe)`);
    assert.ok(!/\$input\.first\(\)/.test(node(name).parameters.jsCode),
      `${name} must not use $input.first() (1889 collapse pattern)`);
  }
  assert.equal(node('Validate Batch Completeness').parameters.mode, 'runOnceForAllItems');
  assert.equal(node('Merge Effective File Results').type, 'n8n-nodes-base.merge');
  // merge params empty ⇒ default mode 'append' (concatenate, never collapse)
  assert.ok(!node('Merge Effective File Results').parameters.mode
    || node('Merge Effective File Results').parameters.mode === 'append');

  // ordered per-file path
  const order = ['Expand Approved Target Files', 'Fetch Repository Files', 'Prepare - Code Patch Body',
    'File Requires Patch?', 'de Patch - HTTP Request', 'Parse - Code Patch Output',
    'Validate Candidate Remediation', 'Update File in Branch', 'Build File Result',
    'Merge Effective File Results', 'Validate Batch Completeness', 'Lookup Existing Batch PR',
    'Select Existing PR', 'Existing PR?'];
  for (let i = 0; i < order.length - 1; i++) {
    assert.ok(mainTargets(order[i]).includes(order[i + 1]),
      `edge missing: ${order[i]} → ${order[i + 1]}`);
  }
  // PR creation strictly downstream of the completeness gate
  assert.ok(mainTargets('Validate Batch Completeness', 0).includes('Lookup Existing Batch PR'));
  assert.ok(mainTargets('Validate Batch Completeness', 1).includes('Prepare WF2 Failure Status'),
    'completeness FAIL must route to WF2 failure handling');
  assert.ok(mainTargets('Existing PR?', 0).includes('Use Existing PR'));
  assert.ok(mainTargets('Existing PR?', 1).includes('Create Pull Request1'));
  // branch reuse
  assert.ok(mainTargets('Branch Exists?', 0).includes('Use Existing Branch'));
  assert.ok(mainTargets('Branch Exists?', 1).includes('Create Missing Branch'));
  assert.ok(mainTargets('Use Existing Branch', 0).includes('Expand Approved Target Files'));
  assert.ok(mainTargets('Create Missing Branch', 0).includes('Expand Approved Target Files'));
  console.log('§0 structural / fan-out graph checks: PASS');
}

/** Prépare le résultat lié à reproduce1889 Collapse. */
function reproduce1889Collapse() {
  const twoItems = [{ json: { path: TASK_FILE } }, { json: { path: SEC_FILE } }];
  /** Prépare le résultat lié à ancien Prepare. */
  const legacyPrepare = ($input) => {
    const input = $input.first().json;      // ← the collapse
    return [{ json: { requiresPatch: true, targetFile: input.path } }];
  };
  const legacyOut = legacyPrepare({ 
  /** Renvoie le premier élément disponible. */
  first: () => twoItems[0], 
  /** Renvoie tous les éléments disponibles. */
  all: () => twoItems });
  assert.equal(legacyOut.length, 1, 'exec-1889 legacy Prepare collapses 2→1 (documented RCA)');

  // The live node: runOnceForEachItem, `const input = $json` → 1:1.
  const live = node('Prepare - Code Patch Body');
  assert.equal(live.parameters.mode, 'runOnceForEachItem');
  assert.ok(/const input\s*=\s*\$json/.test(live.parameters.jsCode));
  assert.ok(!/\$input\.first\(\)/.test(live.parameters.jsCode));
  console.log('§1 exec-1889 collapse node = "Prepare - Code Patch Body" (runOnceForAllItems + $input.first); live node fixed: PASS');
}

/** Exécute le traitement et collecte son résultat. */
function run() {
  structuralChecks();
  reproduce1889Collapse();

  // §10 OFFLINE SUCCESS SIMULATION
  {
    const r = driveBatch({ scenario: 'success' });
    assert.ok(!r.failedAt, `§10 unexpected failure at ${r.failedAt}: ${r.error}`);
    assert.equal(r.completeness.completenessPassed, true, '§10 completeness must PASS');
    assert.deepEqual(r.completeness.effectiveRemediatedFindingIds, [TASK_FINDING, SEC_FINDING].sort());
    assert.deepEqual(r.completeness.verifiedFiles, [SEC_FILE, TASK_FILE].sort());
    assert.equal(r.completeness.fileResults.length, 2);
    assert.equal(r.externalWrites.fileEdit, 2, '§10 exactly 2 file writes');
    assert.equal(r.externalWrites.backendPost.length, 1);
    assert.equal(r.externalWrites.backendPost[0].completenessPassed, true);
    console.log('§10 OFFLINE SUCCESS  — 2 items → 2 patches → 2 results → completeness PASS → PR allowed: PASS');
  }

  // §11 OFFLINE FAILURE SIMULATION (SecurityConfig patch ineffective)
  {
    const r = driveBatch({ scenario: 'failure' });
    assert.equal(r.failedAt, 'Validate Candidate Remediation',
      '§11 ineffective SecurityConfig patch must be caught before any PR step');
    assert.match(r.error, /WF2_PATCH_NOT_EFFECTIVE/);
    assert.ok(!r.store['Validate Batch Completeness'], '§11 completeness node must not run to success');
    assert.equal(r.externalWrites.prCreate, 0, '§11 zero PR creation');
    assert.equal(r.externalWrites.backendPost.length, 0, '§11 no PR_CREATED emitted');
    console.log('§11 OFFLINE FAILURE  — SecurityConfig ineffective → PR BLOCKED → FIX_FAILED lane: PASS');
  }

  // §11b completeness gate math — exact set equality (independent of the effectiveness gate)
  {
    const vc = node('Validate Batch Completeness').parameters.jsCode;
    /** Prépare les données communes à ce contrôle. */
    const mk = (files, findingsDone) => {
      const store = { 'Prepare Batch Context': [{ json: { findingIds: [TASK_FINDING, SEC_FINDING],
        targetFiles: [TASK_FILE, SEC_FILE] } }] };
      const items = files.map((f, i) => ({ json: { targetFile: f, finalStateVerified: true,
        outcome: 'MODIFIED_AND_REMEDIATED', processedFindingIds: [findingsDone[i]],
        effectiveRemediatedFindingIds: [findingsDone[i]], commitSha: 'c' + i } }));
      try { runAll('Validate Batch Completeness', store, items); return 'PASS'; }
      catch (e) { return 'FAIL:' + e.message.slice(0, 40); }
    };
    assert.match(mk([TASK_FILE], [TASK_FINDING]), /^FAIL/, 'Expected A,B / Actual A → FAIL');
    assert.match(mk([TASK_FILE, 'x/Other.java'], [TASK_FINDING, 'zzz']), /^FAIL/, 'Expected A,B / Actual A,C → FAIL');
    assert.match(mk([TASK_FILE, SEC_FILE, 'x/Other.java'], [TASK_FINDING, SEC_FINDING, 'zzz']), /^FAIL/, 'Expected A,B / Actual A,B,C → FAIL');
    assert.equal(mk([SEC_FILE, TASK_FILE], [SEC_FINDING, TASK_FINDING]), 'PASS', 'Expected A,B / Actual B,A → PASS');
    console.log('§11b completeness gate set-equality (1/2, +unexpected, superset, reordered): PASS');
  }

  // §12 EXISTING PR RESUME SIMULATION
  {
    const r = driveBatch({ scenario: 'resume' });
    assert.ok(!r.failedAt, `§12 unexpected failure at ${r.failedAt}: ${r.error}`);
    assert.equal(r.createRequired, false, '§12 existing PR #24 must be reused');
    assert.equal(r.prNumber, 24, '§12 must resolve to PR #24');
    assert.equal(r.externalWrites.prCreate, 0, '§12 zero new PR');
    assert.equal(r.externalWrites.branchCreate, 0, '§12 zero new branch');
    console.log('§12 EXISTING PR RESUME — branch + PR #24 reused, 0 new branch, 0 new PR: PASS');
  }

  console.log('\nPFE-WF2-BATCH-FANOUT-COMPLETENESS-R10 simulation: ALL PASS');
}

run();
