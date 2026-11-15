const test=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recipesafe-family-archive-tests-'));
const familyId='507f1f77bcf86cd799439001',adminA='507f1f77bcf86cd799439002',adminB='507f1f77bcf86cd799439003',guest='507f1f77bcf86cd799439004',orphan='507f1f77bcf86cd799439005',recipeA='507f1f77bcf86cd799439006',recipeB='507f1f77bcf86cd799439007';let api;
const shared=`const f=()=>globalThis.archiveFixture;const query=value=>({select(){return this},session:async()=>value,then(resolve,reject){return Promise.resolve(value).then(resolve,reject)}});const hydrate=doc=>doc?Object.assign(doc,{async save(){}}):null;`;
const mocks={
 'mongoose':`export default{isValidObjectId:id=>typeof id==='string'&&/^[a-f0-9]{24}$/i.test(id),async startSession(){return{async withTransaction(fn){const f=globalThis.archiveFixture;const before=JSON.stringify(f.data);try{await fn()}catch(e){f.data=JSON.parse(before);throw e}},async endSession(){}}}}`,
 '@/lib/auth/current-user':`export async function getCurrentUser(){const f=globalThis.archiveFixture;const u=f.data.users.find(u=>u._id===f.actorId);return u?{...u}:null}`,
 '@/lib/mongodb':`export default async function(){}`,
 'next/cache':`export function revalidatePath(){}`,
 '@/lib/security/rate-limit':`export async function consumeRateLimit(){return{allowed:true}}`,
 './utils':`export const getRevalidationPath=x=>x||'/';export async function verifyUserPassword(){return globalThis.archiveFixture.passwordOK}`,
 '@/models/family':shared+`export default{findOne(q){const fam=f().data.family;let allowed=fam&&fam._id===q._id;if(q.deletedAt===null)allowed=allowed&&!fam.deletedAt;else if(q.deletedAt?.$ne===null)allowed=allowed&&!!fam.deletedAt;if(q.restoreUntil?.$gt)allowed=allowed&&new Date(fam.restoreUntil)>q.restoreUntil.$gt;return query(allowed?hydrate(fam):null)},async create([data]){f().creates=(f().creates||0)+1;return[hydrate({_id:'507f1f77bcf86cd799439009',...data})]}}`,
 '@/models/user':shared+`function match(u,q){if(q.$and&&!q.$and.every(part=>match(u,part)))return false;if(q.$or&&!q.$or.some(part=>match(u,part)))return false;if(typeof q.accountStatus==='string'&&u.accountStatus!==q.accountStatus)return false;if(q.accountStatus?.$exists===false&&Object.hasOwn(u,'accountStatus'))return false;if(q._id&&typeof q._id==='string'&&u._id!==q._id)return false;if(q._id?.$in&&!q._id.$in.includes(u._id))return false;if('userFamilyID'in q&&u.userFamilyID!==q.userFamilyID)return false;if(q.emailVerifiedAt?.$ne===null&&!u.emailVerifiedAt)return false;return true}function update(u,op){if(op.$set)Object.assign(u,op.$set);if(op.$addToSet){for(const[k,v]of Object.entries(op.$addToSet)){u[k]??=[];if(!u[k].includes(v))u[k].push(v)}}}export default{findById(id){const user=f().data.users.find(u=>u._id===id);if(user&&f().freshUserOverrides)Object.assign(user,f().freshUserOverrides);return query(hydrate(user))},find(q){return query(f().data.users.filter(u=>match(u,q)).map(hydrate))},async updateOne(q,op){const u=f().data.users.find(u=>match(u,q));if(u)update(u,op);return{modifiedCount:u?1:0}},async updateMany(q,op){for(const u of f().data.users.filter(u=>match(u,q)))update(u,op)}}`,
 '@/models/recipe':shared+`function match(r,q){if(q._id?.$in&&!q._id.$in.includes(r._id))return false;if(q.originFamilyID&&r.originFamilyID!==q.originFamilyID)return false;if(q.secret?.$ne===true&&r.secret===true)return false;if(q.creatorID?.$in&&!q.creatorID.$in.includes(r.creatorID))return false;if(q.$or&&!q.$or.some(part=>match(r,part)))return false;return true}export default{find(q){return query(f().data.recipes.filter(r=>match(r,q)).map(hydrate))},async updateMany(q,op){for(const r of f().data.recipes.filter(r=>match(r,q)))Object.assign(r,op.$set)}}`,
 '@/models/invite':`export default{async deleteMany(){globalThis.archiveFixture.data.invites=[]}}`,
};
test.before(async()=>{const outfile=path.join(dir,'archive.cjs');await esbuild.build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`export * from './utils/server-actions/family/delete';export * from './utils/server-actions/family/create';`},outfile,bundle:true,platform:'node',format:'cjs',plugins:[{name:'offline-archive',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}))}}]});api=require(outfile)});
test.beforeEach(()=>{
 const users=[adminA,adminB,guest,orphan].map((id,i)=>({_id:id,email:`member${i}@example.invalid`,name:`Member ${i}`,emailVerifiedAt:'2026-01-01',sessionVersion:1,userFamilyID:familyId,recipeIDs:[]}));
 const family={_id:familyId,name:'Example Family',recipeIDs:[recipeA,recipeB],familyMembers:[{familyMemberID:adminA,permissionStatus:'Admin',memberConnected:true},{familyMemberID:adminB,permissionStatus:'Admin',memberConnected:true},{familyMemberID:guest,permissionStatus:'Guest',memberConnected:true}],deletedAt:null,heritage:[]};
 globalThis.archiveFixture={actorId:adminA,passwordOK:true,data:{family,users,recipes:[{_id:recipeA,creatorID:adminA,collectionOrigin:'family',originFamilyID:familyId,secret:true},{_id:recipeB,creatorID:adminB,collectionOrigin:'personal',originFamilyID:'',secret:true}],invites:[{token:'old'}]}};
});
test.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true,force:true})});
const archive=()=>api.DeleteFamily(familyId,'/family','password','Example Family');
test('any connected admin may archive a populated family, detach all linked users and retain/rehome creator recipes',async()=>{
 const f=globalThis.archiveFixture;f.actorId=adminB;const start=Date.now();const result=await archive();assert.equal(result.success,true);assert.ok(f.data.family.deletedAt);assert.ok(new Date(f.data.family.restoreUntil)>=start+29*24*60*60_000);assert.ok(new Date(f.data.family.restoreUntil)<=Date.now()+31*24*60*60_000);assert.equal(f.data.family.deletedByUserID,adminB);assert.ok(f.data.users.every(u=>u.userFamilyID===''));assert.equal(f.data.recipes.length,2);assert.equal(f.data.recipes[0].creatorID,adminA);assert.equal(f.data.recipes[0].collectionOrigin,'personal');assert.equal(f.data.recipes[0].originFamilyID,'');assert.ok(f.data.users.find(u=>u._id===adminA).recipeIDs.includes(recipeA));assert.ok(f.data.users.find(u=>u._id===adminB).recipeIDs.includes(recipeB));assert.deepEqual(f.data.invites,[]);
});
test('wrong password, wrong confirmation name and nonadmin actor cause no archive or detach',async()=>{
 const f=globalThis.archiveFixture;f.passwordOK=false;assert.equal((await archive()).success,false);f.passwordOK=true;assert.equal((await api.DeleteFamily(familyId,'/family','password','wrong')).success,false);f.actorId=guest;assert.equal((await archive()).success,false);assert.equal(f.data.family.deletedAt,null);assert.ok(f.data.users.every(u=>u.userFamilyID===familyId));assert.equal(f.data.recipes[0].collectionOrigin,'family');
});
test('only an unoccupied former connected admin may recover within retention; expired and nonadmin attempts fail',async()=>{
 const f=globalThis.archiveFixture;await archive();f.actorId=guest;assert.equal((await api.RestoreFamily(familyId,'password','Example Family')).success,false);f.actorId=adminA;f.data.family.restoreUntil=new Date(Date.now()-1);assert.equal((await api.RestoreFamily(familyId,'password','Example Family')).success,false);assert.ok(f.data.family.deletedAt);
});
test('recovery never steals users from another family and drops their private recipe links',async()=>{
 const f=globalThis.archiveFixture;await archive();f.data.users.find(u=>u._id===adminB).userFamilyID='different-family';const result=await api.RestoreFamily(familyId,'password','Example Family');assert.equal(result.success,true);assert.equal(f.data.family.deletedAt,null);assert.equal(f.data.family.restoreUntil,undefined);assert.equal(f.data.users.find(u=>u._id===adminB).userFamilyID,'different-family');assert.ok(!f.data.family.familyMembers.some(m=>m.familyMemberID===adminB));assert.deepEqual(f.data.family.recipeIDs,[recipeA]);assert.equal(f.data.recipes[0].collectionOrigin,'family');assert.equal(f.data.recipes[0].originFamilyID,familyId);assert.equal(f.data.recipes[1].collectionOrigin,'personal');
});
test('a former admin already in another family cannot recover or alter it',async()=>{
 const f=globalThis.archiveFixture;await archive();f.data.users.find(u=>u._id===adminA).userFamilyID='different-family';assert.equal((await api.RestoreFamily(familyId,'password','Example Family')).success,false);assert.ok(f.data.family.deletedAt);assert.ok(f.data.users.filter(u=>u._id!==adminA).every(u=>u.userFamilyID===''));
});

