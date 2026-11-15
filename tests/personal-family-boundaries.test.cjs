const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { NextResponse } = require('next/server');
const root = path.resolve(__dirname, '..');

function load(file, overrides = {}, environment = 'production') {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX}, fileName: file,
  }).outputText;
  const module = {exports:{}};
  const mockRequire = name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === '@/lib/features') return {COMMUNITIES_ENABLED: environment !== 'production'};
    if (name === '@/lib/data-normalization') return {normalizeId: value => value == null ? '' : String(value)};
    if (name === 'next/server') return {NextResponse};
    throw new Error('Unexpected service dependency: ' + name);
  };
  vm.runInNewContext(`(function(require,module,exports,process){${source}\n})`, { URL }, {filename:file})(mockRequire,module,module.exports,{env:{NODE_ENV:environment}});
  return module.exports;
}

test('client user DTO allowlists fields and never serializes credentials or newly added model secrets', () => {
  const {toCurrentUserDTO,toPublicUserDTO} = load('lib/security/user-dto.ts');
  const user = {_id:'user-id', name:'Tester', email:'private@example.invalid', password:'credential-hash',
    resetPasswordToken:'reset-secret', emailVerificationTokenHash:'verification-secret', googleProviderId:'provider-secret',
    arbitraryFutureSecret:'new-secret', userFamilyID:'family-id', communityIDs:['hidden-community'], recipeIDs:['recipe-id'], favoriteRecipeIDs:['favorite-id']};
  const current = toCurrentUserDTO(user);
  assert.equal(current.password,''); assert.equal(current.resetPasswordToken,'');
  const serialized = JSON.stringify(current);
  for (const value of ['credential-hash','reset-secret','verification-secret','provider-secret','new-secret','hidden-community']) assert.ok(!serialized.includes(value));
  assert.equal(current.email,user.email);
  const publicUser=toPublicUserDTO(user);
  assert.equal(publicUser.email,''); assert.equal(publicUser.userFamilyID,''); assert.equal(publicUser.recipeIDs.length,0);
});

test('family identity requires connected immutable ID; matching email or pending admin cannot grant access', () => {
  const policy=load('lib/family-policy.ts');
  const family={familyMembers:[{familyMemberID:'original-id',familyMemberEmail:'reused@example.invalid',permissionStatus:'Admin',memberConnected:true},
    {familyMemberID:'pending-id',familyMemberEmail:'pending@example.invalid',permissionStatus:'Admin',memberConnected:false},
    {familyMemberID:'member-id',permissionStatus:'Member',memberConnected:true}]};
  assert.equal(policy.connectedFamilyMember(family,'different-id'),null);
  assert.equal(policy.connectedFamilyMember(family,'pending-id'),null);
  assert.equal(policy.hasConnectedAdmin([family.familyMembers[1]]),false);
  assert.equal(policy.canDeleteFamily(family,'member-id'),false);
  assert.equal(policy.canDeleteFamily(family,'original-id'),true); // Any connected admin may archive, even with other members.
});

test('cookie-authenticated JSON mutations reject cross-origin, null-origin and text form submissions', () => {
  const {isSameOriginJSON}=load('lib/security/request.ts');
  function request(type, origin) { return {url:'https://app.example.invalid/api/invite/send',headers:{get:key=> key==='content-type'?type:origin}}; }
  assert.equal(isSameOriginJSON(request('application/json','https://app.example.invalid')),true);
  assert.equal(isSameOriginJSON(request('application/json','https://other.example.invalid')),false);
  assert.equal(isSameOriginJSON(request('application/json','null')),false);
  assert.equal(isSameOriginJSON(request('text/plain','https://app.example.invalid')),false);
});

test('legacy invitation test route is inert before any auth, database, or mail implementation can load', async () => {
  const {POST}=load('app/api/invite/test/route.ts');
  const response=await POST(); assert.equal(response.status,404);
});

test('support ownership is bound to immutable user ID instead of email reuse', () => {
  const {inquiryAccessFilter}=load('lib/inquiry-access.ts',{'@/lib/admin':{isInquiryAdmin:()=>false}});
  const filter=inquiryAccessFilter({_id:'new-user-id',email:'reused@example.invalid'});
  assert.equal(filter.inquirerUserID,'new-user-id'); assert.equal(Object.hasOwn(filter,'inquirerEmail'),false);
});

test('pending admin demotion updates the stored invitation atomically and cannot manufacture a connected member', async () => {
  const policy=load('lib/family-policy.ts'); let saves=0; const writes=[];
  const session={id:'transaction'};
  const family={familyMembers:[{familyMemberID:'admin',familyMemberEmail:'a@example.invalid',permissionStatus:'Admin',memberConnected:true},
    {familyMemberID:'',familyMemberEmail:'pending@example.invalid',permissionStatus:'Admin',memberConnected:false}],async save(options){assert.equal(options.session,session);saves++;}};
  const {UpdateFamilyMemberStatuses}=load('utils/server-actions/family/update.ts',{
    'next/cache':{revalidatePath(){}}, '@/lib/family-policy':policy,
    '@/lib/family-mutations':{familyFailure:message=>({success:false,message,members:[]}),withFamilyMutation:async(id,fn)=>fn({user:{_id:'admin'},family,member:family.familyMembers[0],session})},
    './utils':{getRevalidationPath:x=>x,sanitizeFamilyMember:member=>({...member}),verifyUserPassword:async()=>true},
    '@/models/invite':{__esModule:true,default:{async updateMany(query,update,options){writes.push({query,update,options});}}},
  });
  const changed={...family.familyMembers[1],permissionStatus:'Member',memberConnected:true};
  const result=await UpdateFamilyMemberStatuses('family',[changed],'password','/family');
  assert.equal(result.success,true); assert.equal(saves,1); assert.equal(result.members[1].memberConnected,false);
  assert.equal(writes[0].query.email,'pending@example.invalid'); assert.equal(writes[0].update.$set.permissionStatus,'Member'); assert.equal(writes[0].options.session,session);
  saves=0; writes.length=0;
  const failed=await UpdateFamilyMemberStatuses('family',[{...family.familyMembers[0],permissionStatus:'Member'}],'password','/family');
  assert.equal(failed.success,false);assert.equal(saves,0);assert.equal(writes.length,0);
});
