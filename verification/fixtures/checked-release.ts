import {ReviewManager} from '../../workbench-server/reviews.js';
import type {ProjectStore,Role} from '../../workbench-server/projects.js';
/** Fixture setup follows the same release gate as the product. Never fabricates a report. */
export function checkedRelease(store:ProjectStore,id:string,role:Role,version:string){
 const report=new ReviewManager(store).check(id,role);
 if(!report.passed)throw Error('Fixture template failed real structural checks: '+JSON.stringify(report.items.filter(i=>!i.passed)));
 return store.publish(id,role,version);
}
