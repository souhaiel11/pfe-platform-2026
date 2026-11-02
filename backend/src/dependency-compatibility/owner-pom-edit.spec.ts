// Teste le composant « owner-pom-edit » et ses cas d’erreur.
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { applyOwnerVersionEdit } from './owner-pom-edit';

const pomXmlText = readFileSync(join(__dirname, '../security-remediation/fixtures/pfe-app-test.pom.xml'), 'utf8');

// 1. Real PARENT_VERSION edit on the real pfe-app-test pom: 2.7.0 -> 2.7.18.
{
  const result = applyOwnerVersionEdit(pomXmlText, { editType: 'PARENT_VERSION', editCoordinate: 'org.springframework.boot:spring-boot-starter-parent' }, '2.7.18');
  assert.equal(result.ok, true, result.reason);
  assert.ok(result.content!.includes('<artifactId>spring-boot-starter-parent</artifactId>\n        <version>2.7.18</version>'));
  /** Prépare les données nécessaires à ce scénario. */
  const withoutParent = (s: string) => s.replace(/<parent>[\s\S]*?<\/parent>/, '');
  assert.equal(withoutParent(result.content!), withoutParent(pomXmlText));
}
console.log('1. real PARENT_VERSION edit on the real pfe-app-test pom (2.7.0 -> 2.7.18), nothing else touched: PASS');

// 2. Wrong owner coordinate (does not match the real <parent>) is rejected, never silently edits the wrong block.
{
  const result = applyOwnerVersionEdit(pomXmlText, { editType: 'PARENT_VERSION', editCoordinate: 'com.example:not-the-real-parent' }, '9.9.9');
  assert.equal(result.ok, false);
  assert.match(result.reason, /PARENT_BLOCK_DOES_NOT_MATCH_OWNER/);
}
console.log('2. mismatched parent owner coordinate -> rejected, no edit: PASS');

// 3. A pom with no <parent> at all is rejected, never fabricated.
{
  const result = applyOwnerVersionEdit('<project><artifactId>x</artifactId></project>', { editType: 'PARENT_VERSION', editCoordinate: 'g:a' }, '1.0');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_PARENT_BLOCK_FOUND');
}
console.log('3. no <parent> block at all -> rejected: PASS');

// 4. BOM_VERSION edit on a synthetic (explicitly not-real) pom snippet with one import-scoped entry.
const syntheticBomPom = `<project>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>com.example</groupId>
        <artifactId>example-bom</artifactId>
        <version>1.0.0</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
      <dependency>
        <groupId>com.example</groupId>
        <artifactId>not-a-bom-just-managed</artifactId>
        <version>2.0.0</version>
      </dependency>
    </dependencies>
  </dependencyManagement>
</project>`;
{
  const result = applyOwnerVersionEdit(syntheticBomPom, { editType: 'BOM_VERSION', editCoordinate: 'com.example:example-bom' }, '1.2.0');
  assert.equal(result.ok, true, result.reason);
  assert.ok(result.content!.includes('<artifactId>example-bom</artifactId>\n        <version>1.2.0</version>'));
  assert.ok(result.content!.includes('<artifactId>not-a-bom-just-managed</artifactId>\n        <version>2.0.0</version>'), 'the non-import-scoped, differently-named managed dependency must be untouched');
}
console.log('4. synthetic BOM_VERSION edit touches only the import-scoped entry: PASS');

// 5. A same-GAV entry that is NOT import-scoped must never be mistaken for the BOM entry.
{
  const noImportPom = `<project><dependencyManagement><dependencies>
    <dependency><groupId>com.example</groupId><artifactId>example-bom</artifactId><version>1.0.0</version></dependency>
  </dependencies></dependencyManagement></project>`;
  const result = applyOwnerVersionEdit(noImportPom, { editType: 'BOM_VERSION', editCoordinate: 'com.example:example-bom' }, '1.2.0');
  assert.equal(result.ok, false);
  assert.match(result.reason, /BOM_IMPORT_ENTRY_NOT_FOUND/);
}
console.log('5. same-GAV but non-import-scoped entry is never mistaken for a BOM import: PASS');

// 6. Unsupported editType (e.g. a direct edit) is rejected by this owner-only module.
{
  const result = applyOwnerVersionEdit(pomXmlText, { editType: 'DEPENDENCY_VERSION', editCoordinate: 'org.yaml:snakeyaml' }, '1.31');
  assert.equal(result.ok, false);
  assert.match(result.reason, /UNSUPPORTED_EDIT_TYPE_FOR_OWNER_EDIT/);
}
console.log('6. DEPENDENCY_VERSION/PROPERTY_VERSION plans are out of scope for this module (real writer handles those): PASS');

console.log('owner-pom-edit.spec.ts: ALL CHECKS PASS');
