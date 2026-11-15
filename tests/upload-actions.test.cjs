const test=require('node:test');const assert=require('node:assert/strict');const esbuild=require('esbuild');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'recipesafe-upload-action-tests-'));
let router,create,cleanup;
const ownerID='507f1f77bcf86cd799439201',otherID='507f1f77bcf86cd799439202';
const file={key:'file-key',ufsUrl:'https://app.ufs.sh/f/file-key'};
const query=`const f=()=>globalThis.actionFixture;const query=run=>{let max;return{session(){return this},lean(){return this},sort(){return this},limit(value){max=value;return this},then(resolve,reject){return Promise.resolve().then(run).then(value=>Array.isArray(value)&&max!==undefined?value.slice(0,max):value).then(resolve,reject)}}};`;
const uploadModel=query+`
function matches(row,q){return row&&Object.entries(q).every(([k,v])=>v&&typeof v==='object'&&'$size'in v?row[k]?.length===v.$size:row[k]===v)}
function update(q,op){let row=f().data.uploads.find(row=>matches(row,q));let inserted=false;if(!row&&op.$setOnInsert){row=structuredClone(op.$setOnInsert);f().data.uploads.push(row);inserted=true}if(row&&op.$set)Object.assign(row,op.$set);return{row,inserted}}
export default{
 findOne(q){return query(()=>f().data.uploads.find(row=>matches(row,q))||null)},
 find(q){return query(()=>f().data.uploads.filter(row=>matches(row,q)))},
 async updateOne(q,op,options){f().ownership={filter:q,update:op,options};const result=update(q,op);return{modifiedCount:result.row?1:0,upsertedCount:result.inserted?1:0}},
 findOneAndUpdate(q,op){return query(()=>update(q,op).row||null)}
}`;
const mocks={
 'server-only':'',
 'mongoose':`export const Types={ObjectId:{isValid:id=>typeof id==='string' && /^[a-f0-9]{24}$/i.test(id)}};
 export default{async startSession(){return{async withTransaction(fn){const f=globalThis.actionFixture;const before=structuredClone(f.data);f.inTransaction=true;try{const result=await fn();if(f.retryAsPurging){delete f.retryAsPurging;f.data=before;f.data.users[0].accountStatus='purging';return await fn()}return result}catch(error){f.data=before;throw error}finally{f.inTransaction=false}},async endSession(){}}}};`,
 'uploadthing/next':`export function createUploadthing(){return ()=>({middleware(fn){return {onUploadComplete(callback){return {middleware:fn,onUploadComplete:callback}}}}})}`,
 'uploadthing/server':`export class UploadThingError extends Error{};export class UTApi{async deleteFiles(keys){const f=globalThis.actionFixture;f.storageCalls.push({keys,inTransaction:f.inTransaction});if(f.providerFails)throw new Error('provider failed');return{success:true,deletedCount:keys.length}}}`,
 '@/lib/auth/current-user':`export async function getCurrentUser(){return globalThis.actionFixture.user}`,
 '@/lib/mongodb':`export default async function connectDB(){}`,
 '@/lib/security/rate-limit':`export async function consumeRateLimit(){globalThis.actionFixture.quotaCalls++;return {allowed:!globalThis.actionFixture.quotaExceeded}}`,
 '@/models/upload':uploadModel,
 '@/models/user':query+`export default{findById(id){return query(()=>f().data.users.find(user=>user._id===id)||null)},async updateOne(q,op){if(f().failUserCAS)return{modifiedCount:0};const user=f().data.users.find(user=>user._id===q._id);if(user)for(const[k,v]of Object.entries(op.$inc||{}))user[k]=(user[k]||0)+v;return{modifiedCount:user?1:0}},async exists(q){f().avatarQuery=q;return f().avatarReference?{_id:'avatar'}:null}}`,
 '@/models/recipe':`export default{async exists(q){globalThis.actionFixture.recipeQuery=q;return globalThis.actionFixture.recipeReference?{_id:'recipe'}:null}}`,
 '@/models/post':`export default{async exists(){return globalThis.actionFixture.postReference?{_id:'post'}:null}}`,
 '@/models/family':`export default {async updateOne(filter,update){globalThis.actionFixture.familyLink={filter,update}}}`,
 '@/lib/recipe-mutations':`export async function createRecipeForUser(user,values){globalThis.actionFixture.created={user,values};return {_id:'recipe-new'}}`,
 './utils':`export async function getAuthenticatedUser(){return {user:globalThis.actionFixture.user,message:'Unauthorized'}}export const getRevalidationPath=x=>x;`,
 '../family/utils':`export async function getAuthenticatedFamilyContext(){return {user:globalThis.actionFixture.familyAllowed?globalThis.actionFixture.user:null,family:globalThis.actionFixture.familyAllowed?{_id:'family'}:null,message:'Unauthorized'}}`,
 '@/lib/family-mutations':`export const familyFailure=message=>({success:false,message,members:[]});export async function withFamilyMutation(id,fn){const f=globalThis.actionFixture;if(!f.familyAllowed)return familyFailure('Unauthorized');return fn({user:f.user,family:{recipeIDs:[],familyMembers:[],async save(){f.familyLink=this.recipeIDs}},member:{permissionStatus:f.role||'Member'},session:{}})}`, 'next/cache':`export function revalidatePath(){}`,
};
async function load(entry,name){const outfile=path.join(directory,name+'.cjs');await esbuild.build({entryPoints:[path.resolve(entry)],outfile,bundle:true,platform:'node',format:'cjs',plugins:[{name:'offline',setup(build){build.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));}}]});return require(outfile)}
test.before(async()=>{router=(await load('app/api/uploadthing/core.ts','upload')).ourFileRouter;create=(await load('utils/server-actions/recipe/create.ts','create')).CreateRecipe;cleanup=await load('lib/upload-callback-cleanup.ts','cleanup');});
test.beforeEach(()=>{globalThis.actionFixture={user:null,quotaCalls:0,familyAllowed:false,quotaExceeded:false,storageCalls:[],data:{users:[],uploads:[]}};});
test.after(()=>{assert.equal(path.dirname(directory),os.tmpdir());fs.rmSync(directory,{recursive:true,force:true});});
test('anonymous uploads fail before quota/storage work',async()=>{
 await assert.rejects(router.imageUploader.middleware({req:new Request('http://localhost')}),/Unauthorized/);
 assert.equal(globalThis.actionFixture.quotaCalls,0);assert.equal(globalThis.actionFixture.ownership,undefined);
});
test('verified upload identity is reserved with durable quota and persisted from server metadata',async()=>{
 const f=globalThis.actionFixture;f.user={_id:ownerID,emailVerifiedAt:'2026-01-01',accountStatus:'active'};f.data.users=[f.user];
 const metadata=await router.imageUploader.middleware({req:new Request('http://localhost')});
 assert.deepEqual(metadata,{userId:ownerID});assert.equal(globalThis.actionFixture.quotaCalls,1);
 await router.imageUploader.onUploadComplete({metadata,file});
 assert.equal(globalThis.actionFixture.ownership.update.$setOnInsert.ownerId,ownerID);
 assert.deepEqual(globalThis.actionFixture.ownership.update.$setOnInsert.recipeIds,[]);
 assert.equal(f.data.users[0].__v,1);assert.equal(f.data.uploads[0].state,'active');assert.equal(f.ownership.options.session!==undefined,true);
 assert.deepEqual(f.storageCalls,[]);
 globalThis.actionFixture.quotaExceeded=true;
 await assert.rejects(router.imageUploader.middleware({req:new Request('http://localhost')}),/Upload limit/);
});

