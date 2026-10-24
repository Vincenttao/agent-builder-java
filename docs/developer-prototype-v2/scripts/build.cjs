const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=path.join(root,'src');
const html=fs.readFileSync(path.join(source,'index.html'),'utf8')
  .replace('<link rel="stylesheet" href="style.css">',()=>`<style>\n${fs.readFileSync(path.join(source,'style.css'),'utf8')}\n</style>`)
  .replace('<script src="app.js"></script>',()=>`<script>\n${fs.readFileSync(path.join(source,'app.js'),'utf8')}\n</script>`);
fs.writeFileSync(path.join(root,'开发工作台2.0.html'),html);
console.log('已生成单文件设计稿：docs/developer-prototype-v2/开发工作台2.0.html');
