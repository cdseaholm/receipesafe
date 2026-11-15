const test=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'recipesafe-invitation-tests-'));
const familyId='507f1f77bcf86cd799439001',adminId='507f1f77bcf86cd799439002',recipientId='507f1f77bcf86cd799439003',otherId='507f1f77bcf86cd799439004',token='a'.repeat(40);let api;
const shared=`const f=()=>globalThis.invitationFixture;function query(value){return{select(){return this},session:async()=>value,then(resolve,reject){return Promise.resolve(value).then(resolve,reject)}}}function hydrate(doc){return doc?Object.assign(doc,{async save(){f().writes++}}):null}`;
const mocks={
 'mongoose':`export default{isValidObjectId:id=>typeof id==='string'&&/^[a-f0-9]{24}$/i.test(id),async startSession(){return{async withTransaction(fn){const f=globalThis.invitationFixture;const snapshot=JSON.stringify(f.data);try{await fn()}catch(error){f.data=JSON.parse(snapshot);throw error}},async endSession(){}}}}`,
 '@/lib/mongodb':'export default async function(){}',
 './mongodb':'export default async function(){}',
 '@/lib/auth/current-user':'export async function getCurrentUser(){return globalThis.invitationFixture.actor}',
 'next/server':'export const NextResponse={json:(data,options)=>({data,status:options?.status||200})}',
 '@/models/user':shared+`export default{findById(id){return query(hydrate(f().data.users.find(user=>user._id===id)||null))}}`,
 '@/models/family':shared+`export default{findOne(q){const family=f().data.family;return query(family._id===q._id&&!family.deletedAt?hydrate(family):null)}}`,
 '@/models/invite':shared+`export default{findOne(q){return query(f().data.invites.find(invite=>invite.token===q.token)||null)},async deleteOne(q){const before=f().data.invites.length;f().data.invites=f().data.invites.filter(invite=>invite.token!==q.token);f().writes++;return{deletedCount:before-f().data.invites.length}}}`,
};
test.before(async()=>{const outfile=path.join(directory,'invitations.cjs');await esbuild.build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`export * from './lib/invite-utils';export {POST as acceptPOST} from './app/api/invite/accept/route';`},outfile,bundle:true,platform:'node',format:'cjs',plugins:[{name:'offline-invitations',setup(build){build.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}))}}]});api=require(outfile)});
test.beforeEach(()=>{
 const user={_id:recipientId,name:'Recipient',email:'recipient@example.invalid',emailVerifiedAt:'2026-01-01',sessionVersion:2,userFamilyID:''};
 const invite={token,inviteType:'family',familyID:familyId,email:user.email,invitedByUserID:adminId,permissionStatus:'Guest',createdAt:new Date()};
 const family={_id:familyId,name:'Example Family',deletedAt:null,familyMembers:[{familyMemberID:adminId,familyMemberName:'Admin',familyMemberEmail:'admin@example.invalid',permissionStatus:'Admin',memberConnected:true},{familyMemberID:'',familyMemberEmail:user.email,permissionStatus:'Admin',memberConnected:false}]};
 globalThis.invitationFixture={actor:{...user},data:{users:[user,{_id:otherId,email:'other@example.invalid',emailVerifiedAt:'2026-01-01',sessionVersion:2,userFamilyID:''},{_id:adminId,email:'admin@example.invalid',emailVerifiedAt:'2026-01-01',userFamilyID:familyId}],invites:[invite],family},writes:0};
});
test.after(()=>{assert.equal(path.dirname(directory),os.tmpdir());fs.rmSync(directory,{recursive:true,force:true})});
const invite=()=>({...globalThis.invitationFixture.data.invites[0]});
const accept=()=>api.acceptFamilyInviteForUser(invite(),globalThis.invitationFixture.actor);
function request(body){return{url:'https://recipesafe.example.invalid/api/invite/accept',headers:{get:key=>key==='content-type'?'application/json':key==='origin'?'https://recipesafe.example.invalid':null},json:async()=>body}}

test('verified intended recipient joins with stored role, replacing pending roles and consuming token once',async()=>{
 const f=globalThis.invitationFixture;const supplied=invite();const result=await api.acceptFamilyInviteForUser(supplied,f.actor);assert.equal(result.success,true);assert.equal(f.data.users[0].userFamilyID,familyId);const member=f.data.family.familyMembers.find(member=>member.familyMemberID===recipientId);assert.equal(member.permissionStatus,'Guest');assert.equal(member.memberConnected,true);assert.equal(f.data.family.familyMembers.filter(member=>member.familyMemberEmail==='recipient@example.invalid').length,1);assert.equal(f.data.invites.length,0);const before=f.writes;assert.equal((await api.acceptFamilyInviteForUser(supplied,f.actor)).success,false);assert.equal(f.writes,before);
});

