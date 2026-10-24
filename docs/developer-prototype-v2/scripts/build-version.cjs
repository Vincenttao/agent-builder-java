const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
module.exports=function buildVersion(root){
 const hash=createHash('sha256');
 for(const file of ['index.html','style.css','app.js']){hash.update(file+'\0');hash.update(fs.readFileSync(path.join(root,'src',file)));hash.update('\0');}
 return hash.digest('hex');
};
