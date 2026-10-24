import {createBusinessMock} from './server.js';
const port=Number(process.env.MOCK_PORT??'8770');
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid MOCK_PORT');
const server=createBusinessMock().listen(port,'127.0.0.1',()=>console.log(`Independent business Mock: http://127.0.0.1:${port}`));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>server.close(()=>process.exit(0)));