test('unverified actors and wrong-recipient emails or IDs fail before family writes',async()=>{
 const f=globalThis.invitationFixture;f.actor.emailVerifiedAt=null;assert.equal((await accept()).success,false);f.actor.emailVerifiedAt='2026-01-01';f.actor.email='other@example.invalid';assert.equal((await accept()).success,false);f.actor.email='recipient@example.invalid';f.actor._id=otherId;assert.equal((await accept()).success,false);assert.equal(f.writes,0);assert.equal(f.data.invites.length,1);
});

test('stored recipient verification or session revocation is rechecked inside the transaction',async()=>{
 const f=globalThis.invitationFixture;f.data.users[0].emailVerifiedAt=null;assert.equal((await accept()).success,false);f.data.users[0].emailVerifiedAt='2026-01-01';f.data.users[0].sessionVersion=3;assert.equal((await accept()).success,false);f.data.users[0].sessionVersion=2;f.data.users[0].email='changed@example.invalid';assert.equal((await accept()).success,false);assert.equal(f.writes,0);
});

test('deactivated or purging recipients cannot accept with a stale active session; legacy status remains active',async()=>{
 const f=globalThis.invitationFixture;
 for(const accountStatus of ['deactivated','purging']){
  f.data.users[0].accountStatus=accountStatus;
  assert.equal((await accept()).success,false);
  assert.equal(f.writes,0);
  assert.equal(f.data.invites.length,1);
 }
 delete f.data.users[0].accountStatus;
 assert.equal((await accept()).success,true);
});

test('an inactive inviter or stale family membership cannot authorize an invitation even with a connected admin entry',async()=>{
 const f=globalThis.invitationFixture,inviter=f.data.users.find(user=>user._id===adminId);
 for(const accountStatus of ['deactivated','purging']){
  inviter.accountStatus=accountStatus;
  assert.equal((await accept()).success,false);
 }
 inviter.accountStatus='active';inviter.userFamilyID='another-family';
 assert.equal((await accept()).success,false);
 assert.equal(f.writes,0);assert.equal(f.data.invites.length,1);
});

test('legacy invitations without provenance, expired invitations and community tokens fail closed',async()=>{
 const f=globalThis.invitationFixture;delete f.data.invites[0].invitedByUserID;assert.equal((await api.findValidInviteByToken(token)).invite,null);assert.equal((await accept()).success,false);f.data.invites[0].invitedByUserID=adminId;f.data.invites[0].createdAt=new Date(Date.now()-8*24*60*60_000);assert.equal((await accept()).success,false);f.data.invites[0].createdAt=new Date();f.data.invites[0].inviteType='community';assert.equal((await accept()).success,false);assert.equal(f.writes,0);
});

test('inviter must remain a connected admin by immutable ID, regardless of matching email',async()=>{
 const f=globalThis.invitationFixture;const admin=f.data.family.familyMembers[0];admin.memberConnected=false;assert.equal((await accept()).success,false);admin.memberConnected=true;admin.permissionStatus='Member';assert.equal((await accept()).success,false);admin.permissionStatus='Admin';admin.familyMemberID=otherId;admin.familyMemberEmail='admin@example.invalid';assert.equal((await accept()).success,false);assert.equal(f.writes,0);
});

test('archived families and recipients already connected to another family are rejected',async()=>{
 const f=globalThis.invitationFixture;f.data.family.deletedAt=new Date();assert.equal((await accept()).success,false);f.data.family.deletedAt=null;f.data.users[0].userFamilyID='another-family';const result=await accept();assert.equal(result.success,false);assert.equal(result.status,409);assert.equal(f.data.users[0].userFamilyID,'another-family');assert.equal(f.writes,0);
});

test('existing connected members keep their current role when accepting an old higher-privilege invitation',async()=>{
 const f=globalThis.invitationFixture;f.data.invites[0].permissionStatus='Admin';f.data.users[0].userFamilyID=familyId;f.data.family.familyMembers.push({familyMemberID:recipientId,familyMemberEmail:f.actor.email,permissionStatus:'Member',memberConnected:true});assert.equal((await accept()).success,true);assert.equal(f.data.family.familyMembers.find(member=>member.familyMemberID===recipientId).permissionStatus,'Member');
});

test('accept endpoint ignores body user, family, sender and role overrides, using session identity and trusted stored invitation',async()=>{
 const f=globalThis.invitationFixture;const response=await api.acceptPOST(request({token,userId:otherId,familyId:'forged-family',permissionStatus:'Admin',invitedByUserID:otherId,invite:{token,email:'other@example.invalid',permissionStatus:'Admin',familyID:'forged-family'}}));assert.equal(response.status,200);assert.equal(f.data.users[0].userFamilyID,familyId);assert.equal(f.data.users[1].userFamilyID,'');assert.equal(f.data.family.familyMembers.find(member=>member.familyMemberID===recipientId).permissionStatus,'Guest');
});
