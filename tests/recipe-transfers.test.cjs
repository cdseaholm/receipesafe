const test = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recipesafe-transfer-tests-'));
const ownerID='507f1f77bcf86cd799439101', adminID='507f1f77bcf86cd799439102', otherID='507f1f77bcf86cd799439103';
const recipeID='507f1f77bcf86cd799439104', familyID='507f1f77bcf86cd799439105', otherFamily='507f1f77bcf86cd799439106';
let api;

// Exercise the real transaction service with isolated query/update fixtures, never a live database/provider.
const database = `
const fixture=()=>globalThis.transferFixture;
function same(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function match(row,query){
 return row&&Object.entries(query).every(([key,value])=>{
  if(key==='$or')return value.some(part=>match(row,part));
  if(key==='$and')return value.every(part=>match(row,part));
  const actual=key.includes('.')?key.split('.').reduce((value,part)=>Array.isArray(value)?value.map(item=>item?.[part]):value?.[part],row):row[key];
  if(value instanceof RegExp)return Array.isArray(actual)?actual.some(item=>typeof item==='string'&&value.test(item)):typeof actual==='string'&&value.test(actual);
  if(value&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof Date))return Object.entries(value).every(([op,v])=>{
   if(op==='$in')return v.includes(actual);if(op==='$ne')return actual!==v;
   if(op==='$exists')return (actual!==undefined)===v;
   if(op==='$lte')return new Date(actual)<=new Date(v);if(op==='$gt')return new Date(actual)>new Date(v);
   return false;
  });
  return value===null?actual==null:Array.isArray(actual)&&!Array.isArray(value)?actual.includes(value):same(actual,value);
 });
}
function apply(row,op){
 if(op.$set)Object.assign(row,op.$set);
 for(const[k,v]of Object.entries(op.$inc||{}))row[k]=(row[k]||0)+v;
 for(const[k,v]of Object.entries(op.$pull||{}))row[k]=(row[k]||[]).filter(item=>item!==v);
 for(const[k,v]of Object.entries(op.$addToSet||{})){row[k]??=[];if(!row[k].includes(v))row[k].push(v)}
}
function query(run){let lean=false;return {select(){return this},session(){return this},sort(){return this},limit(){return this},lean(){lean=true;return this},then(resolve,reject){return Promise.resolve().then(run).then(value=>lean?structuredClone(value):value).then(resolve,reject)}}}
export function model(collection){return{
 findById(id){return query(()=>fixture().data[collection].find(row=>row._id===id)||null)},
 findOne(q){return query(()=>fixture().data[collection].find(row=>match(row,q))||null)},
 find(q){return query(()=>fixture().data[collection].filter(row=>match(row,q)))},
 exists(q){return query(()=>fixture().data[collection].find(row=>match(row,q))?{_id:'exists'}:null)},
 async updateOne(q,op){
  if(fixture().failCAS===collection&&((collection==='recipes'&&op.$set?.creatorID)||collection==='uploads'||collection==='transfers'))return{modifiedCount:0};
  const row=fixture().data[collection].find(row=>match(row,q));if(row)apply(row,op);return{modifiedCount:row?1:0};
 },
 async updateMany(q,op){for(const row of fixture().data[collection].filter(row=>match(row,q)))apply(row,op)},
 async create(records){
  if(collection==='transfers'&&fixture().data.transfers.some(old=>old.status==='pending'&&old.recipeID===records[0].recipeID))throw Object.assign(new Error('duplicate'),{code:11000});
  return records.map(record=>{const row={...record,_id:'507f1f77bcf86cd7994391'+String(20+fixture().data[collection].length).padStart(2,'0'),createdAt:new Date()};fixture().data[collection].push(row);return row});
 }
}};
`;
const mocks = {
 'server-only': '',
 'mongoose': `export default {async startSession(){return{async withTransaction(fn){const before=structuredClone(globalThis.transferFixture.data);try{return await fn()}catch(error){globalThis.transferFixture.data=before;throw error}},async endSession(){}}}}`,
 '@/lib/mongodb': 'export default async function(){}',
 '@/lib/auth/password': 'export async function verifyCurrentPassword(){return globalThis.transferFixture.passwordOK}',
 '@/lib/security/rate-limit': 'export async function consumeRateLimit(){return {allowed:globalThis.transferFixture.allowed}}',
};
for(const [name,collection] of Object.entries({user:'users',family:'families',recipe:'recipes',upload:'uploads','recipe-transfer':'transfers'}))mocks[`@/models/${name}`]=`import {model} from 'fixture-database';export default model('${collection}')`;
test.before(async()=>{
 const outfile=path.join(directory,'transfers.cjs');
 await esbuild.build({entryPoints:[path.resolve('lib/recipe-transfers.ts')],outfile,bundle:true,platform:'node',format:'cjs',plugins:[{name:'offline-transfers',setup(build){
  build.onResolve({filter:/.*/},args=>args.path==='fixture-database'||Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);
  build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='fixture-database'?database:mocks[args.path],loader:'js'}));
 }}]});
 api=require(outfile);
});
function reset(){
 const users=[ownerID,adminID,otherID].map((id,i)=>({_id:id,name:`Member ${i}`,emailVerifiedAt:'2026-01-01',accountStatus:'active',sessionVersion:1,userFamilyID:familyID,recipeIDs:i===0?[recipeID]:[],profileImage:''}));
 const family={_id:familyID,deletedAt:null,recipeIDs:[recipeID],familyMembers:users.map(user=>({familyMemberID:user._id,memberConnected:true,permissionStatus:user._id===adminID?'Admin':'Member'}))};
 globalThis.transferFixture={passwordOK:true,allowed:true,data:{users,families:[family],recipes:[{_id:recipeID,name:'Family stew',creatorID:ownerID,secret:true,secretViewerIDs:[],familySharingVersion:3,__v:4,image:'',imageKey:''}],uploads:[],transfers:[]}};
}
test.beforeEach(reset);
test.after(()=>{assert.equal(path.dirname(directory),os.tmpdir());fs.rmSync(directory,{recursive:true,force:true})});
const data=()=>globalThis.transferFixture.data;
const user=id=>data().users.find(row=>row._id===id);
const actor=id=>({...user(id)});
const offer=()=>api.offerRecipeTransfer(actor(ownerID),{recipeID,toUserID:adminID,password:'correct password'});
const respond=(id,action,transferID=data().transfers[0]?._id)=>api.respondRecipeTransfer(actor(id),{transferID,action});
function image(){
 Object.assign(data().recipes[0],{image:'https://app.ufs.sh/f/owned-file',imageKey:'owned-file'});
 data().uploads.push({key:'owned-file',url:'https://app.ufs.sh/f/owned-file',ownerId:ownerID,recipeIds:[recipeID],state:'active'});
}

