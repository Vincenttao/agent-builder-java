import type {MockFaultMode,MockScenePackage} from '../../../packages/contracts/src/mock-scene.js';
import {canonicalJson} from '../../../packages/contracts/src/canonical.js';
import {createHash} from 'node:crypto';

export const mockSceneContent={
  schemaVersion:1 as const,sceneVersion:'enterprise-mock@1' as const,
  contracts:[
    {operationId:'equipment-status',method:'GET' as const,path:'/mock-business/v1/equipment/:equipmentId',requestFields:['equipmentId'],responseFields:['equipmentId','status','temperatureCelsius','source'],writes:false},
    {operationId:'maintenance-search',method:'GET' as const,path:'/mock-business/v1/maintenance/manuals/:equipmentId',requestFields:['equipmentId'],responseFields:['equipmentId','found','resultCount'],writes:false},
    {operationId:'getAccountBalance',method:'GET' as const,path:'/mock-business/v1/accounts/:accountId/balance',requestFields:['accountId'],responseFields:['accountId','currency','availableBalanceFen','asOf'],writes:false},
    {operationId:'listWealthProducts',method:'GET' as const,path:'/mock-business/v1/wealth/products',requestFields:[],responseFields:['items','version'],writes:false},
    {operationId:'getWealthProduct',method:'GET' as const,path:'/mock-business/v1/wealth/products/:productId',requestFields:['productId'],responseFields:['productId','name','status','minimumAmountFen','description','version'],writes:false},
    {operationId:'listHoldings',method:'GET' as const,path:'/mock-business/v1/accounts/:accountId/holdings',requestFields:['accountId'],responseFields:['accountId','items'],writes:false},
    {operationId:'getOrderByIdempotencyKey',method:'GET' as const,path:'/mock-business/v1/wealth/orders/by-key/:key',requestFields:['key'],responseFields:['orderId','accountId','productId','amountFen','status','createdAt'],writes:false},
    {operationId:'getMockOrder',method:'GET' as const,path:'/mock-business/v1/wealth/orders/:orderId',requestFields:['orderId'],responseFields:['orderId','accountId','productId','amountFen','status','createdAt'],writes:false},
    {operationId:'work-order-by-key',method:'GET' as const,path:'/mock-business/v1/work-orders/by-key/:key',requestFields:['key'],responseFields:['workOrderId','equipmentId','description','priority','actorId','status','createdAt'],writes:false},
    {operationId:'createMockSubscription',method:'POST' as const,path:'/mock-business/v1/wealth/orders',requestFields:['accountId','productId','amountFen'],responseFields:['orderId','accountId','productId','amountFen','status','createdAt'],writes:true},
    {operationId:'work-order-create',method:'POST' as const,path:'/mock-business/v1/work-orders',requestFields:['equipmentId','description','priority'],responseFields:['workOrderId','equipmentId','description','priority','actorId','status','createdAt'],writes:true}
  ],
  seeds:[
    {id:'enterprise-default@1' as const,accounts:[{accountId:'A1001',availableBalanceFen:1000000},{accountId:'A1002',availableBalanceFen:500000}],
      products:[{productId:'SIM-W001',name:'示例理财产品 A',status:'available' as const,minimumAmountFen:10000,description:'纯模拟资料，不计算收益、净值或份额',version:'seed-finance-001@1'},
        {productId:'SIM-W002',name:'示例理财产品 B',status:'suspended' as const,minimumAmountFen:10000,description:'纯模拟资料；暂停申购',version:'seed-finance-001@1'}],
      equipment:[{equipmentId:'PUMP-001',status:'warning',temperatureCelsius:86,source:'seed-equipment-001@1'}]},
    {id:'enterprise-low-balance@1' as const,accounts:[{accountId:'A1001',availableBalanceFen:50000},{accountId:'A1002',availableBalanceFen:500000}],
      products:[{productId:'SIM-W001',name:'示例理财产品 A',status:'available' as const,minimumAmountFen:10000,description:'纯模拟资料，不计算收益、净值或份额',version:'seed-finance-001@1'},
        {productId:'SIM-W002',name:'示例理财产品 B',status:'suspended' as const,minimumAmountFen:10000,description:'纯模拟资料；暂停申购',version:'seed-finance-001@1'}],
      equipment:[{equipmentId:'PUMP-001',status:'warning',temperatureCelsius:86,source:'seed-equipment-001@1'}]}
  ],
  faultModes:['normal','read-timeout','write-before-failure','write-after-timeout','missing-field'] as MockFaultMode[]
};
const digest=createHash('sha256').update(canonicalJson(mockSceneContent)).digest('hex');
export const mockScenePackage:MockScenePackage={...mockSceneContent,digest};
export const mockBusinessReadRoutes=mockSceneContent.contracts.filter(route=>route.method==='GET');
export function mockBusinessPath(operationId:string):string{
  const item=mockSceneContent.contracts.find(contract=>contract.operationId===operationId);
  if(!item)throw new Error('MOCK_CONTRACT_NOT_REGISTERED');return item.path;
}
