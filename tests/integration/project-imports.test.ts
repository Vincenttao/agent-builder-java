import {afterAll,beforeAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool} from '../../apps/server/src/db/pool.js';
import {migrate} from '../../apps/server/src/db/migrations.js';
import {DraftService} from '../../apps/server/src/drafts/application/draft-service.js';
import {PostgresDraftRepository} from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import {PostgresProjectPackageStore} from '../../apps/server/src/projects/project-package-store.js';
import type {ProjectPackage} from '../../packages/contracts/src/project-package.js';
import {draftInput} from '../support/fixtures.js';

const schema=`it_project_import_${randomUUID().replaceAll('-','')}`;const url=process.env.TEST_DATABASE_URL??'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const admin=new Pool({connectionString:url});const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const drafts=new DraftService(new PostgresDraftRepository(pool),{now:()=>new Date().toISOString()},{next:randomUUID});
beforeAll(async()=>{await admin.query(`CREATE SCHEMA "${schema}"`);await migrate(pool);});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});

it('keeps the immutable recovery package available after a new store instance is created',async()=>{
 const draft=await drafts.create(draftInput);const source={schemaVersion:1,packageKind:'agent-builder-project',source:{projectId:randomUUID(),revision:1,exportedAt:new Date().toISOString()},draft:draftInput,snapshots:[],baselines:[],automation:{jobs:[],candidates:[],artifactDependencies:[]},connectionRequirements:[],packageDigest:'a'.repeat(64)} as ProjectPackage;
 await new PostgresProjectPackageStore(pool).save(draft.id,source);
 expect(await new PostgresProjectPackageStore(pool).get(draft.id)).toEqual(source);
 await expect(new PostgresProjectPackageStore(pool).save(draft.id,{...source,packageDigest:'b'.repeat(64)})).rejects.toMatchObject({code:'PROJECT_RECOVERY_PACKAGE_CONFLICT'});
 await expect(pool.query('UPDATE imported_project_packages SET package_digest=$2 WHERE draft_id=$1',[draft.id,'b'.repeat(64)])).rejects.toThrow(/immutable/i);
});
