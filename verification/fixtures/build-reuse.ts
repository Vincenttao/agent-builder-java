/** Verification-only binary reuse. The ordinary workbench still runs Maven. */
const external=(path:string)=>['application.json','instructions.md','runtime-settings.json','template.json','README.md','.gitignore'].includes(path)||['skills/','adapters/','tests/','.opencode/'].some(prefix=>path.startsWith(prefix));
export function buildReuse(current:Record<string,string>,saved:Record<string,string>,knownPom:boolean){
 const names=Object.keys(current).sort(),old=Object.keys(saved).sort(),same=(a:string[],b:string[])=>a.length===b.length&&a.every((p,i)=>p===b[i]&&current[p]===saved[p]);
 if(same(names,old))return {scope:'exact-saved-tree',verified:names,externalAssets:[]};
 const compiled=names.filter(p=>!external(p)),previous=old.filter(p=>!external(p));
 if(knownPom&&compiled.includes('pom.xml')&&compiled.some(p=>p.startsWith('src/main/java/'))&&same(compiled,previous))return {scope:'same-compiled-inputs',verified:compiled,externalAssets:names.filter(external)};
 return null;
}
