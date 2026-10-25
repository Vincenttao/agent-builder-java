import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readTree} from './files.js';
import type {Files} from './projects.js';
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function moaTemplateFiles():Files{
 const files=readTree(join(repository,'templates/moa')),runtime=join(repository,'runtime-template-java');
 for(const name of ['pom.xml','LICENSE','Third_Party_Open_Source_Software_Notice.txt'])files[name]=readFileSync(join(runtime,name),'utf8');
 files['runtime-source.json']=readFileSync(join(runtime,'moa-source.json'),'utf8');
 for(const directory of ['src/main/java','src/main/resources','src/test/java'])for(const [name,source]of Object.entries(readTree(join(runtime,directory))))files[directory+'/'+name]=directory==='src/test/java'?source.replaceAll('../examples/idou','runtime-tests/fixtures/idou').replaceAll('../examples/commerce-wealth','runtime-tests/fixtures/commerce-wealth'):source;
 for(const [name,content]of Object.entries(readTree(join(repository,'examples/idou'))))files['runtime-tests/fixtures/idou/'+name]=content;
 for(const [name,content]of Object.entries(readTree(join(repository,'examples/commerce-wealth'))))files['runtime-tests/fixtures/commerce-wealth/'+name]=content;
 files['.gitignore']='target/\n.runtime-state/\n.env\n.env.*\n';
 files['RUNTIME.md']='# MOA 本机运行基础\n\nCore 0.1.17、Runtime 0.1.4，import Runtime BOM。框架 Maven 依赖须先安装；Node 工作台中的开发计划记录固定源码版本。\n\n本工程包含真实 Java 源码和运行资产，应用业务从 application.json / instructions.md / skills / adapters 装配。runtime-tests/fixtures 是只供测试使用的手写示例，不是新应用的业务配置或可选模板。\n\n在工程根目录执行 `mvn package`；需要 JDK 17+、Maven 和本机 Python3。测试使用确定性模型及本机 HTTP 对端，不调用付费模型。运行 `java -jar target/moa-business-application-2.0.0.jar`，由环境提供 MODEL_API_KEY（兼容 DEEPSEEK_API_KEY），MODEL_NAME 与 MODEL_BASE_URL 可配置，WORKBENCH_APP_DIR 指向工程根目录，WORKBENCH_STATE_DIR 指向独立运行目录。真实业务默认使用 deepseek-flash（OpenAI 兼容接口）、独立 Mock，Trace 使用本机 Jaeger。\n\n只支持进程存活期间共两层任务；事件不是跨重启可重驱检查点。不要把 Key 放进工程、版本或交付物。\n';
 return files;
}