test('a password-confirmed offer keeps ownership until the chosen admin explicitly accepts',async()=>{
 const start=Date.now();await offer();const pending=data().transfers[0];
 assert.equal(pending.status,'pending');assert.equal(pending.fromUserID,ownerID);assert.equal(pending.toUserID,adminID);assert.equal(pending.familyID,familyID);
 assert.ok(new Date(pending.expiresAt).getTime()>=start+7*24*60*60_000);assert.equal(data().recipes[0].creatorID,ownerID);assert.equal(pending.recipeVersion,5);assert.equal(pending.sharingVersion,3);
 await assert.rejects(respond(otherID,'accept'),/not found/);
 await respond(adminID,'accept');assert.equal(data().transfers[0].status,'accepted');assert.equal(data().recipes[0].creatorID,adminID);
 assert.deepEqual(user(ownerID).recipeIDs,[]);assert.deepEqual(user(adminID).recipeIDs,[recipeID]);assert.deepEqual(data().families[0].recipeIDs,[recipeID]);
 assert.equal(data().recipes[0].collectionOrigin,'family');assert.equal(data().recipes[0].originFamilyID,familyID);assert.equal(data().recipes[0].familySharingVersion,4);
 await assert.rejects(respond(adminID,'accept'),/resolved/);assert.deepEqual(user(adminID).recipeIDs,[recipeID]);
});

