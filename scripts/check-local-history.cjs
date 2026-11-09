// Exercise the real completion bridge and history store without making API requests.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const parser = require('@babel/parser');
const { transformSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const checker = fs.readFileSync(path.join(root, 'public/original-check/check.js'), 'utf8');
const body = parser.parse(checker).program.body[0].expression.callee.body.body;
const functions = ['tell', 'tellSuiteDone', 'recordLocal', 'plainCandyRows', 'inSitePage', 'inParentCheck', 'replaySaved', 'hubHref', 'hubRows', 'readList', 'historyStamp'];
const bridge = functions.map(name => {
  const node = body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert(node, name);
  return checker.slice(node.start, node.end);
}).join('\n');
const parentSource = fs.readFileSync(path.join(root, 'src/basic-run.jsx'), 'utf8') + '\nexport { onWindowMessage as receiveRecord };';
const parentCode = transformSync(parentSource, { loader: 'jsx', format: 'cjs' }).code;

function storage() {
  const items = new Map();
  return {
    get length() { return items.size; },
    key(i) { return [...items.keys()][i] ?? null; },
    getItem(k) { return items.get(k) ?? null; },
    setItem(k, v) { items.set(k, String(v)); },
    removeItem(k) { items.delete(k); },
  };
}
function setup({ embedded = false, hosted = true, hidden = false, source = bridge, store = storage() } = {}) {
  const origin = 'https://checker.example.test';
  const messages = [], points = [], rendered = [];
  const frame = {};
  let view = 'pelican';
  const document = {
    querySelector(selector) {
      if (selector === '.check-host') return hosted ? {} : null;
      if (selector === '.mc-view.is-on') return { getAttribute: () => view };
      if (selector === "[data-test='pelican']") return {};
      return null;
    },
    querySelectorAll: () => embedded ? [{ contentWindow: frame }] : [],
  };
  const window = { location: { origin }, dispatchEvent() {} };
  const shared = { window, document, localStorage: store, sessionStorage: storage(), URL, Event, console, setTimeout, clearTimeout };
  const parent = vm.createContext({ ...shared, module: { exports: {} }, require(name) {
    if (name === './points.js') return { grant: (...args) => points.push(args) };
    if (name === './published-basic.json') return {};
    if (['react', 'react-router-dom', './poster-canvas.js', './ui.jsx', './report-loading.jsx'].includes(name)) return {};
    throw new Error('Unexpected import: ' + name);
  } });
  vm.runInContext(parentCode, parent);
  const deliver = (payload, targetOrigin) => {
    assert.equal(targetOrigin, origin);
    messages.push(payload);
    parent.module.exports.receiveRecord({ origin, source: embedded ? frame : window, data: payload });
  };
  window.postMessage = deliver;
  window.parent = embedded ? { postMessage: deliver } : window;
  const state = {
    suiteStarted: 1794090000000,
    pelicanHtml: '<!doctype html><html><body><svg>saved output</svg></body></html>',
    candyRows: [{ title: 'Question', prompt: 'Fixture?', options: [], answer: 'A', picked: 'A', ok: true }],
    candyUi: { seq: 2 },
  };
  const context = vm.createContext({ ...shared, location: window.location, state, leaving: false,
    $: id => ({ base: { value: 'https://relay.example.test' }, modelPickLabel: { textContent: 'Fixture model' }, scoreValue: { textContent: '89' } })[id],
    G: { normalizeBase: s => s }, chosenModel: () => 'fixture-model',
    isHiddenRunner: () => hidden, basicReachedApi: () => true,
    candyCounts: () => ({ right: 1, total: 1 }), cardStatus: () => 'pass', summaryOf: () => 'Completed fixture',
    showResult: (...args) => rendered.push(args), renderCandyReport: rows => rendered.push(rows),
  });
  vm.runInContext(source, context);
  return { context, state, store, messages, points, rendered, parent, setView: value => { view = value; } };
}

for (const embedded of [false, true]) {
  const t = setup({ embedded });
  vm.runInContext('tellSuiteDone("pelican")', t.context);
  const entries = t.parent.module.exports.readBasicHistory();
  assert.equal(entries.length, 1, 'Pelican completion must appear in history');
  const id = entries[0].id;
  const report = JSON.parse(t.store.getItem('veridrop-basic-report:' + id));
  assert.equal(report.pelicanHtml, t.state.pelicanHtml);
  assert.equal(report.replay, 'pelican');
  assert.equal(report.result, '通过');
  assert.equal(entries[0].score, null, 'Do not invent a basic score for pelican');
  assert.equal(report.keyMask, '');
  assert(!('key' in report));
  assert.equal(t.messages.filter(m => m.type === 'veridrop-local-record').length, 1);
  assert.equal(t.points.length, 2, 'Preserve existing points handling');
  vm.runInContext('tellSuiteDone("pelican")', t.context);
  assert.equal(t.parent.module.exports.readBasicHistory().length, 1, 'Duplicate completion stays one record');
  const refreshed = setup({ store: t.store });
  assert.equal(refreshed.parent.module.exports.readBasicHistory()[0].id, id, 'Record survives reinitialization');
  vm.runInContext('replaySaved({id:' + JSON.stringify(id) + '})', refreshed.context);
  assert.equal(refreshed.rendered[0][5], t.state.pelicanHtml, 'Replay uses saved generated HTML');
  const href = vm.runInContext('hubHref(hubRows()[0])', t.context);
  assert(href.includes('/check/pelican?replay=' + id));

  t.state.suiteStarted += 1000;
  vm.runInContext('tellSuiteDone("candy")', t.context);
  const candy = t.parent.module.exports.readBasicHistory().find(e => e.suite === 'candy');
  assert(candy, 'Candy uses the same completion bridge');
  assert.equal(candy.score, 100);
  refreshed.setView('candy');
  vm.runInContext('replaySaved({id:' + JSON.stringify(candy.id) + '})', refreshed.context);
  assert.equal(refreshed.rendered[1][0].prompt, 'Fixture?');
  const before = t.store.length;
  vm.runInContext('tellSuiteDone("basic"); tellSuiteDone("all")', t.context);
  assert.equal(t.store.length, before, 'Basic/all completion must not create standalone records');
  if (!embedded) assert(t.messages.every(m => m.type === 'veridrop-local-record'), 'Only records cross the same-window bridge');
}
const unhosted = setup({ hosted: false });
vm.runInContext('tellSuiteDone("pelican")', unhosted.context);
assert.equal(unhosted.messages.length, 0, 'Standalone external checker stays isolated');
const hidden = setup({ embedded: true, hosted: false, hidden: true });
vm.runInContext('tellSuiteDone("pelican")', hidden.context);
assert(!hidden.messages.some(m => m.type === 'veridrop-local-record'), 'Hidden runner must not double-save');
console.log('PASS: inline + iframe history, refresh + replay, deduplication, candy, unchanged basic/all transport, no saved credentials.');
