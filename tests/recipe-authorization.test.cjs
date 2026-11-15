const test=require('node:test');const assert=require('node:assert/strict');const esbuild=require('esbuild');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'recipesafe-recipe-tests-'));
const id='507f1f77bcf86cd799439011',familyId='507f191e810c19729de860ea';
const viewer={_id:'507f191e810c19729de860eb',email:'viewer@example.invalid',userFamilyID:familyId};
let reads, familyActions;
const mocks={
 'react':`export const cache=fn=>fn;`,
 'mongoose':`export const Types={ObjectId:{isValid:id=>typeof id==='string' && /^[a-f0-9]{24}$/i.test(id)}};`,
 'mongodb':`export class ObjectId{constructor(value){this.value=value}toString(){return this.value}static isValid(id){return typeof id==='string' && /^[a-f0-9]{24}$/i.test(id)}}`,
 '@/models/recipe':`function includes(ids,id){return ids.map(String).includes(String(id))}function matches(doc,q){if(q.$and)return q.$and.every(part=>matches(doc,part));if(q.$or)return q.$or.some(part=>matches(doc,part));if(q._id)return includes(q._id.$in,doc._id);if(q.secret)return doc.secret!==true;if(q.creatorID)return doc.creatorID===q.creatorID;if(q.secretViewerIDs)return q.secretViewerIDs.$in.some(id=>doc.secretViewerIDs.includes(id));return true;}export default{find:q=>({lean:async()=>globalThis.recipeFixture.recipes.filter(doc=>matches(doc,q))}),findById:()=>({session:async()=>globalThis.recipeFixture.recipes[0]}),updateOne:async()=>{globalThis.recipeFixture.added=true}};`,
 '@/models/ingredient':`export default {find:()=>({lean:async()=>[]})};`,
 '@/models/user':`export default{find:q=>({select(){return this},lean:async()=>globalThis.recipeFixture.creators.filter(user=>q._id.$in.includes(user._id))})};`,
 '@/models/family':`export default{findOne:q=>({lean:async()=>q.deletedAt===null && globalThis.recipeFixture.family.deletedAt?null:globalThis.recipeFixture.family}),findByIdAndUpdate:async()=>{globalThis.recipeFixture.added=true}};`,
 '@/lib/mongodb':`export default async function connectDB(){}`,
 '@/lib/family-mutations':`export const familyFailure=message=>({success:false,message,members:[]});export async function withFamilyMutation(id,fn){const f=globalThis.recipeFixture;if(f.family.deletedAt)return familyFailure('Archived');return fn({user:f.user,family:f.family,member:{permissionStatus:f.role},session:{}})}`, 'next/cache':`export function revalidatePath(){}`,
 './utils':`export const getRevalidationPath=x=>x;`,
 '@/utils/server-actions/family/utils':`export const getFamilyMember=(family,user)=>family.familyMembers.find(member=>member.familyMemberID===user._id)||null;export const hasConnectedMembership=(member,user)=>Boolean(member?.memberConnected && member.familyMemberID===user._id);`,
 '../family/utils':`export async function getAuthenticatedFamilyContext(){const f=globalThis.recipeFixture;return {user:f.user,family:f.family,member:{permissionStatus:f.role},message:''}}export const hasAdminPrivilege=member=>member?.permissionStatus==='Admin';`,
};
async function load(entry,name){const outfile=path.join(directory,name+'.cjs');await esbuild.build({entryPoints:[path.resolve(entry)],outfile,bundle:true,platform:'node',format:'cjs',plugins:[{name:'offline-fixtures',setup(build){build.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));}}]});return require(outfile)}
test.before(async()=>{reads=await load('lib/data/recipes.ts','reads');familyActions=await load('utils/server-actions/recipe/family.ts','family');});
test.beforeEach(()=>{globalThis.recipeFixture={user:viewer,role:'Guest',creators:[],recipes:[{_id:id,creatorID:'different-user',name:'Private recipe',secret:true,secretViewerIDs:[]}],family:{_id:familyId,recipeIDs:[],familyMembers:[{familyMemberID:viewer._id,memberConnected:true}],async save(){globalThis.recipeFixture.saved=true}}};});
test.after(()=>{assert.equal(path.dirname(directory),os.tmpdir());fs.rmSync(directory,{recursive:true,force:true});});
test('stored favorites and fabricated family relationships do not authorize private reads',async()=>{
 assert.deepEqual(await reads.getRecipesVisibleToUser([id],viewer),[]);
 globalThis.recipeFixture.family.recipeIDs=[id];globalThis.recipeFixture.family.familyMembers=[];
 assert.deepEqual(await reads.getRecipesVisibleToUser([id],viewer),[]);
 assert.deepEqual(await reads.getRecipesVisibleToUser([id],null),[]);
});
test('family share grants connected members access dynamically; unlink or membership revocation removes it',async()=>{
 globalThis.recipeFixture.family.recipeIDs=[id];
 assert.equal((await reads.getRecipesVisibleToUser([id],viewer)).length,1);
 assert.equal(await reads.canUserViewRecipeForUser(globalThis.recipeFixture.recipes[0],viewer),true);
 globalThis.recipeFixture.family.recipeIDs=[];
 assert.equal((await reads.getRecipesVisibleToUser([id],viewer)).length,0);
 globalThis.recipeFixture.family.recipeIDs=[id];globalThis.recipeFixture.family.familyMembers[0].memberConnected=false;
 assert.equal((await reads.getRecipesVisibleToUser([id],viewer)).length,0);
 globalThis.recipeFixture.family.familyMembers[0].memberConnected=true;
 globalThis.recipeFixture.family.deletedAt=new Date();
 assert.equal((await reads.getRecipesVisibleToUser([id],viewer)).length,0);
});
test('explicit viewer grant and public access work while viewer lists stay private',async()=>{
 globalThis.recipeFixture.recipes[0].secretViewerIDs=[viewer._id,'another@example.invalid'];
 const visible=await reads.getRecipesVisibleToUser([id],viewer);assert.equal(visible.length,1);assert.deepEqual(visible[0].secretViewerIDs,[]);
 globalThis.recipeFixture.recipes[0].secretViewerIDs=[];assert.deepEqual(await reads.getRecipesVisibleToUser([id],viewer),[]);
 globalThis.recipeFixture.recipes[0].secret=false;assert.equal((await reads.getRecipesVisibleToUser([id],null)).length,1);
});
test('guest/member bulk unlink is rejected before save; admins may unlink',async()=>{
 globalThis.recipeFixture.family.recipeIDs=[id];
 for(const role of ['Guest','Member']){globalThis.recipeFixture.role=role;assert.equal((await familyActions.RemoveRecipesFromFamily([id],familyId,'/family')).success,false);assert.equal(globalThis.recipeFixture.saved,undefined)}
 globalThis.recipeFixture.role='Admin';assert.equal((await familyActions.RemoveRecipesFromFamily([id],familyId,'/family')).success,true);assert.deepEqual(globalThis.recipeFixture.family.recipeIDs,[]);
});
test('explicit recipe viewers cannot re-share a private recipe to their family',async()=>{
 globalThis.recipeFixture.role='Member';
 globalThis.recipeFixture.recipes[0].secretViewerIDs=[viewer._id];
 assert.equal((await familyActions.AddRecipeToFamily(id,familyId,'/family')).success,false);assert.equal(globalThis.recipeFixture.added,undefined);
 globalThis.recipeFixture.recipes[0].creatorID=viewer._id;
 assert.equal((await familyActions.AddRecipeToFamily(id,familyId,'/family')).success,true);assert.equal(globalThis.recipeFixture.added,true);
});

