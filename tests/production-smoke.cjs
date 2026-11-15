const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3212'], {
  cwd:path.resolve(__dirname,'..'), windowsHide:true, stdio:['ignore','pipe','pipe'],
  // Fail locally if an anonymous test accidentally reaches the database.
  env:{...process.env,MONGODB_URI:'mongodb://127.0.0.1:1/qa?serverSelectionTimeoutMS=100'},
});
let logs='';
const ready = new Promise((resolve,reject) => {
  const timer=setTimeout(()=>reject(new Error('Server startup timed out')),30000);
  const consume=chunk=>{logs+=chunk;if(logs.includes('Ready in')){clearTimeout(timer);resolve();}};
  server.stdout.on('data',consume);server.stderr.on('data',consume);
  server.once('error',reject);server.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code));});
});
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
const base='http://127.0.0.1:3212';
async function request(route,options={}){return fetch(base+route,{signal:AbortSignal.timeout(15000),...options});}
const json={headers:{'content-type':'application/json'},body:'{}'};
(async()=>{
  try{
    await ready;
    for(const route of ['/','/login','/register','/verify-email','/about']){
      const response=await request(route);assert.equal(response.status,200,route);assert.ok((await response.text()).includes('RecipeSafe'));console.log('PASS public '+route);
    }
    for(const route of ['/u/profile','/u/recipes','/family/recovery','/family/507f1f77bcf86cd799439001/settings']){
      const response=await request(route,{redirect:'manual'});const body=await response.text();
      // Next.js can send an authenticated page's redirect in a streamed 200 response.
      assert.ok([302,303,307,308].includes(response.status)||(response.status===200&&body.includes('NEXT_REDIRECT;')&&body.includes('__next-page-redirect')),route);
    }
    console.log('PASS anonymous personal/family pages redirect');
    for(const route of ['/api/user/get','/api/recipe/get','/api/inquiry/get','/api/recipe-transfers','/api/cron/account-purge']) assert.equal((await request(route)).status,401,route);
    for(const route of ['/api/recipe/create','/api/invite/send','/api/invite/accept','/api/invite/decline']) assert.equal((await request(route,{method:'POST',...json})).status,401,route);
    console.log('PASS anonymous personal/family API reads and writes rejected');
    assert.equal((await request('/api/user/delete',{method:'DELETE',...json})).status,401);
    assert.equal((await request('/api/recipe-transfers',{method:'POST',...json})).status,401);
    assert.equal((await request('/api/user/delete',{method:'DELETE',headers:{'content-type':'application/json',origin:'https://other.example.invalid'},body:'{}'})).status,403);
    const closedPage=await request('/login?closed=1&recoverBy=2026-12-14T12%3A00%3A00.000Z');
    const closedHTML=await closedPage.text();assert.ok(closedHTML.includes('Account closed'));assert.ok(closedHTML.includes('email recovery'));assert.ok(closedHTML.includes('Mon, 14 Dec 2026 12:00:00 GMT'));
    console.log('PASS closure receipt, transfer authentication and protected purge endpoint');
    assert.equal((await request('/api/user/edit',{method:'PUT',headers:{'content-type':'application/json',origin:'https://other.example.invalid'},body:'{}'})).status,403);
    assert.equal((await request('/api/invite/test',{method:'POST',...json})).status,404);
    console.log('PASS cross-origin mutation and legacy test route blocked');
    let blocked=0;
    for(const file of [...walk('app/api/community'),...walk('app/api/post')].filter(file=>file.endsWith('route.ts'))){
      const route='/'+file.replace(/\\/g,'/').replace(/^app\//,'').replace(/\/route.ts$/,'');
      const methods=[...fs.readFileSync(file,'utf8').matchAll(/export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)/g)].map(match=>match[1]);
      for(const method of methods){assert.equal((await request(route,{method,...(method==='GET'?{}:json)})).status,404,method+' '+route);blocked++;}
    }
    for(const route of ['/communities','/communities/user','/communities/507f1f77bcf86cd799439001','/communities/posts/507f1f77bcf86cd799439001']) assert.equal((await request(route)).status,404,route);
    console.log('PASS '+blocked+' production community/post API methods and direct community pages blocked');
    const providers=await(await request('/api/auth/providers')).json();assert.ok(providers.google&&providers.credentials);
    const page=await request('/login');assert.equal(page.headers.get('x-frame-options'),'DENY');assert.equal(page.headers.get('x-content-type-options'),'nosniff');assert.equal(page.headers.get('access-control-allow-origin'),null);assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    const html=await page.text(),js=html.match(/src="([^\"]+\.js(?:\?[^\"]*)?)"/)[1].split('?')[0];assert.equal((await request(js+'.map')).status,404);
    console.log('PASS auth provider discovery, security headers and public source maps disabled');
    const manifest=JSON.parse(fs.readFileSync('.next/server/server-reference-manifest.json','utf8'));
    const names=Object.values(manifest.node||{}).map(entry=>entry.exportedName);assert.ok(!names.includes('AcceptInvite'));assert.ok(!names.includes('DeleteUser'));
    console.log('PASS unsafe legacy server actions absent from build');
  }catch(error){console.error(error);console.error(logs);process.exitCode=1;}
  finally{server.kill();}
})();