const complete=()=>router.imageUploader.onUploadComplete({metadata:{userId:ownerID},file});
function persistentUser(overrides={}){const user={_id:ownerID,emailVerifiedAt:'2026-01-01',accountStatus:'active',...overrides};globalThis.actionFixture.data.users.push(user);return user}
function persistedUpload(overrides={}){const upload={key:file.key,url:file.ufsUrl,ownerId:ownerID,recipeIds:[],state:'active',...overrides};globalThis.actionFixture.data.uploads.push(upload);return upload}

test('upload completion uses fresh durable identity and accepts an account closed within its recovery period',async()=>{
 persistentUser({accountStatus:'deactivated',purgeAfter:new Date(Date.now()+60_000)});
 await complete();const f=globalThis.actionFixture;assert.equal(f.data.uploads[0].state,'active');assert.equal(f.data.users[0].__v,1);assert.deepEqual(f.storageCalls,[]);
});

for(const [name,account] of Object.entries({
 'missing account':null,
 'purging account':{accountStatus:'purging'},
 'expired closed account':{accountStatus:'deactivated',purgeAfter:new Date(0)},
 'unverified account':{emailVerifiedAt:null},
}))test(`a late completion for ${name} rejects and safely cleans the unowned provider file`,async()=>{
 if(account)persistentUser(account);await assert.rejects(complete(),/no longer accepts/);
 const f=globalThis.actionFixture;assert.equal(f.data.uploads[0].state,'deleted');assert.equal(f.data.uploads[0].ownerId,ownerID);
 assert.deepEqual(f.storageCalls,[{keys:[file.key],inTransaction:false}]);assert.ok(!f.data.uploads.some(upload=>upload.state==='active'));
});

test('a purge race retries with the current status and cannot leave a newly active orphan upload',async()=>{
 persistentUser();globalThis.actionFixture.retryAsPurging=true;await assert.rejects(complete(),/no longer accepts/);
 const f=globalThis.actionFixture;assert.equal(f.data.users[0].accountStatus,'purging');assert.equal(f.data.uploads[0].state,'deleted');assert.equal(f.storageCalls.length,1);
});

test('a current-account callback retry preserves transferred ownership and reservation state',async()=>{
 persistentUser();persistedUpload({ownerId:otherID,recipeIds:['transferred-recipe']});await complete();await complete();
 const f=globalThis.actionFixture;assert.equal(f.data.uploads[0].ownerId,otherID);assert.deepEqual(f.data.uploads[0].recipeIds,['transferred-recipe']);assert.deepEqual(f.storageCalls,[]);
});