test('privacy or sharing changes while archived prevent private recipes from being re-shared on recovery',async()=>{
 const f=globalThis.archiveFixture;f.data.recipes[0].familySharingVersion=3;f.data.recipes[1].familySharingVersion=7;
 await archive();assert.deepEqual(f.data.family.familyRecipeShareVersions,[{recipeID:recipeA,version:3},{recipeID:recipeB,version:7}]);
 f.data.recipes[0].familySharingVersion=4;
 const result=await api.RestoreFamily(familyId,'password','Example Family');assert.equal(result.success,true);assert.deepEqual(f.data.family.recipeIDs,[recipeB]);assert.equal(f.data.recipes[0].collectionOrigin,'personal');assert.equal(f.data.recipes[0].originFamilyID,'');assert.equal(f.data.recipes[0].creatorID,adminA);assert.ok(f.data.users.find(u=>u._id===adminA).recipeIDs.includes(recipeA));
});
test('legacy archives without sharing-version snapshots do not restore private recipe visibility',async()=>{
 const f=globalThis.archiveFixture;await archive();delete f.data.family.familyRecipeShareVersions;
 assert.equal((await api.RestoreFamily(familyId,'password','Example Family')).success,true);assert.deepEqual(f.data.family.recipeIDs,[]);assert.ok(f.data.recipes.every(recipe=>recipe.collectionOrigin==='personal'));
});

