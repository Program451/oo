import {spawn} from 'node:child_process';
import {mkdir,readFile,open,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function alive(url,headers={}){try{return (await fetch(url,{headers,signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}}
let modelAvailable=true;try{await access(path.join(root,'local-ai/active.json'));await access(path.join(root,'local-ai/.venv/Scripts/python.exe'));}catch{modelAvailable=false;}
await access(path.join(root,'local-dist/index.html'));
await mkdir(path.join(root,'local-data'),{recursive:true});
const state={};
async function background(name,exe,args,extraEnv={}){
 const log=await open(path.join(root,'local-data',`${name}.log`),'a');
 const child=spawn(exe,args,{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,...extraEnv}});
 child.on('error',error=>console.error(`${name}: ${error.message}`));child.unref();
 await log.close();
 state[name]=child.pid;return child;
}
if(!await alive('http://127.0.0.1:5174/')){
 await background('app',process.execPath,['scripts/local-server.mjs']);
 let ready=false;for(let i=0;i<30;i++){if(await alive('http://127.0.0.1:5174/')){ready=true;break;}await sleep(500);}
 if(!ready)throw new Error('Application did not start. See local-data/app.log.');
}
if(modelAvailable&&!await alive('http://127.0.0.1:11435/health',{'X-Asyl-Client':'local'})){
 console.log('Loading the trained local model...');
 await background('model',path.join(root,'local-ai/.venv/Scripts/python.exe'),['-u','local-ai/serve.py'],{PYTHONUTF8:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1'});
 let ready=false;for(let i=0;i<120;i++){if(await alive('http://127.0.0.1:11435/health',{'X-Asyl-Client':'local'})){ready=true;break;}await sleep(1000);}
 if(!ready)console.warn('Model did not start. Journal and surveys are available; see local-data/model.log.');
}
await writeFile(path.join(root,'local-data/processes.json'),JSON.stringify(state));
if(!modelAvailable)console.warn('Local model is not installed. Journal and surveys remain available.');
console.log('Ready: http://127.0.0.1:5174/');
console.log('Training report: http://127.0.0.1:5174/training');
