const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { NextResponse } = require('next/server');

const root = path.resolve(__dirname, '..');
const notFoundSignal = new Error('notFound');

function loadModule(relativePath, environment, mocks = {}) {
  const filename = path.join(root, relativePath);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const unavailable = () => { throw new Error('Blocked feature reached an application dependency'); };
  const mockRequire = name => {
    if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
    if (name === '@/lib/features' || name === './features' || name === './lib/features') return loadModule('lib/features.ts', environment);
    if (name === '@/lib/community-utils') return loadModule('lib/community-utils.ts', environment);
    if (name === 'next/server') return { NextResponse };
    if (name === 'next/navigation') return { notFound: () => { throw notFoundSignal; }, redirect: unavailable };
    if (name === '@/lib/metadata') return { createPageMetadata: value => value };
    if (name === 'react/jsx-runtime') return require(name);
    // No authentication, database, email, or network implementation is loaded.
    return new Proxy({ __esModule: true, default: unavailable }, { get: (target, key) => key in target ? target[key] : unavailable });
  };
  vm.runInNewContext(`(function(require,module,exports,process){${source}\n})`, {}, { filename })(
    mockRequire, module, module.exports, { env: { NODE_ENV: environment, NEXT_PUBLIC_ENABLE_COMMUNITIES: 'true' } }
  );
  return module.exports;
}

function filesWithin(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesWithin(file) : [file];
  });
}

test('communities are disabled in production and available in development without a production override', () => {
  assert.equal(loadModule('lib/features.ts', 'production').COMMUNITIES_ENABLED, false);
  assert.equal(loadModule('lib/features.ts', 'development').COMMUNITIES_ENABLED, true);
});

test('community paths cover pages and APIs with exact prefix boundaries', () => {
  const { isCommunitiesPath } = loadModule('lib/features.ts', 'production');
  for (const pathname of ['/communities', '/communities/', '/communities/posts/id', '/api/community', '/api/community/join/pw', '/api/post/create', '/api/%63ommunity/create', '/COMMUNITIES/example']) {
    assert.equal(isCommunitiesPath(pathname), true, pathname);
  }
  for (const pathname of ['/', '/family/id', '/u/profile', '/api/invite/accept', '/api/communityish', '/communities-later', '/api/poster']) {
    assert.equal(isCommunitiesPath(pathname), false, pathname);
  }
});

test('middleware blocks production community routes and preserves other pages and development routes', () => {
  const production = loadModule('middleware.ts', 'production');
  assert.equal(production.middleware({ nextUrl: { pathname: '/api/community/create' } }).status, 404);
  assert.equal(production.middleware({ nextUrl: { pathname: '/communities/example' } }).status, 404);
  assert.equal(production.middleware({ nextUrl: { pathname: '/family/example' } }).headers.get('x-middleware-next'), '1');
  const development = loadModule('middleware.ts', 'development');
  assert.equal(development.middleware({ nextUrl: { pathname: '/communities/example' } }).headers.get('x-middleware-next'), '1');
});

test('community client DTO removes password hashes while preserving editable public fields', () => {
  const { serializeCommunityForClient } = loadModule('lib/community-utils.ts', 'development');
  const value = serializeCommunityForClient({ _id: 'community', name: 'Test', communityPassword: 'secret-hash', privacyLevel: 'passwordProtected' });
  assert.equal(value.name, 'Test');
  assert.equal(value.privacyLevel, 'passwordProtected');
  assert.equal('communityPassword' in value, false);
});

test('production community navigation is grey, has no href, and explains availability on click', () => {
  const messages = [];
  const { default: CommunityLink } = loadModule('components/buttons/community-link.tsx', 'production', { sonner: { toast: { info: message => messages.push(message) } } });
  const button = CommunityLink({ children: 'Communities' });
  assert.equal(button.type, 'button');
  assert.equal(button.props['aria-disabled'], 'true');
  assert.equal(button.props.href, undefined);
  assert.match(button.props.className, /text-gray-500/);
  button.props.onClick();
  assert.deepEqual(messages, ['Communities are coming later']);
});