test('legacy email-only shares do not grant access to a new immutable account at that address',async()=>{
 globalThis.recipeFixture.recipes[0].secretViewerIDs=[viewer.email];
 assert.deepEqual(await reads.getRecipesVisibleToUser([id],viewer),[]);
 assert.equal(await reads.canUserViewRecipeForUser(globalThis.recipeFixture.recipes[0],viewer),false);
});
test('deactivated and purging creators hide public and shared recipes until recovery; legacy active authors still work',async()=>{
 const f=globalThis.recipeFixture,creatorId='507f191e810c19729de860ed';
 f.recipes[0].creatorID=creatorId;f.recipes[0].secret=false;
 const creator={_id:creatorId,accountStatus:'deactivated'};f.creators=[creator];
 for(const accountStatus of ['deactivated','purging','unexpected-status']){
  creator.accountStatus=accountStatus;
  assert.deepEqual(await reads.getRecipesVisibleToUser([id],null),[]);
  assert.equal(await reads.canUserViewRecipeForUser(f.recipes[0],null),false);
  f.family.recipeIDs=[id];f.recipes[0].secret=true;
  assert.deepEqual(await reads.getRecipesVisibleToUser([id],viewer),[]);
  assert.equal(await reads.canUserViewRecipeForUser(f.recipes[0],viewer),false);
  f.recipes[0].secret=false;
 }
 for(const accountStatus of ['active',undefined]){
  creator.accountStatus=accountStatus;
  assert.equal((await reads.getRecipesVisibleToUser([id],null)).length,1);
  assert.equal(await reads.canUserViewRecipeForUser(f.recipes[0],null),true);
 }
 f.creators=[];
 assert.equal((await reads.getRecipesVisibleToUser([id],null)).length,1);
});
test('guests cannot add recipes and archived families reject share or unlink writes',async()=>{
 globalThis.recipeFixture.recipes[0].secret=false;
 assert.equal((await familyActions.AddRecipeToFamily(id,familyId,'/family')).success,false);
 assert.equal(globalThis.recipeFixture.added,undefined);
 globalThis.recipeFixture.role='Admin';globalThis.recipeFixture.family.deletedAt=new Date();
 assert.equal((await familyActions.AddRecipeToFamily(id,familyId,'/family')).success,false);
 assert.equal((await familyActions.RemoveRecipesFromFamily([id],familyId,'/family')).success,false);
 assert.equal(globalThis.recipeFixture.saved,undefined);
});
