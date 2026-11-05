import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest();
export function createWebAuth({loginHash,secure=true,now=Date.now}){
 if(!/^[a-f0-9]{64}$/.test(loginHash||''))throw new Error('A private login hash is required for hosted mode');
 const sessions=new Map(),attempts=new Map(),name=secure?'__Host-asyl-session':'asyl-test-session',ttl=8*3600000;
 const cookie=(value,maxAge)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;
 function clean(){for(const [id,expires] of sessions)if(expires<=now())sessions.delete(id);for(const [ip,entry] of attempts)if(entry.until<=now())attempts.delete(ip);}
 function id(req){const match=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));return match?.slice(name.length+1)||'';}
 function authorized(req){clean();const token=id(req);if(!/^[a-f0-9]{64}$/.test(token))return false;return (sessions.get(sha(token).toString('hex'))||0)>now();}
 function login(code,ip){
  clean();const key=sha(String(ip)).toString('hex');
  const entry=attempts.get(key)||{count:0,until:now()+60000};
  if(entry.count>=5)return {status:429,error:'Слишком много попыток. Подождите минуту.'};
  if(attempts.size>=128&&!attempts.has(key))return {status:429,error:'Попробуйте через минуту.'};
  entry.count++;attempts.set(key,entry);
  if(typeof code!=='string'||code.length>200||!timingSafeEqual(sha(code.trim()),Buffer.from(loginHash,'hex')))return {status:401,error:'Неверный код входа'};
  if(sessions.size>=32)sessions.delete(sessions.keys().next().value);
  const token=randomBytes(32).toString('hex');sessions.set(sha(token).toString('hex'),now()+ttl);attempts.delete(key);
  return {status:200,cookie:cookie(token,ttl/1000)};
 }
 function logout(req){sessions.delete(sha(id(req)).toString('hex'));return cookie('',0);}
 return {authorized,login,logout};
}
