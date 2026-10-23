import { execFileSync } from 'node:child_process';

const project = process.env.NF01_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const runner = `${project}-runner-1`;
const apply = process.argv.includes('--apply');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true }).trim();
const pointers = JSON.parse(docker('compose', '--env-file', '.env.local', '-p', project, 'exec', '-T', 'postgres', 'psql', '-U', 'builder', '-d', 'builder', '-Atc', "SELECT COALESCE(json_agg(record),'[]'::json) FROM release_pointers"));
const active = new Set(pointers.map(pointer => pointer.deploymentId));
const listingScript = `import{readdir,readFile}from'node:fs/promises';const out=[];for(const id of await readdir('/data/deployments')){try{const state=JSON.parse(await readFile('/data/deployments/'+id+'/state.json','utf8'));if(state.status==='ready')out.push(id)}catch{}}console.log(JSON.stringify(out))`;
const ready = JSON.parse(docker('exec', runner, 'node', '--input-type=module', '-e', listingScript));
const stale = ready.filter(id => !active.has(id));
const results = [];
for (const id of stale) {
  if (!apply) { results.push({ id, action: 'would-stop' }); continue; }
  const stopScript = `const id=process.argv[1];const response=await fetch('http://127.0.0.1:8081/deployments/'+id+'/stop',{method:'POST',headers:{authorization:'Bearer '+process.env.RUNNER_CONTROL_TOKEN,'content-type':'application/json'},body:'{}'});const value=await response.json();console.log(JSON.stringify({id,status:response.status,state:value.status,error:value.code??null}));if(!response.ok)process.exitCode=1`;
  results.push(JSON.parse(docker('exec', runner, 'node', '--input-type=module', '-e', stopScript, id)));
}
console.log(JSON.stringify({ project, mode: apply ? 'apply' : 'dry-run', readyDeployments: ready.length, activeReleasePointers: active.size, staleDeployments: stale.length, results }));
