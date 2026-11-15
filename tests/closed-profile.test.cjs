const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const {ObjectId}=require('mongodb');
const root=path.resolve(__dirname,'..');
const memberId='507f1f77bcf86cd799439002';

function load(file,dependencies){
  const output=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX},fileName:file,
  }).outputText;
  const module={exports:{}};
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`,{console:{error(){}}},{filename:file})(name=>{
    if(Object.hasOwn(dependencies,name))return dependencies[name];
    throw new Error('Unexpected live dependency: '+name);
  },module,module.exports);
  return module.exports;
}
function matches(user,query){
  if(query.$and&&!query.$and.every(part=>matches(user,part)))return false;
  if(query.$or&&!query.$or.some(part=>matches(user,part)))return false;
  if(query._id&&String(query._id)!==user._id)return false;
  if(typeof query.accountStatus==='string'&&query.accountStatus!==user.accountStatus)return false;
  if(query.accountStatus?.$exists===false&&Object.hasOwn(user,'accountStatus'))return false;
  return true;
}
function fixture(accountStatus){
  const member={_id:memberId,name:'Private Closed Profile',userFamilyID:'',communityIDs:[]};
  if(accountStatus!==undefined)member.accountStatus=accountStatus;
  let recipeReads=0;
  const policy=load('lib/auth/policy.ts',{});
  const api=load('app/(content)/view/member/[memberid]/page.tsx',{
    'react/jsx-runtime':require('react/jsx-runtime'),
    '@/components/wrappers/navWrapper':{__esModule:true,default:()=>null},
    '@/app/(content)/u/components/view-page':{__esModule:true,default:()=>null},
    '@/lib/mongodb':{__esModule:true,default:async()=>{}},
    '@/lib/metadata':{createPageMetadata:input=>input},
    '@/models/user':{__esModule:true,default:{findOne(query){return{select(){return this},lean:async()=>matches(member,query)?member:null};}}},
    '@/models/recipe':{__esModule:true,default:{find(){recipeReads++;return{limit(){return this},lean:async()=>[]};}}},
    '@/models/community':{__esModule:true,default:{find(){throw new Error('Unexpected community lookup');}}},
    '@/models/family':{__esModule:true,default:{findOne(){throw new Error('Unexpected family lookup');}}},
    '@/utils/data/seralize':{serializeDoc:value=>value},
    mongodb:{ObjectId},
    'next/navigation':{redirect:route=>{throw new Error('REDIRECT:'+route);}},
    '@/lib/data/user':{getSessionUser:async()=>({_id:'507f1f77bcf86cd799439003',communityIDs:[],userFamilyID:''})},
    '@/lib/features':{COMMUNITIES_ENABLED:false},
    '@/lib/family-policy':{connectedFamilyMember:()=>null},
    '@/lib/community-utils':{serializeCommunityForClient:value=>value},
    '@/lib/auth/policy':policy,
  });
  return{api,get recipeReads(){return recipeReads;}};
}
const request=()=>({params:Promise.resolve({memberid:memberId})});

test('closed profiles reveal neither profile metadata nor public recipes during recovery or purge',async()=>{
  for(const accountStatus of ['deactivated','purging']){
    const f=fixture(accountStatus);
    const metadata=await f.api.generateMetadata(request());
    assert.equal(metadata.title,'Public Profile');
    assert.ok(!JSON.stringify(metadata).includes('Private Closed Profile'));
    await assert.rejects(f.api.default(request()),/REDIRECT:\//);
    assert.equal(f.recipeReads,0);
  }
});

test('active profiles and legacy accounts without account status remain available',async()=>{
  for(const accountStatus of ['active',undefined]){
    const f=fixture(accountStatus);
    assert.match((await f.api.generateMetadata(request())).title,/Private Closed Profile/);
    assert.ok(await f.api.default(request()));
    assert.equal(f.recipeReads,1);
  }
});
