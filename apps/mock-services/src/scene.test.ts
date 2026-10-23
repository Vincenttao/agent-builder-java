import {afterEach,describe,it,expect} from 'vitest';
import {createMockApp} from './app.js';
import {mockBusinessReadRoutes,mockScenePackage,mockSceneContent} from './scene.js';
import type {MockRepository} from './repository.js';

const apps:ReturnType<typeof createMockApp>[]=[];
afterEach(async()=>Promise.all(apps.splice(0).map(app=>app.close())));
describe('portable Mock enterprise scene',()=>{
 it('serves the versioned seed and API contracts only through the control credential',async()=>{
  const app=createMockApp({repository:{} as MockRepository,controlToken:'mock-control-token-32-characters',businessToken:'mock-business-token-32-characters'});apps.push(app);
  expect((await app.inject({method:'GET',url:'/control/project-scene'})).statusCode).toBe(401);
  const response=await app.inject({method:'GET',url:'/control/project-scene',headers:{authorization:'Bearer mock-control-token-32-characters'}});
  expect(response.statusCode).toBe(200);expect(response.json()).toEqual(mockScenePackage);expect(JSON.stringify(response.json())).not.toMatch(/token|secret|password/i);
  expect(mockBusinessReadRoutes).toHaveLength(9);expect(mockSceneContent.contracts).toContainEqual(expect.objectContaining({operationId:'maintenance-search',path:'/mock-business/v1/maintenance/manuals/:equipmentId',writes:false}));expect(mockSceneContent.seeds[0]?.accounts[0]?.availableBalanceFen).toBe(1000000);expect(mockSceneContent.seeds[1]?.accounts[0]?.availableBalanceFen).toBe(50000);
  expect(mockSceneContent.contracts.filter(contract=>contract.method==='POST'&&contract.writes)).toHaveLength(2);
 });
});
