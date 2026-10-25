import test from 'node:test';import assert from 'node:assert/strict';import {buildReuse} from './fixtures/build-reuse.js';
test('verification reuses the actual binary only for identical saved or known compiled inputs',()=>{
 const before={'pom.xml':'pom','src/main/java/App.java':'java','src/main/resources/prompt.md':'resource','src/test/java/Test.java':'tests','runtime-tests/fixtures/idou/application.json':'fixture','tests/business-cases.json':'old','application.json':'original'};
 assert.equal(buildReuse(before,before,false)?.scope,'exact-saved-tree');const changed={...before,'tests/business-cases.json':'new','application.json':'new external origin'};assert.equal(buildReuse(changed,before,true)?.scope,'same-compiled-inputs');assert.equal(buildReuse(changed,before,false),null);
 for(const path of ['pom.xml','src/main/java/App.java','src/main/resources/prompt.md','src/test/java/Test.java','runtime-tests/fixtures/idou/application.json'])assert.equal(buildReuse({...changed,[path]:'changed'},before,true),null,path);
});
test('new unknown files and missing build inputs cannot hide behind business asset reuse',()=>{
 const before={'pom.xml':'pom','src/main/java/App.java':'java','tests/business-cases.json':'old'};assert.equal(buildReuse({...before,'unknown-build-input.txt':'new'},before,true),null);assert.equal(buildReuse({'tests/business-cases.json':'new'},{'tests/business-cases.json':'old'},true),null);
});