test('a closure or session revocation after authentication blocks fresh family mutations',async()=>{
 const f=globalThis.archiveFixture;
 for(const accountStatus of ['deactivated','purging']){
  delete f.data.users.find(user=>user._id===adminA).accountStatus;
  f.freshUserOverrides={accountStatus};
  assert.equal((await archive()).success,false);
  assert.equal(f.data.family.deletedAt,null);
 }
 delete f.data.users.find(user=>user._id===adminA).accountStatus;
 f.freshUserOverrides={sessionVersion:2};
 assert.equal((await archive()).success,false);
 assert.equal(f.data.family.deletedAt,null);
});

test('archive recovery cannot reconnect closed members and their private recipes',async()=>{
 const f=globalThis.archiveFixture;await archive();
 f.data.users.find(user=>user._id===adminB).accountStatus='deactivated';
 f.data.users.find(user=>user._id===guest).accountStatus='purging';
 assert.equal((await api.RestoreFamily(familyId,'password','Example Family')).success,true);
 assert.deepEqual(f.data.family.familyMembers.map(member=>member.familyMemberID),[adminA]);
 assert.deepEqual(f.data.family.recipeIDs,[recipeA]);
 assert.equal(f.data.users.find(user=>user._id===adminB).userFamilyID,'');
 assert.equal(f.data.users.find(user=>user._id===guest).userFamilyID,'');
});

test('a former admin deactivated between authentication and restore cannot recover the family',async()=>{
 const f=globalThis.archiveFixture;await archive();
 f.freshUserOverrides={accountStatus:'deactivated'};
 assert.equal((await api.RestoreFamily(familyId,'password','Example Family')).success,false);
 assert.ok(f.data.family.deletedAt);
 assert.ok(f.data.users.every(user=>user.userFamilyID===''));
});

test('a closure after authentication prevents creating a new family with preserved identity',async(t)=>{
 t.mock.method(console,'error',()=>{});
 const f=globalThis.archiveFixture;const actor=f.data.users.find(user=>user._id===adminA);actor.userFamilyID='';
 for(const accountStatus of ['deactivated','purging']){
  delete actor.accountStatus;f.freshUserOverrides={accountStatus};
  const result=await api.CreateFamily({name:'New family'},'/family');
  assert.equal(result.success,false);assert.equal(result.family,null);
  assert.equal(f.creates||0,0);
  assert.equal(actor.userFamilyID,'');assert.equal(f.data.family._id,familyId);
 }
});
