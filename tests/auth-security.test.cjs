const test = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipesafe-auth-tests-'));
const id = '507f1f77bcf86cd799439011';
let api;
const modelMock = `
const f=()=>globalThis.authFixture;
function matches(u,q){return Object.entries(q).every(([k,v])=>{
 if(k==='$or')return v.some(part=>matches(u,part));
 if(k==='$and')return v.every(part=>matches(u,part));
 if(v&&typeof v==='object'&&!(v instanceof Date))return Object.entries(v).every(([op,value])=>{
  if(op==='$gt')return new Date(u[k])>value;
  if(op==='$exists')return (u[k]!==undefined)===value;
  if(op==='$ne')return String(u[k])!==String(value);
  throw new Error('Unsupported fixture query: '+op);
 });
 return String(u[k])===String(v);
});}
function query(value){return {select(){return this},session:async()=>value,then(resolve,reject){return Promise.resolve(value).then(resolve,reject)}}}
function update(user,op){if(op.$set)Object.assign(user,op.$set);if(op.$inc)for(const[k,v]of Object.entries(op.$inc))user[k]=(user[k]||0)+v;if(op.$unset)for(const k of Object.keys(op.$unset))delete user[k];}
export default {
 findById(id){f().idReads=(f().idReads||0)+1;return query(f().users.find(u=>String(u._id)===String(id))||null)},
 findOne(q){f().reads++;return query(f().users.find(u=>matches(u,q))||null)},
 async create(data){const user={_id:'507f1f77bcf86cd799439012',...data,async save(){},toObject(){return {...this}}};f().users.push(user);return user},
 async updateOne(q,op){f().beforeUpdate?.(q,op);const u=f().users.find(u=>matches(u,q));if(u)update(u,op);return {modifiedCount:u?1:0}},
 findOneAndUpdate(q,op){f().beforeUpdate?.(q,op);const u=f().users.find(u=>matches(u,q));if(u)update(u,op);return query(u||null)},
 async exists(q){return f().users.some(u=>matches(u,q))}
};`;
const mocks = {
 'server-only': '',
 '@/models/user': modelMock,
 '@/models/family': 'export default {async updateMany(filter,operation,options){globalThis.authFixture.familyUpdates++;globalThis.authFixture.familyNameChange={filter,operation,options}}};',
 'mongoose':'export default{async startSession(){return{async withTransaction(fn){await fn()},async endSession(){}}}}',
 '@/lib/mongodb': 'export default async function(){}',
 '@/lib/security/rate-limit': 'export const requestIp=()=>"offline";export async function consumeRateLimit(key,options){const f=globalThis.authFixture;(f.rateCalls??=[]).push({key,options});return {allowed:f.allowed,retryAfter:60}}',
 'next-auth': 'export async function getServerSession(){return globalThis.authFixture.session}',
 'next-auth/providers/google': 'export default options=>({id:"google",...options})',
 'next-auth/providers/credentials': 'export default options=>({id:"credentials",...options})',
 'next/headers': 'export async function headers(){return {get:()=>null}}',
 'next/cache': 'export function revalidatePath(){}',
 'next/server': 'export const NextResponse={json:(data,options)=>({data,status:options?.status||200})}',
 'bcrypt-ts': 'export async function hash(password,cost){globalThis.authFixture.hashCalls.push({password,cost});return "$2b$10$"+"A".repeat(53)}export async function compare(password,hash){globalThis.authFixture.compareCalls.push(hash);return password==="correct-password"}',
 'resend': 'export class Resend{constructor(){this.emails={send:async value=>{globalThis.authFixture.sent.push(value);return {data:{id:"offline"},error:null}}}}}',
};

test.before(async()=>{
 const outfile=path.join(dir,'auth.cjs');
 await esbuild.build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`export * from './lib/auth/policy';export * from './lib/auth/profile';export * from './lib/auth/password';export * from './lib/auth/verification';export * from './lib/auth/current-user';export * from './lib/admin';export {authOptions} from './lib/auth/auth-options';export {UpdateUser} from './utils/server-actions/user/update';export {POST as registerPOST} from './app/api/register/route';`},outfile,bundle:true,platform:'node',format:'cjs',plugins:[{name:'offline-auth',setup(build){build.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:undefined);build.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
 api=require(outfile);
});
test.beforeEach(()=>{
 globalThis.authFixture={users:[],session:null,allowed:true,reads:0,hashCalls:[],compareCalls:[],sent:[],familyUpdates:0};
 process.env.NEXTAUTH_URL='https://recipesafe.example.invalid';process.env.RESEND_API_KEY='fake-test-key';process.env.EMAIL_FROM='no-reply@example.invalid';process.env.ADMIN_USER_ID=id;
});
test.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true,force:true})});
function user(extra={}){return {_id:id,email:'owner@example.invalid',name:'Owner',password:'$2b$10$'+'A'.repeat(53),emailVerifiedAt:new Date(),sessionVersion:2,async save(){},...extra}}
function credentials(){return api.authOptions.providers.find(p=>p.id==='credentials')}

