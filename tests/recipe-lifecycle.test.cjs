const test=require('node:test');const assert=require('node:assert/strict');const esbuild=require('esbuild');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'recipesafe-recipe-lifecycle-'));
const owner='507f191e810c19729de860ea', other='507f191e810c19729de860eb', id='507f1f77bcf86cd799439011';let api;
const match=(doc,q)=>Object.entries(q).every(([key,value])=>{
 if(key==='$or')return value.some(part=>match(doc,part));if(key==='$and')return value.every(part=>match(doc,part));
 if(value&&typeof value==='object'&&!(value instanceof Date))return Object.entries(value).every(([op,v])=>{
  if(op==='$in')return v.includes(doc[key]);if(op==='$exists')return (doc[key]!==undefined)===v;
  if(op==='$ne')return v===null?doc[key]!==undefined&&doc[key]!==null:doc[key]!==v;
  throw new Error('Unsupported fixture query '+op);
 });return String(doc[key])===String(value);
});
const fixtureHelpers=`const f=()=>globalThis.lifecycle;const match=${match.toString()};function chain(doc){return {select(){return this},session(value){f().readSessions.push(value);return this},lean:async()=>structuredClone(doc),then(resolve,reject){return Promise.resolve(doc).then(resolve,reject)}}}function record(options){f().writeSessions.push(options?.session)}`;
const mocks={
 '@/lib/security/rate-limit':`export async function consumeRateLimit(key,policy){globalThis.lifecycle.limitCalls.push({key,policy});return {allowed:globalThis.lifecycle.limitAllowed}}`,
 'mongoose':`export const Types={ObjectId:class{toString(){return '507f1f77bcf86cd799439011'}static isValid(id){return typeof id==='string' && /^[a-f0-9]{24}$/i.test(id)}}};export default{async startSession(){const f=globalThis.lifecycle;f.startedTransactions++;return{marker:'owned',async withTransaction(fn){const keys=['recipes','accounts','userUpdates','cleanup','releases','reservations','ingredients'];const before=structuredClone(Object.fromEntries(keys.map(key=>[key,f[key]])));f.transactionOpen=true;f.events.push('begin');try{const result=await fn();if(f.failCommit)throw new Error('Commit failed');f.transactionOpen=false;f.events.push('commit');return result}catch(error){Object.assign(f,before);f.afterRollback?.();f.transactionOpen=false;f.events.push('rollback');throw error}},async endSession(){f.endedTransactions++}}}};`,
 '@/models/recipe':`${fixtureHelpers}export default{async create(values,options){record(options);f().recipes.push(...values);return values},findOne:q=>chain(f().recipes.find(doc=>match(doc,q))),find:q=>chain(f().recipes.filter(doc=>match(doc,q))),async findOneAndUpdate(q,u,options){record(options);f().beforeRecipeWrite?.();const doc=f().recipes.find(doc=>match(doc,q));if(doc){Object.assign(doc,u.$set);for(const [key,value]of Object.entries(u.$inc||{}))doc[key]=(doc[key]||0)+value}return doc},async deleteMany(q,options){record(options);f().beforeRecipeWrite?.();const count=f().recipes.length;f().recipes=f().recipes.filter(doc=>!match(doc,q));return {deletedCount:count-f().recipes.length}}};`,
 '@/models/ingredient':`${fixtureHelpers}export default{findById:()=>chain(null),findOne:()=>chain(null),async create(values,options){record(options);const docs=values.map(v=>({_id:'ingredient-id',...v}));f().ingredients.push(...docs);return docs}};`,
 '@/models/user':`${fixtureHelpers}export default{findById:id=>chain(f().accounts.find(user=>user._id===id)||null),find:q=>chain(f().verifiedUsers.filter(user=>match(user,q))),async updateOne(q,u,options){record(options);f().beforeUserWrite?.();const user=f().accounts.find(user=>match(user,q));if(!user)return {modifiedCount:0};f().userUpdates.push({q,u});if(u.$inc)for(const[k,v]of Object.entries(u.$inc))user[k]=(user[k]||0)+v;return {modifiedCount:1}},async updateMany(q,u,options){record(options);f().cleanup.push({model:'User',q,u})}};`,
 '@/models/family':`${fixtureHelpers}export default{async updateMany(q,u,options){record(options);f().cleanup.push({model:'Family',q,u})}};`,
 '@/models/community':`${fixtureHelpers}export default{async updateMany(q,u,options){record(options);f().cleanup.push({model:'Community',q,u})}};`,
 '@/models/post':`${fixtureHelpers}export default{find:()=>chain([]),async deleteMany(q,options){record(options)}};`,
 '@/lib/upload-ownership':`export async function claimRecipeImage(owner,id,value,existing,session){const f=globalThis.lifecycle;f.writeSessions.push(session);if(value.imageKey==='forged-key')throw new Error('Choose an image uploaded by your account');f.reservations.push({owner,id,key:value.imageKey||''});return {image:value.image||'',imageKey:value.imageKey||''}}export async function releaseRecipeImage(key,id,session){globalThis.lifecycle.writeSessions.push(session);globalThis.lifecycle.releases.push({key,id})}export async function deleteOwnedUploads(keys,owner){const f=globalThis.lifecycle;f.events.push('storage');f.deleted.push({keys,owner,inTransaction:f.transactionOpen})}`,
};
test.before(async()=>{const outfile=path.join(directory,'mutations.cjs');await esbuild.build({entryPoints:[path.resolve('lib/recipe-mutations.ts')],outfile,bundle:true,platform:'node',format:'cjs',plugins:[{name:'offline',setup(build){build.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));}}]});api=require(outfile)});
test.beforeEach(()=>{globalThis.lifecycle={recipes:[],accounts:[{_id:owner,emailVerifiedAt:new Date(),sessionVersion:2},{_id:other,emailVerifiedAt:new Date(),sessionVersion:2}],verifiedUsers:[],userUpdates:[],cleanup:[],releases:[],reservations:[],ingredients:[],deleted:[],limitAllowed:true,limitCalls:[],writeSessions:[],readSessions:[],startedTransactions:0,endedTransactions:0,events:[],transactionOpen:false}});
test.after(()=>{assert.equal(path.dirname(directory),os.tmpdir());fs.rmSync(directory,{recursive:true,force:true})});
const input={name:'Example recipe',description:'Description',ingredients:[],steps:[],image:'',imageKey:'',recipeFor:['personal'],secret:false,secretViewerIDs:[]};
const actor=(_id=owner)=>({_id,sessionVersion:2});
test('family and personal creations always retain canonical creator collection and origin metadata',async()=>{
 const recipe=await api.createRecipeForUser(actor(),{...input,creatorID:other,favoriteCount:999,collectionOrigin:'personal',originFamilyID:'forged',familySharingVersion:999},'family-id');
 assert.equal(recipe.creatorID,owner);assert.equal(recipe.collectionOrigin,'family');assert.equal(recipe.originFamilyID,'family-id');assert.equal(recipe.favoriteCount,0);assert.equal(recipe.familySharingVersion,0);
 assert.deepEqual(globalThis.lifecycle.userUpdates.find(update=>update.u.$addToSet),{q:{_id:owner},u:{$addToSet:{recipeIDs:id}}});
 const personal=await api.createRecipeForUser(actor(),{...input,collectionOrigin:'family',originFamilyID:'forged'});
 assert.equal(personal.collectionOrigin,'personal');assert.equal(personal.originFamilyID,'');
});
test('viewer emails resolve only to verified immutable users; invalid payloads fail before creation',async()=>{
 globalThis.lifecycle.verifiedUsers=[{_id:other,email:'viewer@example.invalid',emailVerifiedAt:new Date()}];
 const recipe=await api.createRecipeForUser(actor(),{...input,secret:true,secretViewerIDs:['VIEWER@EXAMPLE.INVALID']});
 assert.deepEqual(recipe.secretViewerIDs,[other]);
 await assert.rejects(api.createRecipeForUser(actor(),{...input,secret:true,secretViewerIDs:['unknown@example.invalid']}),/verified RecipeSafe/);
 await assert.rejects(api.createRecipeForUser(actor(),{...input,ingredients:[{ingredient:{$ne:null},quantity:'1'}]}));
 await assert.rejects(api.createRecipeForUser(actor(),{...input,secret:'true'}));
 await assert.rejects(api.createRecipeForUser(actor(),{...input,image:'https://app.ufs.sh/f/forged-key',imageKey:'forged-key'}));
 assert.equal(globalThis.lifecycle.recipes.length,1);
});
test('only owners can edit/delete; updates preserve creator/origin/counters and deletion cleans shared references',async()=>{
 globalThis.lifecycle.recipes=[{...input,_id:id,creatorID:owner,collectionOrigin:'family',originFamilyID:'family-id',favoriteCount:3,image:'https://app.ufs.sh/f/owned-key',imageKey:'owned-key'}];
 await assert.rejects(api.updateRecipeForUser(actor(other),id,input),/creator/);
 await assert.rejects(api.deleteRecipesForUser(actor(other),[id]),/created/);
 assert.equal(globalThis.lifecycle.cleanup.length,0);
 const recipe=await api.updateRecipeForUser(actor(),id,{...input,name:'Edited',creatorID:other,collectionOrigin:'personal',favoriteCount:999});
 assert.equal(recipe.creatorID,owner);assert.equal(recipe.collectionOrigin,'family');assert.equal(recipe.favoriteCount,3);
 await api.deleteRecipesForUser(actor(),[id]);assert.equal(globalThis.lifecycle.recipes.length,0);
 assert.deepEqual(globalThis.lifecycle.cleanup.map(x=>x.model).sort(),['Community','Family','User']);
 assert.ok(globalThis.lifecycle.cleanup.find(x=>x.model==='User').u.$pull.recipeIDs.$in.includes(id));
});