test('development community navigation retains its working destination', () => {
  const { default: CommunityLink } = loadModule('components/buttons/community-link.tsx', 'development');
  const link = CommunityLink({ children: 'Communities' });
  assert.equal(link.props.href, '/communities?page=1&size=10');
});

test('unfinished feature notices are grey and informative in production without submitting or navigating', () => {
  const messages = [];
  const { default: Notice } = loadModule('components/misc/production-feature-notice.tsx', 'production', { sonner: { toast: { info: message => messages.push(message) } } });
  const notice = Notice({ label: 'Profile enhancements', features: ['Edit biography', 'Change avatar'] });
  assert.equal(notice.type, 'section');
  const buttons = notice.props.children[2].props.children;
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.equal(button.props.type, 'button');
    assert.equal(button.props['aria-disabled'], 'true');
    assert.equal(button.props.href, undefined);
    assert.match(button.props.className, /text-gray-500/);
    button.props.onClick();
  }
  assert.deepEqual(messages, ['Edit biography is coming later', 'Change avatar is coming later']);
});

test('unfinished feature notices leave the existing development UI unchanged', () => {
  const { default: Notice } = loadModule('components/misc/production-feature-notice.tsx', 'development');
  assert.equal(Notice({ label: 'Recipe tools', features: ['Make an editable copy', 'Print recipe', 'Export recipe'] }), null);
});

test('production community modal actions cannot open while personal and family recipe actions remain available', () => {
  const messages = [];
  const { useModalStore } = loadModule('context/modalStore.tsx', 'production', {
    zustand: require('zustand'), sonner: { toast: { info: message => messages.push(message) } },
  });
  const actions = useModalStore.getState();
  actions.setOpenCreateCommunityModal(true);
  actions.setOpenCreatePostModal(true);
  actions.setRequestToJoinCommunity({ community: {}, type: 'restricted' });
  actions.setOpenPostModal({});
  actions.setOpenRecipeForm({ type: 'create', recipe: null, from: 'community', fromId: null });
  assert.equal(useModalStore.getState().openCreateCommunityModal, false);
  assert.equal(useModalStore.getState().openCreatePostModal, false);
  assert.equal(useModalStore.getState().requestToJoinCommunity, null);
  assert.equal(useModalStore.getState().openPostModal, null);
  assert.equal(useModalStore.getState().openRecipeForm.type, '');
  assert.equal(messages.length, 5);
  actions.setOpenRecipeForm({ type: 'create', recipe: null, from: 'personal', fromId: null });
  assert.equal(useModalStore.getState().openRecipeForm.from, 'personal');
  actions.setOpenRecipeForm({ type: 'create', recipe: null, from: 'family', fromId: 'family-id' });
  assert.equal(useModalStore.getState().openRecipeForm.fromId, 'family-id');
});

test('all community and post APIs reject production requests before reaching authentication or data dependencies', async () => {
  const files = [...filesWithin('app/api/community'), ...filesWithin('app/api/post')].filter(file => path.basename(file) === 'route.ts');
  for (const file of files) {
    const handlers = loadModule(file, 'production');
    for (const [method, handler] of Object.entries(handlers)) {
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) continue;
      const response = await handler({});
      assert.equal(response.status, 404, `${file} ${method}`);
      assert.equal((await response.json()).message, 'Communities are coming later');
    }
  }
});

test('development community API remains available to its authentication check', async () => {
  const { GET } = loadModule('app/api/community/get/route.ts', 'development');
  await assert.rejects(GET({}), /Blocked feature reached an application dependency/);
});

test('community pages and metadata reject production access before loading data', async () => {
  const files = filesWithin('app/(content)/communities').filter(file => path.basename(file) === 'page.tsx');
  for (const file of files) {
    const page = loadModule(file, 'production');
    await assert.rejects(page.default({}), error => error === notFoundSignal, file);
    if (page.generateMetadata) await assert.rejects(page.generateMetadata({}), error => error === notFoundSignal, `${file} metadata`);
  }
});
