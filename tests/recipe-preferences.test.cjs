const test = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recipesafe-preferences-'));
const owner = '507f191e810c19729de860ea';
const recipeId = '507f1f77bcf86cd799439011';
let api;
const helpers = `const f=()=>globalThis.preferencesFixture;
function chain(doc){return {select(){return this},session(session){f().readSessions.push(session);return this},lean:async()=>structuredClone(doc),then(resolve,reject){return Promise.resolve(structuredClone(doc)).then(resolve,reject)}}}
function matches(doc,q){return Object.entries(q).every(([key,value])=>{
 if(key==='$or')return value.some(part=>matches(doc,part));if(key==='$and')return value.every(part=>matches(doc,part));
 if(value&&typeof value==='object')return Object.entries(value).every(([op,v])=>op==='$exists'?(doc[key]!==undefined)===v:op==='$ne'?(Array.isArray(doc[key])?!doc[key].includes(v):doc[key]!==v):false);
 return Array.isArray(doc[key])?doc[key].includes(value):String(doc[key])===String(value);
})}`;
const mocks = {
  'server-only': '',
  'mongoose': `export default {async startSession(){const f=globalThis.preferencesFixture;f.started++;return {marker:'transaction',async withTransaction(fn){const before={...structuredClone({users:f.users,recipes:f.recipes}),writes:[...f.writes]};f.inTransaction=true;try{const result=await fn();if(f.failCommit)throw new Error('Commit failed');return result}catch(error){Object.assign(f,before);f.afterRollback?.();throw error}finally{f.inTransaction=false}},async endSession(){f.ended++}}}}`,
  '@/models/user': `${helpers}export default {findById(id){f().dbReads++;return chain(f().users.find(user=>user._id===id)||null)},async updateOne(q,op,options){f().beforeUserWrite?.();const user=f().users.find(user=>matches(user,q));if(!user)return {modifiedCount:0};f().writes.push({model:'User',session:options.session});for(const [key,value]of Object.entries(op.$addToSet||{}))user[key]=[...new Set([...(user[key]||[]),value])];for(const[key,value]of Object.entries(op.$pull||{}))user[key]=(user[key]||[]).filter(id=>id!==value);return {modifiedCount:1}}}`,
  '@/models/recipe': `${helpers}export default {findById(id){f().dbReads++;return chain(f().recipes.find(recipe=>recipe._id===id)||null)},findByIdAndUpdate(id,op,options){f().counterAttempts++;f().beforeCounterWrite?.();const recipe=f().recipes.find(recipe=>recipe._id===id);if(recipe){f().writes.push({model:'Recipe',session:options.session});Object.assign(recipe,op.$set)}return chain(recipe||null)}}`,
  '@/lib/data/recipes': 'export async function canUserViewRecipeForUser(){return globalThis.preferencesFixture.canView}',
  'next/cache': 'export function revalidatePath(route){globalThis.preferencesFixture.revalidated.push(route)}',
  './utils': `export async function getAuthenticatedUser(){return {user:globalThis.preferencesFixture.actor,message:'Unauthorized'}}export function getRevalidationPath(route){return route.startsWith('/')?route:'/u/recipes'}export function isValidId(id){return typeof id==='string'&&/^[a-f0-9]{24}$/i.test(id)}export async function canAttemptFavoriteToggle(){globalThis.preferencesFixture.limitCalls++;return globalThis.preferencesFixture.limitAllowed}`,
};
test.before(async () => {
  const outfile = path.join(directory, 'preferences.cjs');
  await esbuild.build({stdin: {resolveDir: process.cwd(), loader: 'ts', contents: `export * from './lib/recipe-preferences';export * from './utils/server-actions/recipe/save';export * from './utils/server-actions/recipe/favorite'`}, outfile, bundle: true, platform: 'node', format: 'cjs', plugins: [{name: 'offline-preferences', setup(build) {
    build.onResolve({filter: /.*/}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, namespace: 'fixture'} : undefined);
    build.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: mocks[args.path], loader: 'js'}));
  }}]});
  api = require(outfile);
});
test.beforeEach(() => {
  const user = {_id: owner, emailVerifiedAt: new Date(), sessionVersion: 2, savedRecipeIDs: [], favoriteRecipeIDs: []};
  globalThis.preferencesFixture = {users: [user], actor: {...user}, recipes: [{_id: recipeId, creatorID: owner, saveCount: 0, favoriteCount: 0}], canView: true, writes: [], started: 0, ended: 0, readSessions: [], dbReads: 0, inTransaction: false, counterAttempts: 0, revalidated: [], limitCalls: 0, limitAllowed: true};
});
test.after(() => {assert.equal(path.dirname(directory), os.tmpdir()); fs.rmSync(directory, {recursive: true, force: true});});

