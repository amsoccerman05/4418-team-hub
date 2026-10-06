// A deliberately small hook harness for dispatch ordering only. It runs the real
// Onboarding sender, batch runner, invitation adapter, suite broker and installed SDK.
// It does not claim to validate React rendering, layout or browser event scheduling.
const fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const root=process.cwd(),repoRequire=createRequire(path.join(root,'package.json'));
const ts=repoRequire('typescript');
function harness(overrides = {}) {
  const cache = new Map(), states = [], effects = [];
  let cursor = 0, capturedRunner;
  const react = {
    useRef(initial) { const i = cursor++; return states[i] ??= {current: initial}; },
    useState(initial) {
      const i = cursor++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
    },
    useEffect(fn) { effects.push(fn); },
  };
  const jsx = (type, props, key) => ({type, props, key});
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
    }).outputText;
    new Function('require', 'exports', js)(id => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return {jsx, jsxs: jsx};
      if (id === 'lucide-react') return new Proxy({}, {get: () => () => null});
      if (id.endsWith('.css')) return {};
      if (id in overrides) return overrides[id]();
      if (!id.startsWith('.')) return repoRequire(id);
      let next = path.resolve(path.dirname(file), id);
      if (!path.extname(next)) next += fs.existsSync(next + '.ts') ? '.ts' : '.tsx';
      const result = load(next);
      if (id === './invitation-batch') return {...result, createInvitationBatchRunner: options =>
        capturedRunner = result.createInvitationBatchRunner(options)};
      return result;
    }, exports);
    return exports;
  }
  function mount({actorId='account-A',identitySignal=new AbortController().signal,isCurrentIdentity=()=>true}={}) {
    const empty = {members: [], areas: [], invitations: []};
    load('src/team/Onboarding.tsx').Onboarding({
      active: true, actorId, identitySignal, isCurrentIdentity, data: empty, existingEmails: [], busy: false,
      onBlock() {}, onBusyChange() {}, refresh: async () => empty, onActivity() {}, onMember() {},
    });
    const cleanups = effects.map(fn => fn()).filter(Boolean);
    return {runner: capturedRunner, unmount: () => cleanups.forEach(fn => fn())};
  }
  function reviewedRows(count) {
    const batch = load('src/team/invitation-batch.ts');
    const rows = Array.from({length: count}, (_, index) => batch.createInvitationRow({
      display_name: 'Synthetic target ' + (index + 1), email: `fixture${index + 1}@example.test`,
      reason: 'Local isolated reproduction',
    }, () => `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`));
    return batch.reviewInvitationBatch(rows, {areas: [], existingEmails: []}).rows;
  }
  return {load, mount, reviewedRows};
}

module.exports={harness};