test('a purged creator callback never resets or deletes an upload already transferred to another owner',async()=>{
 persistedUpload({ownerId:otherID,recipeIds:['transferred-recipe']});await assert.rejects(complete(),/no longer accepts/);
 const f=globalThis.actionFixture;assert.equal(f.data.uploads[0].ownerId,otherID);assert.equal(f.data.uploads[0].state,'active');assert.deepEqual(f.storageCalls,[]);
});

for(const state of ['active','retained','deleted'])test(`late callbacks preserve existing ${state} upload records without resurrection`,async()=>{
 persistedUpload({state});await assert.rejects(complete(),/no longer accepts/);const f=globalThis.actionFixture;
 assert.equal(f.data.uploads[0].state,state);assert.deepEqual(f.storageCalls,[]);
});

for(const reference of ['recipeReference','avatarReference','postReference'])test(`a rejected late callback retains its file when ${reference} exists`,async()=>{
 const f=globalThis.actionFixture;f[reference]=true;await assert.rejects(complete(),/no longer accepts/);
 assert.equal(f.data.uploads[0].state,'retained');assert.deepEqual(f.storageCalls,[]);
 assert.ok(f.recipeQuery.$or.some(clause=>Object.hasOwn(clause,'steps.image')));
});

test('a deleting upload with reservations is never deleted by completion cleanup',async()=>{
 persistedUpload({state:'deleting',recipeIds:['existing-recipe']});await assert.rejects(complete(),/no longer accepts/);
 assert.deepEqual(globalThis.actionFixture.storageCalls,[]);assert.equal(globalThis.actionFixture.data.uploads[0].state,'deleting');
});

test('provider failure leaves a retryable tombstone; retry finishes cleanup outside the transaction',async()=>{
 const f=globalThis.actionFixture;f.providerFails=true;await assert.rejects(complete(),/provider failed/);assert.equal(f.data.uploads[0].state,'deleting');
 f.providerFails=false;await assert.rejects(complete(),/no longer accepts/);assert.equal(f.data.uploads[0].state,'deleted');
 assert.equal(f.storageCalls.length,2);assert.ok(f.storageCalls.every(call=>!call.inTransaction));
});

test('an inconclusive account transaction failure does not delete provider files or record active ownership',async()=>{
 persistentUser();const f=globalThis.actionFixture;f.failUserCAS=true;await assert.rejects(complete(),/Account changed/);
 assert.deepEqual(f.data.uploads,[]);assert.deepEqual(f.storageCalls,[]);
});

test('cron retries failed rejected callbacks after their account has gone without another provider callback',async()=>{
 const f=globalThis.actionFixture;f.providerFails=true;await assert.rejects(complete(),/provider failed/);
 assert.equal(f.data.uploads[0].cleanupReason,'rejected-callback');f.providerFails=false;
 assert.deepEqual(await cleanup.retryRejectedUploadCleanup(),{attempted:1,deleted:1,retained:0,failed:0});assert.equal(f.data.uploads[0].state,'deleted');
});

test('cron selects only rejected callback deletion intents and retains references',async()=>{
 persistedUpload({key:'other-owner-file',ownerId:otherID,state:'active'});
 persistedUpload({key:'user-initiated-delete',state:'deleting'});
 persistedUpload({key:'retained-file',state:'retained',cleanupReason:'rejected-callback'});
 persistedUpload({key:'rejected-file',state:'deleting',cleanupReason:'rejected-callback'});
 const f=globalThis.actionFixture;f.recipeReference=true;
 assert.deepEqual(await cleanup.retryRejectedUploadCleanup(),{attempted:1,deleted:0,retained:1,failed:0});assert.deepEqual(f.storageCalls,[]);
 assert.equal(f.data.uploads.find(upload=>upload.key==='user-initiated-delete').state,'deleting');
});

test('cron records failures and limits each run to 25 verified deletion intents',async()=>{
 const f=globalThis.actionFixture;for(let i=0;i<30;i++)persistedUpload({key:'rejected-'+i,state:'deleting',cleanupReason:'rejected-callback'});
 f.providerFails=true;assert.deepEqual(await cleanup.retryRejectedUploadCleanup(),{attempted:25,deleted:0,retained:0,failed:25});
 assert.equal(f.storageCalls.length,25);assert.ok(f.data.uploads.slice(0,25).every(upload=>upload.cleanupAttemptedAt));
});
test('create from family validates membership before create and links only authorized family',async()=>{
 globalThis.actionFixture.user={_id:'owner'};
 assert.equal((await create({name:'Recipe'},'/family','forged-family')).success,false);
 assert.equal(globalThis.actionFixture.created,undefined);assert.equal(globalThis.actionFixture.familyLink,undefined);
 globalThis.actionFixture.familyAllowed=true;
 const result=await create({name:'Recipe'},'/family','family');
 assert.equal(result.success,true);assert.equal(result.recipeId,'recipe-new');
 assert.deepEqual(globalThis.actionFixture.familyLink,['recipe-new']);
});

