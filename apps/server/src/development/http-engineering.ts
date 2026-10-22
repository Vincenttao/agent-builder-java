import {HttpPort} from '../runs/http-ports.js';
import type {EngineeringPort} from './development-service.js';
import type {EngineeringTaskInput,EngineeringTaskRecord,EngineeringEvent,CommandResult} from '../../../../packages/contracts/src/development.js';
export class HttpEngineering implements EngineeringPort {
 private port:HttpPort;
 constructor(base:string,token:string){this.port=new HttpPort(base,token,30000,['ENGINE_MODEL_NOT_CONFIGURED','GENERATION_PROFILE_UNSUPPORTED','GENERATION_SCOPE_UNSUPPORTED','DEPENDENCY_NOT_ALLOWED','BUSINESS_CONNECTION_NOT_ALLOWED','ENGINEERING_BUDGET_INVALID','ENGINEERING_QUEUE_LIMIT','ENGINEERING_INPUT_CONFLICT','ENGINEERING_TASK_RETIRED']);}
 submit(id:string,input:EngineeringTaskInput):Promise<EngineeringTaskRecord>{return this.port.request(`/engineering/tasks/${encodeURIComponent(id)}`,'PUT',input);}
 get(id:string):Promise<EngineeringTaskRecord>{return this.port.request(`/engineering/tasks/${encodeURIComponent(id)}`);}
 cancel(id:string):Promise<{id:string;status:string}>{return this.port.request(`/engineering/tasks/${encodeURIComponent(id)}/cancel`,'POST',{});}
 async events(id:string,after:number):Promise<EngineeringEvent[]>{return(await this.port.request<{items:EngineeringEvent[]}>(`/engineering/tasks/${encodeURIComponent(id)}/events?after=${after}`)).items;}
 file(id:string,path:string):Promise<{path:string;digest:string;content:string}>{return this.port.request(`/engineering/tasks/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`);}
 command(id:string,commandId:string):Promise<CommandResult>{return this.port.request(`/engineering/tasks/${encodeURIComponent(id)}/commands/${encodeURIComponent(commandId)}`);}
}
