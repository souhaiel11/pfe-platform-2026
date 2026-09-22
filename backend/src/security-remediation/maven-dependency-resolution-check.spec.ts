import * as assert from 'node:assert/strict';
import { dependencyTreeResolvesTo } from './maven-dependency-resolution-check';

const REAL_TREE_AFTER = `com.example:pfe-app-test:jar:0.0.1-SNAPSHOT
+- ch.qos.logback:logback-classic:jar:1.2.13:compile
|  +- ch.qos.logback:logback-core:jar:1.2.11:compile
|  \\- org.slf4j:slf4j-api:jar:1.7.36:compile
\\- org.springframework.boot:spring-boot-starter-web:jar:2.7.0:compile
   \\- org.apache.tomcat.embed:tomcat-embed-core:jar:9.0.63:compile
`;

{
  assert.equal(dependencyTreeResolvesTo(REAL_TREE_AFTER, 'ch.qos.logback:logback-classic', '1.2.13'), true);
  assert.equal(dependencyTreeResolvesTo(REAL_TREE_AFTER, 'ch.qos.logback:logback-classic', '1.2.11'), false, 'old version must not still match after upgrade');
  assert.equal(dependencyTreeResolvesTo(REAL_TREE_AFTER, 'ch.qos.logback:logback-classic', '1.2.1'), false, 'must not prefix-match a shorter version string');
  assert.equal(dependencyTreeResolvesTo(REAL_TREE_AFTER, 'ch.qos.logback:logback-classic', '1.2.130'), false, 'must not suffix-match a longer version string');
  assert.equal(dependencyTreeResolvesTo(REAL_TREE_AFTER, 'org.apache.tomcat.embed:tomcat-embed-core', '9.0.63'), true, 'matches nested/indented lines too');
  assert.equal(dependencyTreeResolvesTo(REAL_TREE_AFTER, 'com.example:absent', '1.0.0'), false);
  assert.equal(dependencyTreeResolvesTo('', 'ch.qos.logback:logback-classic', '1.2.13'), false, 'empty tree text -> never a match');
  assert.equal(dependencyTreeResolvesTo(REAL_TREE_AFTER, '', '1.2.13'), false, 'empty coordinate -> never a match');
}
console.log('maven-dependency-resolution-check) real-shaped tree text matching, anchored, no prefix/suffix false positives: PASS');

console.log('maven-dependency-resolution-check.spec.ts: ALL CHECKS PASS');