test('family sharing version changes only with privacy, ignoring client versions and viewer order',async()=>{
 globalThis.lifecycle.verifiedUsers=[{_id:owner,email:'owner@example.invalid',emailVerifiedAt:new Date()},{_id:other,email:'viewer@example.invalid',emailVerifiedAt:new Date()}];
 globalThis.lifecycle.recipes=[{...input,_id:id,creatorID:owner,secret:true,secretViewerIDs:[owner,other],familySharingVersion:4,__v:0}];
 const unchanged=await api.updateRecipeForUser(actor(),id,{...input,secret:true,secretViewerIDs:[other,owner],name:'New title',familySharingVersion:10000});
 assert.equal(unchanged.familySharingVersion,4);assert.equal(unchanged.__v,1);
 const changed=await api.updateRecipeForUser(actor(),id,{...input,secret:true,secretViewerIDs:[owner],familySharingVersion:-1});
 assert.equal(changed.familySharingVersion,5);
 const madePublic=await api.updateRecipeForUser(actor(),id,{...input,secret:false,familySharingVersion:0});
 assert.equal(madePublic.familySharingVersion,6);
});

test('shared mutation budgets reject create/update/delete before application database or storage writes',async()=>{
 globalThis.lifecycle.limitAllowed=false;
 await assert.rejects(api.createRecipeForUser(actor(),input),/limit reached/);
 await assert.rejects(api.updateRecipeForUser(actor(),id,input),/limit reached/);
 await assert.rejects(api.deleteRecipesForUser(actor(),[id]),/limit reached/);
 assert.deepEqual(globalThis.lifecycle.recipes,[]);assert.deepEqual(globalThis.lifecycle.userUpdates,[]);
 assert.deepEqual(globalThis.lifecycle.cleanup,[]);assert.deepEqual(globalThis.lifecycle.releases,[]);assert.deepEqual(globalThis.lifecycle.deleted,[]);
 assert.deepEqual(globalThis.lifecycle.limitCalls.map(call=>call.policy),[{limit:60,windowMs:3600000},{limit:60,windowMs:60000},{limit:20,windowMs:60000}]);
});