test('an exclusive recipe image follows its recipe without provider calls or loss of ownership',async()=>{
 image();await offer();await respond(adminID,'accept');assert.equal(data().uploads[0].ownerId,adminID);assert.deepEqual(data().uploads[0].recipeIds,[recipeID]);
});

test('an outstanding offer survives source closure only during recovery; accepted ownership stays after recovery',async()=>{
 await offer();Object.assign(user(ownerID),{accountStatus:'deactivated',userFamilyID:'',purgeAfter:new Date(Date.now()+30*24*60*60_000),sessionVersion:2});
 data().families[0].familyMembers=data().families[0].familyMembers.filter(member=>member.familyMemberID!==ownerID);
 await respond(adminID,'accept');Object.assign(user(ownerID),{accountStatus:'active',userFamilyID:''});
 assert.equal(data().recipes[0].creatorID,adminID);assert.deepEqual(user(ownerID).recipeIDs,[]);
});

test('offers require password confirmation and budget before recording any pending transfer',async()=>{
 globalThis.transferFixture.passwordOK=false;await assert.rejects(offer(),/password/);assert.deepEqual(data().transfers,[]);
 globalThis.transferFixture.passwordOK=true;globalThis.transferFixture.allowed=false;await assert.rejects(offer(),/wait/);assert.deepEqual(data().transfers,[]);
 await assert.rejects(api.offerRecipeTransfer(actor(ownerID),{recipeID,toUserID:ownerID,password:'correct'}),/different family admin/);
});

for(const [name,alter] of Object.entries({
 'unshared private recipe':()=>{data().families[0].recipeIDs=[]},
 'someone else’s recipe':()=>{data().recipes[0].creatorID=otherID},
 'disconnected creator':()=>{data().families[0].familyMembers[0].memberConnected=false},
 'archived family':()=>{data().families[0].deletedAt=new Date()},
 'member rather than admin':()=>{data().families[0].familyMembers[1].permissionStatus='Member'},
 'disconnected recipient':()=>{data().families[0].familyMembers[1].memberConnected=false},
 'unverified recipient':()=>{user(adminID).emailVerifiedAt=null},
 'deactivated recipient':()=>{user(adminID).accountStatus='deactivated'},
 'recipient in another family':()=>{user(adminID).userFamilyID=otherFamily},
 'deactivated creator':()=>{user(ownerID).accountStatus='deactivated'},
}))test(`offer rejects ${name}`,async()=>{alter();await assert.rejects(offer());assert.deepEqual(data().transfers,[])});

for(const [name,alter] of Object.entries({
 'edited recipe':()=>{data().recipes[0].__v++},
 'changed privacy':()=>{data().recipes[0].familySharingVersion++},
 'removed family link':()=>{data().families[0].recipeIDs=[]},
 'changed creator':()=>{data().recipes[0].creatorID=otherID},
 'recipient demoted':()=>{data().families[0].familyMembers[1].permissionStatus='Member'},
 'recipient disconnected':()=>{data().families[0].familyMembers[1].memberConnected=false},
 'recipient unverified':()=>{user(adminID).emailVerifiedAt=null},
 'archived family':()=>{data().families[0].deletedAt=new Date()},
 'creator changed families':()=>{user(ownerID).userFamilyID=otherFamily},
 'creator recovered without rejoining':()=>{user(ownerID).userFamilyID=''},
 'creator purging':()=>{user(ownerID).accountStatus='purging'},
 'creator past recovery deadline':()=>{Object.assign(user(ownerID),{accountStatus:'deactivated',purgeAfter:new Date(Date.now()-1)})},
 'expired offer':()=>{data().transfers[0].expiresAt=new Date(Date.now()-1)},
}))test(`acceptance rechecks ${name}`,async()=>{await offer();alter();const before=structuredClone(data());await assert.rejects(respond(adminID,'accept'));assert.deepEqual(data(),before)});

