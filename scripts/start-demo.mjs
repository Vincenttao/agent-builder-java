import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{
  cwd:fileURLToPath(new URL('../apps/web/',import.meta.url)),stdio:'inherit',env:{...process.env,
    BUILDER_API_TARGET:process.env.BUILDER_API_TARGET??'http://127.0.0.1:18080',
    BUILDER_API_ORIGIN:process.env.BUILDER_API_ORIGIN??'http://127.0.0.1:8080'
  }
});
console.log('设备查询样例：http://127.0.0.1:5173/?demo=equipment');
console.log('连接已有主服务；不启动 Docker，不编译或生成候选。');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