test('closed, unverified and session-revoked owners cannot create, edit or delete recipes',async()=>{
 const f=globalThis.lifecycle;
 for(const state of [{accountStatus:'deactivated'},{accountStatus:'purging'},{emailVerifiedAt:null},{sessionVersion:3}]){
  f.accounts=[{_id:owner,emailVerifiedAt:new Date(),sessionVersion:2,...state}];f.recipes=[{...input,_id:id,creatorID:owner,__v:1}];
  await assert.rejects(api.createRecipeForUser(actor(),input),/session changed/);
  await assert.rejects(api.updateRecipeForUser(actor(),id,{...input,name:'Forbidden edit'}),/session changed/);
  await assert.rejects(api.deleteRecipesForUser(actor(),[id]),/session changed/);
  assert.equal(f.recipes.length,1);assert.equal(f.recipes[0].name,input.name);assert.equal(f.userUpdates.length,0);assert.equal(f.reservations.length,0);assert.equal(f.cleanup.length,0);assert.equal(f.deleted.length,0);
 }
 assert.equal(f.startedTransactions,f.endedTransactions);
});

test('inactive or unverified users cannot be assigned private viewer access',async()=>{
 const f=globalThis.lifecycle;
 for(const state of [{accountStatus:'deactivated'},{accountStatus:'purging'},{emailVerifiedAt:null}]){
  f.verifiedUsers=[{_id:other,email:'viewer@example.invalid',emailVerifiedAt:new Date(),...state}];
  await assert.rejects(api.createRecipeForUser(actor(),{...input,secret:true,secretViewerIDs:[other]}),/verified RecipeSafe/);
  assert.equal(f.recipes.length,0);assert.equal(f.reservations.length,0);assert.equal(f.userUpdates.length,0);
 }
});