test('JWTs never fall back to email and reject legacy, deleted, revoked or unverified identities',async()=>{
 const f=globalThis.authFixture;f.users=[user({_id:'507f1f77bcf86cd799439099',email:'old@example.invalid'})];
 await assert.rejects(api.authOptions.callbacks.jwt({token:{id,email:'old@example.invalid',sessionVersion:2}}));
 await assert.rejects(api.authOptions.callbacks.jwt({token:{email:'old@example.invalid'}}));
 f.users=[user({sessionVersion:3})];await assert.rejects(api.authOptions.callbacks.jwt({token:{id,sessionVersion:2}}));
 f.users=[user({emailVerifiedAt:null})];await assert.rejects(api.authOptions.callbacks.jwt({token:{id,sessionVersion:2}}));
 f.users=[user({email:'changed@example.invalid'})];const token=await api.authOptions.callbacks.jwt({token:{id,email:'old@example.invalid',sessionVersion:2}});assert.equal(token.id,id);assert.equal(token.email,'changed@example.invalid');
});

test('profile allowlist rejects relationship, password, verification and role fields',()=>{
 for(const key of ['userFamilyID','recipeIDs','favoriteRecipeIDs','communityIDs','password','email','emailVerifiedAt','sessionVersion','accountStatus','deactivatedAt','purgeAfter','_id'])assert.throws(()=>api.profileUpdate({[key]:'forged'}));
 assert.deepEqual(api.profileUpdate({name:' Owner ',bio:'hello',profileImage:'https://example.invalid/avatar.png'}),{name:'Owner',bio:'hello',profileImage:'https://example.invalid/avatar.png'});
});

test('password policy caps bcrypt work before comparison; client hashes are rejected by public registration',async()=>{
 const costly='$2b$31$'+'A'.repeat(53);assert.equal(await api.verifyPassword('correct-password',costly),false);assert.deepEqual(globalThis.authFixture.compareCalls,[]);
 assert.equal(api.validNewPassword('x'.repeat(73)),false);assert.equal(api.validNewPassword('\u{1F600}'.repeat(20)),false);
 const response=await api.registerPOST({url:'https://recipesafe.example.invalid/api/register',headers:{get:key=>key==='content-type'?'application/json':null},text:async()=>JSON.stringify({namePassed:'Attack',emailPassed:'attack@example.invalid',saltedPW:costly})});assert.equal(response.status,400);assert.equal(globalThis.authFixture.users.length,0);assert.equal(globalThis.authFixture.hashCalls.length,0);
 await api.hashPassword('a-valid-new-password');assert.equal(globalThis.authFixture.hashCalls[0].cost,10);
});

test('credentials login requires verification and obeys the shared limiter before bcrypt',async()=>{
 const f=globalThis.authFixture;f.users=[user({emailVerifiedAt:null})];assert.equal(await credentials().authorize({email:'owner@example.invalid',password:'correct-password'},{headers:{}}),null);assert.equal(f.compareCalls.length,0);
 f.users=[user()];f.allowed=false;assert.equal(await credentials().authorize({email:'owner@example.invalid',password:'correct-password'},{headers:{}}),null);assert.equal(f.compareCalls.length,0);
 f.allowed=true;const result=await credentials().authorize({email:'owner@example.invalid',password:'correct-password'},{headers:{}});assert.equal(result.id,id);assert.equal(result.sessionVersion,2);
});

test('email alone never grants admin, including a registered configured legacy admin email',()=>{
 process.env.ADMIN_USERNAME='owner@example.invalid';assert.equal(api.isAppAdmin(user({emailVerifiedAt:null})),false);assert.equal(api.isAppAdmin(user({_id:'507f1f77bcf86cd799439099'})),false);assert.equal(api.isAppAdmin(user()),true);delete process.env.ADMIN_USER_ID;assert.equal(api.isAppAdmin(user()),false);
});

