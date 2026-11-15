const test = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recipesafe-storage-tests-'));
const uploadMock = `
function match(row,q){return row && row.key===q.key && (!q.ownerId || row.ownerId===q.ownerId) && row.state===q.state && (!q.recipeIds || row.recipeIds.length===0) && (!q.url || row.url===q.url)}
export default {
 findOneAndUpdate(q,op){const row=globalThis.storageFixture.uploads.find(row=>match(row,q));if(row){if(op.$set)Object.assign(row,op.$set);if(op.$addToSet && !row.recipeIds.includes(op.$addToSet.recipeIds))row.recipeIds.push(op.$addToSet.recipeIds)}return {lean:async()=>row?{...row,recipeIds:[...row.recipeIds]}:null}},
 async updateOne(q,op){const row=globalThis.storageFixture.uploads.find(row=>row.key===q.key && (!q.state || q.state===row.state));if(row){if(op.$set)Object.assign(row,op.$set);if(op.$pull)row.recipeIds=row.recipeIds.filter(id=>id!==op.$pull.recipeIds)}return {modifiedCount:row?1:0}}
}`;
let api;
test.before(async () => {
 const output = path.join(directory, 'storage.cjs');
 await esbuild.build({entryPoints:[path.resolve('lib/upload-ownership.ts')],outfile:output,bundle:true,platform:'node',format:'cjs',plugins:[{name:'offline-storage',setup(build){build.onResolve({filter:/^(@\/models\/(upload|recipe|user)|uploadthing\/server)$/},args=>({path:args.path,namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='@/models/upload'?uploadMock:args.path==='@/models/recipe'?`export default {exists:async()=>globalThis.storageFixture.recipeReferenced}`:args.path==='@/models/user'?`export default {exists:async()=>globalThis.storageFixture.avatarReferenced}`:`export class UTApi{async deleteFiles(keys){globalThis.storageFixture.deleted.push(...keys);return {success:true,deletedCount:keys.length}}}`,loader:'js'}))}}]});
 api=require(output);
});
test.beforeEach(()=>{globalThis.storageFixture={uploads:[{key:'owned-key',ownerId:'owner',url:'https://app.ufs.sh/f/owned-key',recipeIds:[],state:'active'}],deleted:[],recipeReferenced:false,avatarReferenced:false};});
test.after(()=>{assert.equal(path.dirname(directory),os.tmpdir());fs.rmSync(directory,{recursive:true,force:true});});
test('forged keys and mismatched URLs cannot be attached or deleted',async()=>{
 await assert.rejects(api.claimRecipeImage('attacker','recipe',{image:'https://app.ufs.sh/f/owned-key',imageKey:'owned-key'}));
 await assert.rejects(api.claimRecipeImage('owner','recipe',{image:'https://evil.invalid/f/owned-key',imageKey:'owned-key'}));
 const result=await api.deleteOwnedUploads(['owned-key'],'attacker');
 assert.equal(result.success,false);assert.deepEqual(globalThis.storageFixture.deleted,[]);
});
test('attachment reservation protects a shared file until all recipe references are removed',async()=>{
 const value={image:'https://app.ufs.sh/f/owned-key',imageKey:'owned-key'};
 await api.claimRecipeImage('owner','recipe-1',value);await api.claimRecipeImage('owner','recipe-2',value);
 await api.releaseRecipeImage('owned-key','recipe-1');
 assert.equal((await api.deleteOwnedUploads(['owned-key'],'owner')).success,false);
 await api.releaseRecipeImage('owned-key','recipe-2');
 assert.equal((await api.deleteOwnedUploads(['owned-key'],'owner')).success,true);
 assert.deepEqual(globalThis.storageFixture.deleted,['owned-key']);
});
test('legacy recipe and avatar references protect files even without reservations',async()=>{
 globalThis.storageFixture.recipeReferenced=true;
 assert.equal((await api.deleteOwnedUploads(['owned-key'],'owner')).success,false);
 assert.equal(globalThis.storageFixture.uploads[0].state,'active');
 globalThis.storageFixture.recipeReferenced=false;globalThis.storageFixture.avatarReferenced=true;
 assert.equal((await api.deleteOwnedUploads(['owned-key'],'owner')).success,false);
 assert.deepEqual(globalThis.storageFixture.deleted,[]);
});
test('deleting files reject concurrent attachment; unknown legacy files are never deleted',async()=>{
 globalThis.storageFixture.uploads[0].state='deleting';
 await assert.rejects(api.claimRecipeImage('owner','new-recipe',{image:'https://app.ufs.sh/f/owned-key',imageKey:'owned-key'}));
 assert.equal((await api.deleteOwnedUploads(['legacy-key'],'owner')).success,false);
 assert.deepEqual(globalThis.storageFixture.deleted,[]);
});