test('family creation reuses the caller transaction and personal mutations keep every database write in their own transaction',async()=>{
 const f=globalThis.lifecycle;const session={marker:'family'};
 await api.createRecipeForUser(actor(),input,'family-id',session);assert.equal(f.startedTransactions,0);assert.ok(f.writeSessions.length>=3);assert.ok(f.writeSessions.every(value=>value===session));
 f.writeSessions=[];await api.updateRecipeForUser(actor(),id,{...input,ingredients:[{ingredient:'Flour',quantity:'1 cup'}]});assert.equal(f.startedTransactions,1);assert.equal(f.endedTransactions,1);assert.ok(f.writeSessions.length>=4);assert.ok(f.writeSessions.every(value=>value?.marker==='owned'));assert.ok(f.userUpdates.some(update=>update.u.$inc?.__v===1));
});

test('failed commit rolls back recipes, creator references, ingredients and image reservations before storage cleanup',async()=>{
 const f=globalThis.lifecycle;f.failCommit=true;
 await assert.rejects(api.createRecipeForUser(actor(),{...input,image:'https://app.ufs.sh/f/new-key',imageKey:'new-key',ingredients:[{ingredient:'Flour',quantity:'1 cup'}]}),/Commit failed/);
 assert.deepEqual(f.recipes,[]);assert.deepEqual(f.ingredients,[]);assert.deepEqual(f.reservations,[]);assert.deepEqual(f.userUpdates,[]);assert.deepEqual(f.deleted,[]);
 f.recipes=[{...input,_id:id,creatorID:owner,__v:1,image:'https://app.ufs.sh/f/old-key',imageKey:'old-key'}];
 await assert.rejects(api.updateRecipeForUser(actor(),id,{...input,image:'https://app.ufs.sh/f/new-key',imageKey:'new-key'}),/Commit failed/);assert.equal(f.recipes[0].imageKey,'old-key');assert.deepEqual(f.reservations,[]);assert.deepEqual(f.releases,[]);assert.deepEqual(f.deleted,[]);
 await assert.rejects(api.deleteRecipesForUser(actor(),[id]),/Commit failed/);assert.equal(f.recipes.length,1);assert.deepEqual(f.cleanup,[]);assert.deepEqual(f.releases,[]);assert.deepEqual(f.deleted,[]);
});

test('image reservations are released in the transaction and storage deletion runs only after commit',async()=>{
 const f=globalThis.lifecycle;f.recipes=[{...input,_id:id,creatorID:owner,__v:1,image:'https://app.ufs.sh/f/old-key',imageKey:'old-key'}];
 await api.updateRecipeForUser(actor(),id,{...input,image:'https://app.ufs.sh/f/new-key',imageKey:'new-key'});
 assert.deepEqual(f.releases,[{key:'old-key',id}]);assert.deepEqual(f.events,['begin','commit','storage']);assert.ok(f.deleted.every(value=>!value.inTransaction));
 f.events=[];await api.deleteRecipesForUser(actor(),[id]);assert.deepEqual(f.events,['begin','commit','storage']);assert.ok(f.deleted.every(value=>!value.inTransaction));assert.ok(f.writeSessions.every(value=>value?.marker==='owned'));
});

test('closure winning the owner lock and a concurrent recipe transfer prevent all unlinking and storage deletion',async()=>{
 const f=globalThis.lifecycle;f.recipes=[{...input,_id:id,creatorID:owner,__v:1,image:'https://app.ufs.sh/f/old-key',imageKey:'old-key'}];
 f.beforeUserWrite=()=>{f.accounts[0].accountStatus='deactivated'};await assert.rejects(api.deleteRecipesForUser(actor(),[id]),/session changed/);assert.equal(f.recipes.length,1);assert.deepEqual(f.cleanup,[]);assert.deepEqual(f.deleted,[]);
 delete f.beforeUserWrite;f.beforeRecipeWrite=()=>{f.recipes[0].creatorID=other;f.recipes[0].__v++};f.afterRollback=()=>{f.recipes[0].creatorID=other;f.recipes[0].__v=2};
 await assert.rejects(api.deleteRecipesForUser(actor(),[id]),/Recipe changed/);assert.equal(f.recipes[0].creatorID,other);assert.equal(f.recipes[0].__v,2);assert.deepEqual(f.cleanup,[]);assert.deepEqual(f.releases,[]);assert.deepEqual(f.deleted,[]);
});