test('a stale session cannot offer or accept even if its user ID matches',async()=>{
 const staleOwner=actor(ownerID);user(ownerID).sessionVersion++;await assert.rejects(api.offerRecipeTransfer(staleOwner,{recipeID,toUserID:adminID,password:'correct'}),/session/);
 await offer();const staleAdmin=actor(adminID);user(adminID).sessionVersion++;await assert.rejects(api.respondRecipeTransfer(staleAdmin,{transferID:data().transfers[0]._id,action:'accept'}),/session/);
 assert.equal(data().recipes[0].creatorID,ownerID);
});

for(const [name,alter] of Object.entries({
 'another reservation':()=>{data().uploads[0].recipeIds.push('other-recipe')},
 'another recipe URL':()=>{data().recipes.push({_id:'other-recipe',creatorID:ownerID,image:data().uploads[0].url})},
 'an avatar':()=>{user(otherID).profileImage=data().uploads[0].url},
 'a signed legacy avatar URL':()=>{user(otherID).profileImage=data().uploads[0].url+'?download=1'},
 'another recipe step image':()=>{data().recipes.push({_id:'other-recipe',creatorID:ownerID,steps:[{image:data().uploads[0].url}]})},
 'unknown legacy image':()=>{data().uploads=[]},
 'deleting image':()=>{data().uploads[0].state='deleting'},
}))test(`shared or unverified image with ${name} cannot change owner`,async()=>{
 image();await offer();alter();const before=structuredClone(data());await assert.rejects(respond(adminID,'accept'),/image/);assert.deepEqual(data(),before);
 reset();image();alter();await assert.rejects(offer(),/image/);assert.equal(data().transfers.length,0);
});

for(const collection of ['uploads','recipes','transfers'])test(`a failed ${collection} ownership compare-and-set rolls back the entire acceptance`,async()=>{
 image();await offer();const before=structuredClone(data());globalThis.transferFixture.failCAS=collection;
 await assert.rejects(respond(adminID,'accept'));assert.deepEqual(data(),before);
});

test('only the sender cancels and only the chosen recipient declines; neither changes ownership',async()=>{
 await offer();await assert.rejects(respond(otherID,'cancel'),/not found/);await assert.rejects(respond(ownerID,'decline'),/not found/);
 await respond(ownerID,'cancel');assert.equal(data().transfers[0].status,'cancelled');assert.equal(data().recipes[0].creatorID,ownerID);
 await offer();await respond(adminID,'decline',data().transfers[1]._id);assert.equal(data().transfers[1].status,'declined');assert.equal(data().recipes[0].creatorID,ownerID);
});

test('a pending recipe has one offer; expired offers may be replaced without erasing the receipt',async()=>{
 await offer();await assert.rejects(offer(),/existing offer/);assert.equal(data().transfers.length,1);
 data().transfers[0].expiresAt=new Date(Date.now()-1);await offer();assert.equal(data().transfers[0].status,'expired');assert.equal(data().transfers[1].status,'pending');
});

test('listing exposes own eligible recipes/admins and hides recipe names after family visibility is removed',async()=>{
 await offer();let result=await api.listRecipeTransfers(actor(ownerID));assert.equal(result.recipes[0].id,recipeID);assert.equal(result.admins[0].id,adminID);
 result=await api.listRecipeTransfers(actor(adminID));assert.equal(result.offers[0].direction,'incoming');assert.equal(result.offers[0].recipeName,'Family stew');
 data().families[0].recipeIDs=[];result=await api.listRecipeTransfers(actor(adminID));assert.equal(result.offers[0].recipeName,'Recipe no longer available');
});

test('separate step images block transfer; a step using the exclusive main image follows its new owner',async()=>{
 data().recipes[0].steps=[{image:'https://app.ufs.sh/f/unknown-step-file'}];await assert.rejects(offer(),/step images/);
 reset();image();data().recipes[0].steps=[{image:data().uploads[0].url}];await offer();await respond(adminID,'accept');assert.equal(data().uploads[0].ownerId,adminID);
});