test('verified Google claims evict unverified local credentials and tokens; linking verified local accounts requires their session',async()=>{
 const f=globalThis.authFixture;const u=user({emailVerifiedAt:null,emailVerificationTokenHash:'old-token'});f.users=[u];const googleUser={email:u.email,name:u.name};
 assert.equal(await api.authOptions.callbacks.signIn({account:{provider:'google',providerAccountId:'google-id'},profile:{email:u.email,email_verified:true},user:googleUser}),true);assert.equal(u.password,'');assert.equal(u.sessionVersion,3);assert.equal(u.emailVerificationTokenHash,undefined);assert.equal(googleUser.id,id);
 const local=user();f.users=[local];assert.equal(await api.authOptions.callbacks.signIn({account:{provider:'google',providerAccountId:'google-id'},profile:{email:local.email,email_verified:true},user:{}}),false);
 f.session={user:{id,sessionVersion:2}};assert.equal(await api.authOptions.callbacks.signIn({account:{provider:'google',providerAccountId:'google-id'},profile:{email:local.email,email_verified:true},user:{}}),true);
 assert.equal(await api.authOptions.callbacks.signIn({account:{provider:'google',providerAccountId:'other'},profile:{email:local.email},user:{}}),false);
});

test('new registrations stay unverified; mailbox token is hashed, expiring, single-use and resets any pre-registered password',async()=>{
 const f=globalThis.authFixture;await api.registerAccount({name:'Owner',email:'owner@example.invalid',password:'a-valid-new-password'});assert.equal(f.users[0].emailVerifiedAt,null);assert.equal(f.hashCalls[0].cost,10);assert.equal(f.sent.length,1);
 const link=f.sent[0].text.match(/https:\/\/\S+/)[0];const token=new URLSearchParams(new URL(link).hash.slice(1)).get('token');assert.match(token,/^[a-f0-9]{64}$/);assert.notEqual(f.users[0].emailVerificationTokenHash,token);assert.equal(f.users[0].emailVerificationTokenHash,api.tokenHash(token));assert.ok(f.users[0].emailVerificationExpiresAt>Date.now());
 const result=await api.confirmVerification(token,'owner-chosen-password');assert.equal(result.email,'owner@example.invalid');assert.ok(f.users[0].emailVerifiedAt);assert.equal(f.users[0].sessionVersion,1);assert.equal(f.hashCalls.at(-1).password,'owner-chosen-password');await assert.rejects(api.confirmVerification(token,'owner-chosen-password'));
});

test('expired confirmation cannot reset credentials and recovery preserves existing identity/data',async()=>{
 const f=globalThis.authFixture;const token='b'.repeat(64);f.users=[user({userFamilyID:'family-kept',emailVerificationTokenHash:api.tokenHash(token),emailVerificationExpiresAt:new Date(Date.now()-1),emailVerificationPurpose:'recover'})];await assert.rejects(api.confirmVerification(token,'owner-chosen-password'));assert.equal(f.hashCalls.length,0);
 await api.requestVerification('owner@example.invalid');const link=f.sent[0].text.match(/https:\/\/\S+/)[0];const fresh=new URLSearchParams(new URL(link).hash.slice(1)).get('token');await api.confirmVerification(fresh,'owner-chosen-password');assert.equal(f.users[0]._id,id);assert.equal(f.users[0].userFamilyID,'family-kept');assert.equal(f.users[0].sessionVersion,3);
});

test('address changes leave the old email active until token confirmation then revoke sessions',async()=>{
 const f=globalThis.authFixture;f.users=[user()];await api.issueVerification(id,'email-change','new@example.invalid');assert.equal(f.users[0].email,'owner@example.invalid');assert.equal(f.users[0].pendingEmail,'new@example.invalid');
 const link=f.sent[0].text.match(/https:\/\/\S+/)[0];const token=new URLSearchParams(new URL(link).hash.slice(1)).get('token');await api.confirmVerification(token,'new-owner-password');assert.equal(f.users[0].email,'new@example.invalid');assert.equal(f.users[0].sessionVersion,3);assert.equal(f.familyUpdates,1);
});

test('all password-confirmed account and family operations share a per-user limit enforced before DB lookup and bcrypt',async()=>{
 const f=globalThis.authFixture;f.users=[user()];f.allowed=false;
 assert.equal(await api.verifyCurrentPassword(id,'correct-password'),false);assert.equal(f.idReads,undefined);assert.deepEqual(f.compareCalls,[]);
 assert.deepEqual(f.rateCalls[0],{key:`password-confirm:${id}`,options:{limit:10,windowMs:15*60_000}});
 f.allowed=true;assert.equal(await api.verifyCurrentPassword(id,'correct-password'),true);assert.equal(f.idReads,1);assert.equal(f.compareCalls.length,1);
});

