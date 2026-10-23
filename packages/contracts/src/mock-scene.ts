export type MockSeedId='enterprise-default@1'|'enterprise-low-balance@1';
export type MockFaultMode='normal'|'read-timeout'|'write-before-failure'|'write-after-timeout'|'missing-field';
export interface MockScenePackage {
  schemaVersion:1;sceneVersion:'enterprise-mock@1';digest:string;
  contracts:{operationId:string;method:'GET'|'POST';path:string;requestFields:string[];responseFields:string[];writes:boolean}[];
  seeds:{id:MockSeedId;accounts:{accountId:string;availableBalanceFen:number}[];products:{productId:string;name:string;status:'available'|'suspended';minimumAmountFen:number;description:string;version:string}[];equipment:{equipmentId:string;status:string;temperatureCelsius:number;source:string}[]}[];
  faultModes:MockFaultMode[];
}
