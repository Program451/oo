import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleFeedback} from '../dist-node/service.mjs';
import {d1Adapter} from './sqlite-adapter.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT||5175),bind=process.env.BIND||'127.0.0.1',origin=process.env.PUBLIC_ORIGIN||`http://127.0.0.1:${port}`,dataDir=path.resolve(process.env.DATA_DIR||path.join(root,'local-data'));
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid port');
const canonical=new URL(origin);if(canonical.origin!==origin||canonical.username||canonical.password)throw new Error('Invalid PUBLIC_ORIGIN');
if(!/^[a-f0-9]{64}$/.test(process.env.ADMIN_TOKEN_HASH||''))throw new Error('ADMIN_TOKEN_HASH must be configured before starting');
await mkdir(dataDir,{recursive:true,mode:0o700});const sqlite=new DatabaseSync(path.join(dataDir,'feedback.sqlite'));
sqlite.exec(await readFile(path.join(root,'dist-node/schema.sql'),'utf8'));
const env={DB:d1Adapter(sqlite),ADMIN_TOKEN_HASH:process.env.ADMIN_TOKEN_HASH};
const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/app.css':['app.css','text/css; charset=utf-8'],'/favicon.svg':['favicon.svg','image/svg+xml']};
const server=createServer(async(req,res)=>{
 const respond=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow');
 const host=req.headers.host||'';if(![canonical.host,`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return respond(403,{error:'Неверный адрес'});
 const url=new URL(req.url,origin);
 try{
  if(url.pathname==='/healthz'&&req.method==='GET')return respond(200,{ok:true,service:'asyl-as-feedback'});
  if(url.pathname.startsWith('/api/')){
   let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>12000)return respond(413,{error:'Слишком большой запрос'});chunks.push(chunk);}
   const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(typeof v==='string'&&!['host','cf-connecting-ip','content-length'].includes(k))headers.set(k,v);
   headers.set('cf-connecting-ip',process.env.TRUST_PROXY==='1'?(req.headers['x-forwarded-for']?.split(',').at(-1)?.trim()||req.socket.remoteAddress||'unknown'):(req.socket.remoteAddress||'unknown'));
   const r=await handleFeedback(new Request(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}),env);
   res.writeHead(r.status,Object.fromEntries(r.headers));return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const asset=assets[url.pathname];if(asset&&['GET','HEAD'].includes(req.method)){const bytes=await readFile(path.join(root,'dist-node/public',asset[0]));res.writeHead(200,{'Content-Type':asset[1],'Cache-Control':'no-cache'});return res.end(req.method==='HEAD'?undefined:bytes);}
  return respond(404,{error:'Не найдено'});
 }catch{return respond(500,{error:'Не удалось обработать запрос. Попробуйте позже.'});}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(port,bind,()=>console.log(`Asyl As feedback ready on ${bind}:${port}`));
const stop=()=>server.close(()=>{sqlite.close();process.exit(0);});process.on('SIGINT',stop);process.on('SIGTERM',stop);