test('saved and favorite toggles are idempotent and never decrement counters below zero', async () => {
  const f = globalThis.preferencesFixture;
  for (const [kind, field, count] of [['saved', 'savedRecipeIDs', 'saveCount'], ['favorite', 'favoriteRecipeIDs', 'favoriteCount']]) {
    assert.deepEqual(await api.toggleRecipePreference(f.actor, recipeId, true, kind), {changed: true, count: 1});
    assert.deepEqual(await api.toggleRecipePreference(f.actor, recipeId, true, kind), {changed: false, count: 1});
    assert.deepEqual(f.users[0][field], [recipeId]); assert.equal(f.recipes[0][count], 1);
    f.recipes[0][count] = 0;
    assert.deepEqual(await api.toggleRecipePreference(f.actor, recipeId, false, kind), {changed: true, count: 0});
    assert.deepEqual(await api.toggleRecipePreference(f.actor, recipeId, false, kind), {changed: false, count: 0});
    assert.deepEqual(f.users[0][field], []); assert.equal(f.recipes[0][count], 0);
  }
  assert.equal(f.started, f.ended); assert.ok(f.writes.every(write => write.session?.marker === 'transaction'));
});

test('inactive, revoked, unverified and purged actors cannot add bookmarks or change counters', async () => {
  const f = globalThis.preferencesFixture;
  for (const state of [{accountStatus: 'deactivated'}, {accountStatus: 'purging'}, {sessionVersion: 3}, {emailVerifiedAt: null}, null]) {
    f.users = state ? [{_id: owner, emailVerifiedAt: new Date(), sessionVersion: 2, savedRecipeIDs: [], favoriteRecipeIDs: [], ...state}] : [];
    for (const kind of ['saved', 'favorite']) await assert.rejects(api.toggleRecipePreference(f.actor, recipeId, true, kind), /session changed/);
    assert.deepEqual(f.writes, []); assert.equal(f.recipes[0].saveCount, 0); assert.equal(f.recipes[0].favoriteCount, 0);
  }
});

test('closure or purge winning the actor write prevents a counter update from an in-flight request', async () => {
  const f = globalThis.preferencesFixture;
  for (const kind of ['saved', 'favorite']) {
    f.users = [{...f.actor}]; f.beforeUserWrite = () => {f.users = [];}; f.afterRollback = () => {f.users = [];};
    await assert.rejects(api.toggleRecipePreference(f.actor, recipeId, true, kind), /session or collection changed/);
    assert.deepEqual(f.users, []); assert.deepEqual(f.writes, []); assert.equal(f.counterAttempts, 0);
  }
});

test('counter failure or commit failure rolls back the actor bookmark with no dangling references', async () => {
  const f = globalThis.preferencesFixture;
  f.beforeCounterWrite = () => {f.recipes = [];}; f.afterRollback = () => {f.recipes = [];};
  await assert.rejects(api.toggleRecipePreference(f.actor, recipeId, true, 'saved'), /Recipe not found/);
  assert.deepEqual(f.users[0].savedRecipeIDs, []); assert.deepEqual(f.writes, []);
  delete f.beforeCounterWrite; delete f.afterRollback; f.recipes = [{_id: recipeId, saveCount: 0, favoriteCount: 0}]; f.failCommit = true;
  await assert.rejects(api.toggleRecipePreference(f.actor, recipeId, true, 'favorite'), /Commit failed/);
  assert.deepEqual(f.users[0].favoriteRecipeIDs, []); assert.equal(f.recipes[0].favoriteCount, 0); assert.deepEqual(f.writes, []);
});

test('private recipe access is checked before additions; existing bookmarks can still be removed', async () => {
  const f = globalThis.preferencesFixture; f.canView = false;
  await assert.rejects(api.toggleRecipePreference(f.actor, recipeId, true, 'saved'), /Recipe not found/); assert.deepEqual(f.writes, []);
  f.users[0].savedRecipeIDs = [recipeId]; f.recipes[0].saveCount = 1;
  assert.deepEqual(await api.toggleRecipePreference(f.actor, recipeId, false, 'saved'), {changed: true, count: 0});
});

test('server actions retain return shapes, duplicate-toggle semantics and the favorite rate limit', async () => {
  const f = globalThis.preferencesFixture;
  assert.deepEqual(await api.ToggleSaveRecipe(recipeId, true, '/u/recipes'), {success: true, message: 'Recipe saved', saved: true, saveCount: 1});
  assert.deepEqual(await api.ToggleSaveRecipe(recipeId, true, '/u/recipes'), {success: true, message: 'Recipe already saved', saved: true, saveCount: 1});
  f.limitAllowed = false; const started = f.started;
  assert.equal((await api.ToggleFavoriteRecipe(recipeId, true, '/u/recipes')).success, false); assert.equal(f.started, started); assert.equal(f.limitCalls, 1);
  f.limitAllowed = true;
  assert.deepEqual(await api.ToggleFavoriteRecipe(recipeId, true, '/u/recipes'), {success: true, message: 'Recipe added to favorites', favorited: true, favoriteCount: 1});
  assert.deepEqual(await api.ToggleFavoriteRecipe(recipeId, true, '/u/recipes'), {success: true, message: 'Recipe already favorited', favorited: true, favoriteCount: 1});
  assert.deepEqual(await api.ToggleFavoriteRecipe(recipeId, false, '/u/recipes'), {success: true, message: 'Recipe removed from favorites', favorited: false, favoriteCount: 0});
  assert.equal((await api.ToggleSaveRecipe(recipeId, 'true', '/u/recipes')).success, false); assert.equal((await api.ToggleFavoriteRecipe('invalid', true, '/u/recipes')).success, false);
});
