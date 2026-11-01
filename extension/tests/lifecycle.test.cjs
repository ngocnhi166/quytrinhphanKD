const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

async function setup(fail = false) {
  const removed = [], sent = [], saved = {}, created = [], focused = [];
  let ws;
  let listener;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    constructor() { ws = this; }
    send(value) { sent.push(JSON.parse(value)); }
    close() { this.closed = true; }
  }
  const noop = () => {};
  const chrome = {
    storage: { local: { get: async () => ({ token: 'test-token' }), set: async data => Object.assign(saved, data) }, session: { set: async () => {}, remove: async () => {} } },
    tabs: { query: async () => [{ id: 7, url: 'http://127.0.0.1:3000/' }], update: async id => focused.push(id), create: async options => { created.push(options); return { id: 42 }; }, get: async () => ({ status: 'complete', url: 'https://chatgpt.com/' }), remove: async id => removed.push(id), sendMessage: async () => fail === 'event' ? { started: true } : fail ? { error: 'Upload failed' } : { text: 'Analysis output' } },
    scripting: { executeScript: async () => {} },
    runtime: { id: 'test', onMessage: { addListener: fn => { listener = fn; } }, onStartup: { addListener: noop }, onInstalled: { addListener: noop } },
    alarms: { clear: noop, create: noop, onAlarm: { addListener: noop } },
  };
  const context = vm.createContext({ chrome, WebSocket: Socket, console, AbortSignal, fetch: async () => ({ ok: true, json: async () => ({ token: 'auto-token' }) }), setInterval: () => 1, clearInterval: noop, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(require.resolve('../background.js'), 'utf8'), context);
  assert.equal(ws, undefined, 'must not auto-connect on startup');
  await new Promise(resolve => listener({ type: 'connect' }, { id: 'test' }, resolve));
  await new Promise(resolve => setImmediate(resolve));
  ws.onmessage({ data: JSON.stringify({ type: 'run', id: 'job-1', filename: 'sales.csv', file: 'YQ==', prompt: 'Analyze' }) });
  await new Promise(resolve => setImmediate(resolve));
  return { ws, removed, sent, created, focused, control: msg => new Promise(resolve => listener(msg, { id: 'test' }, resolve)), dispatch: (msg, tab = 42) => listener(msg, { id: 'test', tab: { id: tab } }, noop) };
}

test('success tab closes only after backend saved acknowledgement', async () => {
  const { ws, removed, sent, created, focused } = await setup();
  assert.equal(created[0].active, false);
  assert.equal(sent[0].type, 'result');
  assert.equal(sent[0].text, 'Analysis output');
  assert.deepEqual(removed, []);
  ws.onmessage({ data: JSON.stringify({ type: 'saved', id: 'wrong-job' }) });
  assert.deepEqual(removed, []);
  ws.onmessage({ data: JSON.stringify({ type: 'saved', id: 'job-1' }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(removed, [42]);
  assert.deepEqual(focused, [7]);
});

test('failed tab is retained for diagnosis after error is saved', async () => {
  const { ws, removed, sent } = await setup(true);
  assert.equal(sent[0].error, 'Upload failed');
  ws.onmessage({ data: JSON.stringify({ type: 'saved', id: 'job-1' }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(removed, []);
});
test('receives result as a separate event without holding request channel open', async () => {
  const { ws, removed, sent, dispatch } = await setup('event');
  assert.deepEqual(sent, []);
  dispatch({ type: 'analysis-result', id: 'job-1', text: 'Wrong tab' }, 99);
  assert.deepEqual(sent, []);
  dispatch({ type: 'analysis-progress', id: 'job-1', text: 'Ha' });
  assert.equal(sent[0].type, 'progress');
  dispatch({ type: 'analysis-result', id: 'job-1', text: 'Ha Noi' });
  assert.equal(sent[1].text, 'Ha Noi');
  assert.deepEqual(removed, []);
  ws.onmessage({ data: JSON.stringify({ type: 'saved', id: 'job-1' }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(removed, [42]);
});
test('reveals only its own background tab so the full reply renders', async () => {
  const { focused, dispatch } = await setup('event');
  dispatch({ type: 'reveal', id: 'job-1' }, 99);
  dispatch({ type: 'reveal', id: 'other-job' });
  assert.deepEqual(focused, []);
  dispatch({ type: 'reveal', id: 'job-1' });
  assert.deepEqual(focused, [42]);
});
test('close tool disconnects and closes only its owned processing tab', async () => {
  const { ws, removed, control } = await setup('event');
  await control({ type: 'disconnect' });
  assert.equal(ws.closed, true);
  assert.deepEqual(removed, [42]);
});
