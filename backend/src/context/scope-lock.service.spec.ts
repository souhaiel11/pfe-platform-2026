import * as assert from 'node:assert/strict';
import { ScopeLockService } from './scope-lock.service';

const service = new ScopeLockService();

// --- A file matching the approved finding's own location is in-scope ---
{
  const result = service.evaluate({
    approvedFindingFiles: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'],
    provenRegressionFiles: [],
    proposedFiles: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'],
  });
  assert.equal(result.allInScope, true, 'the approved finding file itself is in scope');
  assert.equal(result.classification['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'], 'IN_SCOPE_APPROVED_FINDING');
}

// --- A file fixing a proven regression (e.g. TaskController's BeanUtils status mapping, R21-AV) is in-scope ---
{
  const result = service.evaluate({
    approvedFindingFiles: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'],
    provenRegressionFiles: ['src/main/java/com/pfe/devsecops/controller/TaskController.java'],
    proposedFiles: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java', 'src/main/java/com/pfe/devsecops/controller/TaskController.java'],
  });
  assert.equal(result.allInScope, true, 'both the finding file and the regression fix file are in scope');
  assert.equal(result.classification['src/main/java/com/pfe/devsecops/controller/TaskController.java'], 'IN_SCOPE_REGRESSION');
}

// --- An unrelated file (silent refactor / unrelated cleanup) is OUT_OF_SCOPE ---
{
  const result = service.evaluate({
    approvedFindingFiles: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'],
    provenRegressionFiles: [],
    proposedFiles: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java', 'src/main/java/com/pfe/devsecops/service/UnrelatedService.java'],
  });
  assert.equal(result.allInScope, false, 'an unrelated file makes the whole proposal not-all-in-scope');
  assert.deepEqual(result.outOfScopeFiles, ['src/main/java/com/pfe/devsecops/service/UnrelatedService.java']);
}

// --- A schema file is OUT_OF_SCOPE even if it also happens to be the approved finding's own file ---
{
  const result = service.evaluate({
    approvedFindingFiles: ['src/main/java/com/pfe/devsecops/model/Task.java'],
    provenRegressionFiles: [],
    proposedFiles: ['src/main/java/com/pfe/devsecops/model/Task.java'],
    schemaFiles: ['src/main/java/com/pfe/devsecops/model/Task.java'],
  });
  assert.equal(result.allInScope, false, 'a schema-changing file is never in-scope regardless of attribution');
  assert.equal(result.classification['src/main/java/com/pfe/devsecops/model/Task.java'], 'OUT_OF_SCOPE');
}

console.log('ScopeLockService: PASS');
