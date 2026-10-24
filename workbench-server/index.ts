import {resolve} from 'node:path';
import {createWorkbench} from './app.js';
const port=Number(process.env.WORKBENCH_PORT??8768);
const {app,store}=createWorkbench({root:resolve(process.env.WORKBENCH_DATA_DIR??'.workbench/data')});
const server=app.listen(port,'127.0.0.1',()=>console.log(`可运行开发工作台：http://127.0.0.1:${port}`));
function stop(){server.close(()=>{store.close();process.exit(0);});}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