test('profile display-name updates use the immutable ID for active family rows and reject revoked actors before writes',async()=>{
 const f=globalThis.authFixture;const owner=user();f.users=[owner];await api.updateProfile({...owner},{name:' Updated Name '});assert.equal(f.users[0].name,'Updated Name');assert.equal(f.familyUpdates,1);assert.deepEqual(f.familyNameChange.filter,{deletedAt:null,'familyMembers.familyMemberID':id});assert.deepEqual(f.familyNameChange.operation,{$set:{'familyMembers.$[member].familyMemberName':'Updated Name'}});assert.deepEqual(f.familyNameChange.options.arrayFilters,[{'member.familyMemberID':id}]);
 const stale={...owner,sessionVersion:1};await assert.rejects(api.updateProfile(stale,{name:'Must Not Change'}));assert.equal(f.users[0].name,'Updated Name');assert.equal(f.familyUpdates,1);
});

test('account policy permits legacy active accounts and enforces an exact, finite recovery deadline',()=>{
 const now=Date.now();
 assert.equal(api.isAccountActive(user()),true);assert.equal(api.isAccountActive(user({accountStatus:'active'})),true);
 for(const value of [null,undefined,{accountStatus:null},{accountStatus:'deactivated'},{accountStatus:'purging'},{accountStatus:'unknown'}])assert.equal(api.isAccountActive(value),false);
 assert.equal(api.isAccountRecoverable({accountStatus:'deactivated',purgeAfter:new Date(now+1)},now),true);
 assert.equal(api.isAccountRecoverable({accountStatus:'deactivated',purgeAfter:new Date(now+1).toISOString()},now),true);
 for(const value of [null,{accountStatus:'active',purgeAfter:new Date(now+1)},{accountStatus:'purging',purgeAfter:new Date(now+1)},{accountStatus:'deactivated'},{accountStatus:'deactivated',purgeAfter:'invalid'},{accountStatus:'deactivated',purgeAfter:new Date(now)},{accountStatus:'deactivated',purgeAfter:new Date(now-1)}])assert.equal(api.isAccountRecoverable(value,now),false);
});

test('deactivated and purging accounts reject credentials, Google, JWTs, current-user access and password confirmations',async()=>{
 const f=globalThis.authFixture;
 for(const accountStatus of ['deactivated','purging']){
  const owner=user({accountStatus,purgeAfter:new Date(Date.now()+3600000),googleProviderId:'google-id'});f.users=[owner];f.session={user:{id,sessionVersion:2}};
  assert.equal(await credentials().authorize({email:owner.email,password:'correct-password'},{headers:{}}),null);
  assert.equal(await api.authOptions.callbacks.signIn({account:{provider:'google',providerAccountId:'google-id'},profile:{email:owner.email,email_verified:true},user:{}}),false);
  await assert.rejects(api.authOptions.callbacks.jwt({token:{id,sessionVersion:2}}));
  assert.equal(await api.getCurrentUser(),null);assert.equal(await api.verifyCurrentPassword(id,'correct-password'),false);
  assert.equal(owner.accountStatus,accountStatus);assert.equal(owner.sessionVersion,2);
 }
 assert.equal(f.compareCalls.length,0);assert.equal(f.users.length,1);
});

function mailedToken(message){return new URLSearchParams(new URL(message.text.match(/https:\/\/\S+/)[0]).hash.slice(1)).get('token')}

test('closed account recovery requires a fresh emailed token and new password; preserves identity and recipes without rejoining a family',async()=>{
 const f=globalThis.authFixture;const deadline=new Date(Date.now()+29*86400000);const owner=user({accountStatus:'deactivated',deactivatedAt:new Date(),purgeAfter:deadline,userFamilyID:'must-not-return',recipeIDs:['owned-recipe'],favoriteRecipeIDs:['favorite']});f.users=[owner];
 await api.requestVerification(owner.email);assert.equal(f.sent.length,1);assert.equal(owner.emailVerificationPurpose,'recover');assert.equal(owner.accountStatus,'deactivated');assert.equal(owner.purgeAfter,deadline);
 const token=mailedToken(f.sent[0]);assert.equal(owner.emailVerificationTokenHash,api.tokenHash(token));
 await assert.rejects(api.confirmVerification(token,'short'));assert.equal(owner.accountStatus,'deactivated');assert.equal(f.hashCalls.length,0);
 const result=await api.confirmVerification(token,'recovered-owner-password');assert.equal(result.recoveredAccount,true);assert.equal(owner._id,id);assert.equal(owner.accountStatus,'active');assert.equal(owner.sessionVersion,3);assert.equal(owner.userFamilyID,'');assert.deepEqual(owner.recipeIDs,['owned-recipe']);assert.deepEqual(owner.favoriteRecipeIDs,['favorite']);assert.equal(owner.deactivatedAt,undefined);assert.equal(owner.purgeAfter,undefined);assert.equal(owner.emailVerificationTokenHash,undefined);assert.equal(f.familyUpdates,0);
 await assert.rejects(api.confirmVerification(token,'another-valid-password'));await assert.rejects(api.authOptions.callbacks.jwt({token:{id,sessionVersion:2}}));assert.equal((await api.authOptions.callbacks.jwt({token:{id,sessionVersion:3}})).id,id);
});

