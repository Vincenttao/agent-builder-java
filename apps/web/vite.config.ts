import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const target=process.env.BUILDER_API_TARGET??'http://127.0.0.1:8080';
const origin=process.env.BUILDER_API_ORIGIN??target;
export default defineConfig({ plugins: [react()], server: { host:'127.0.0.1', proxy:
  Object.fromEntries(['/api','/health','/agent-api','/test-api'].map(path=>[path,{
    target, changeOrigin:true,
    configure(proxy){proxy.on('proxyReq',(request,incoming)=>{
      // Translate only this loopback frontend's Origin; preserve foreign origins for backend rejection.
      const source=incoming.headers.origin;
      if(source && source===`http://${incoming.headers.host}`)request.setHeader('origin',origin);
    });}
  }]))
} });
