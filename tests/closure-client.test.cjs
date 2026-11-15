const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(file, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true},fileName:file,
  }).outputText;
  const module={exports:{}};
  const requireMock=name=>{
    if(Object.hasOwn(dependencies,name)) return dependencies[name];
    throw new Error('Unexpected live dependency: '+name);
  };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`,globals,{filename:file})(requireMock,module,module.exports);
  return module.exports;
}
function fixture(response) {
  const requests=[],messages=[]; let resets=0;
  const api=load('utils/apihelpers/api-response.ts');
  const {default:close}=load('utils/apihelpers/delete/deleteUser.ts',{
    sonner:{toast:{error:message=>messages.push({kind:'error',message}),success:message=>messages.push({kind:'success',message})}},
    '@/lib/security/session-stores':{resetSessionStores(){resets++;}},
    '../api-response':api,
  },{fetch:async(url,options)=>{requests.push({url,options});if(response instanceof Error)throw response;return response;}});
  return {close,requests,messages,get resets(){return resets;}};
}
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

test('closure requires current password and exact confirmation before any request or store reset',async()=>{
  const f=fixture(json(200,{status:200,message:'Closed'}));
  assert.equal((await f.close({password:'',confirmation:'DELETE'})).status,false);
  assert.equal((await f.close({password:'private-password',confirmation:'delete'})).status,false);
  assert.equal(f.requests.length,0);assert.equal(f.resets,0);
});

test('closure sends explicit credentials and clears all session stores only after accepted closure',async()=>{
  const deadline='2026-12-14T12:00:00.000Z';
  const f=fixture(json(200,{status:200,message:'Account closed for 30 days',purgeAfter:deadline}));
  const result=await f.close({password:'private-password',confirmation:'DELETE'});
  assert.equal(result.status,true);assert.equal(result.purgeAfter,deadline);assert.equal(f.resets,1);
  const request=f.requests[0];assert.equal(request.url,'/api/user/delete');assert.equal(request.options.method,'DELETE');
  assert.equal(request.options.headers['Content-Type'],'application/json');
  assert.deepEqual(JSON.parse(request.options.body),{password:'private-password',confirmation:'DELETE'});
  assert.ok(f.messages.every(item=>!item.message.includes('private-password')));
});

test('blocked last-admin closure keeps client identity and displays server reason',async()=>{
  const f=fixture(json(409,{status:409,message:'Transfer administration to another connected family admin first'}));
  const result=await f.close({password:'private-password',confirmation:'DELETE'});
  assert.equal(result.status,false);assert.equal(f.resets,0);
  assert.match(result.message,/Transfer administration/);assert.equal(f.messages[0].kind,'error');
});

test('failed or malformed closure responses do not falsely sign out or discard current data',async()=>{
  for(const response of [new Error('offline'),new Response('service unavailable',{status:503}),json(200,{status:409,message:'Account changed'})]){
    const f=fixture(response);const result=await f.close({password:'private-password',confirmation:'DELETE'});
    assert.equal(result.status,false);assert.equal(f.resets,0);
  }
});
