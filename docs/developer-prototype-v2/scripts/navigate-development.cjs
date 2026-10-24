// Historical journeys keep their business assertions; only navigation changes.
module.exports=async function navigateDevelopment(click,id){
 const section={assembly:'capabilities',skills:'capabilities',tools:'capabilities',instructions:'settings',connections:'settings'}[id]||id;
 await click('dev-section',`[data-id="${section}"]`);
 if(['assembly','skills','tools'].includes(id)){
  await click('capability-filter',`[data-id="${id==='skills'?'skill':id==='tools'?'tool':'all'}"]`);
  if(id==='skills')await click('select-capability','[data-id="builtin-skill"]');
 }
};
