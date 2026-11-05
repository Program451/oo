import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWebAuth} from './web-auth.mjs';
const code='a'.repeat(64),loginHash=createHash('sha256').update(code).digest('hex');
test('hosted authentication fails closed without an explicit login hash',()=>assert.throws(()=>createWebAuth({loginHash:''})));
test('sessions use secure cookies, expire, and are invalidated by logout',()=>{
 let now=1000;const auth=createWebAuth({loginHash,now:()=>now}),login=auth.login(code,'test');
 assert.equal(login.status,200);for(const attribute of ['__Host-asyl-session','HttpOnly','Secure','SameSite=Lax'])assert.ok(login.cookie.includes(attribute));
 assert.equal(login.cookie.includes(code),false);const req={headers:{cookie:login.cookie.split(';')[0]}};
 assert.equal(auth.authorized(req),true);auth.logout(req);assert.equal(auth.authorized(req),false);
 const again=auth.login(code,'test');now+=8*3600000+1;assert.equal(auth.authorized({headers:{cookie:again.cookie.split(';')[0]}}),false);
});
test('repeated incorrect login attempts are bounded and recover after cooldown',()=>{
 let now=1000;const auth=createWebAuth({loginHash,now:()=>now});for(let i=0;i<5;i++)assert.equal(auth.login('bad','same').status,401);
 assert.equal(auth.login(code,'same').status,429);now+=61000;assert.equal(auth.login(code,'same').status,200);
});