test('closed email addresses stay reserved until purge; re-registration only sends recovery before the deadline',async()=>{
 const f=globalThis.authFixture;const input={name:'Replacement',email:'owner@example.invalid',password:'replacement-password'};
 const owner=user({accountStatus:'deactivated',purgeAfter:new Date(Date.now()+3600000),recipeIDs:['original-recipe']});f.users=[owner];
 await api.registerAccount(input);assert.equal(f.users.length,1);assert.equal(owner._id,id);assert.equal(owner.name,'Owner');assert.deepEqual(owner.recipeIDs,['original-recipe']);assert.equal(f.hashCalls.length,0);assert.equal(f.sent.length,1);assert.equal(owner.emailVerificationPurpose,'recover');
 for(const state of [{accountStatus:'deactivated',purgeAfter:new Date(Date.now()-1)},{accountStatus:'purging',purgeAfter:new Date(Date.now()+3600000)}]){
  Object.assign(owner,state);await api.registerAccount(input);await api.requestVerification(owner.email);assert.equal(f.users.length,1);assert.equal(f.sent.length,1);assert.equal(f.hashCalls.length,0);
 }
 // Once the old identity is actually purged, reuse creates a distinct account and never revives its JWT.
 f.users=[];await api.registerAccount(input);assert.notEqual(f.users[0]._id,id);assert.equal(f.users[0].recipeIDs,undefined);await assert.rejects(api.authOptions.callbacks.jwt({token:{id,sessionVersion:2}}));
});

test('closed accounts cannot use verify/email-change tokens or obtain links after expiry/purge claim',async()=>{
 const f=globalThis.authFixture;const token='c'.repeat(64);
 for(const purpose of ['verify','email-change']){
  const owner=user({accountStatus:'deactivated',purgeAfter:new Date(Date.now()+3600000),emailVerificationTokenHash:api.tokenHash(token),emailVerificationExpiresAt:new Date(Date.now()+3600000),emailVerificationPurpose:purpose,pendingEmail:'attacker@example.invalid'});f.users=[owner];
  await assert.rejects(api.confirmVerification(token,'recovered-owner-password'));await assert.rejects(api.issueVerification(id,purpose,purpose==='email-change'?'new@example.invalid':owner.email));assert.equal(owner.accountStatus,'deactivated');assert.equal(owner.email,'owner@example.invalid');assert.equal(f.hashCalls.length,0);assert.equal(f.sent.length,0);
 }
 for(const state of [{accountStatus:'deactivated',purgeAfter:new Date(Date.now()-1)},{accountStatus:'purging',purgeAfter:new Date(Date.now()+3600000)}]){
  f.users=[user({...state,emailVerificationTokenHash:api.tokenHash(token),emailVerificationExpiresAt:new Date(Date.now()+3600000),emailVerificationPurpose:'recover'})];await assert.rejects(api.confirmVerification(token,'recovered-owner-password'));await assert.rejects(api.issueVerification(id,'recover','owner@example.invalid'));assert.equal(f.hashCalls.length,0);assert.equal(f.sent.length,0);
 }
});

test('purge claims and closure racing verification cannot be overwritten by recovery or a new email token',async()=>{
 const f=globalThis.authFixture;const token='d'.repeat(64);const owner=user({accountStatus:'deactivated',purgeAfter:new Date(Date.now()+3600000),emailVerificationTokenHash:api.tokenHash(token),emailVerificationExpiresAt:new Date(Date.now()+3600000),emailVerificationPurpose:'recover'});f.users=[owner];
 f.beforeUpdate=()=>{owner.accountStatus='purging'};await assert.rejects(api.confirmVerification(token,'recovered-owner-password'));assert.equal(owner.accountStatus,'purging');assert.equal(owner.sessionVersion,2);
 owner.accountStatus='active';delete owner.emailVerificationTokenHash;f.beforeUpdate=()=>{owner.accountStatus='deactivated';owner.purgeAfter=new Date(Date.now()+3600000)};await assert.rejects(api.issueVerification(id,'recover',owner.email));assert.equal(f.sent.length,0);assert.equal(owner.emailVerificationTokenHash,undefined);
});
