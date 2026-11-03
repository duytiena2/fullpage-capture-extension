const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

function setup() {
  const sessions = new Map(), chunks = new Map(), events = {}, calls = [];
  const state = { active: 1, focused: true };
  const sender = { tab: { id: 1, windowId: 5 }, frameId: 0, documentId: 'doc' };
  const context = vm.createContext({ console, fetch, crypto: { randomUUID }, importScripts() {},
    setTimeout: fn => { queueMicrotask(fn); },
    saveCaptureData: async (id, data) => sessions.set(id, structuredClone(data)),
    getCaptureData: async id => sessions.get(id),
    saveCaptureChunk: async (id, index, blob) => chunks.set(id + ':' + index, blob),
    deleteCaptureData: async id => { sessions.delete(id); for (const key of chunks.keys()) if (key.startsWith(id + ':')) chunks.delete(key); },
    chrome: {
      tabs: {
        onActivated: { addListener: fn => events.activated = fn },
        get: async () => ({ active: state.active === 1, windowId: 5 }),
        captureVisibleTab: async (windowId, options) => { calls.push({ windowId, options }); if (state.during) await state.during(); return 'data:image/png;base64,AA=='; },
        create: async options => { calls.push(options); return { id: 10 }; }
      },
      windows: { get: async () => ({ focused: state.focused }), onFocusChanged: { addListener: fn => events.focus = fn } },
      runtime: { getURL: path => 'chrome-extension://test/' + path, onMessage: { addListener() {} } }
    }
  });
  vm.runInContext(fs.readFileSync('background.js', 'utf8'), context);
  const send = request => context.handleMessage(request, sender);
  return { send, context, state, events, calls, chunks, sessions, sender };
}
test('streams frame into storage, returns no image payload and opens editor after final save', async () => {
  const s = setup();
  const { captureId } = await s.send({ action: 'BEGIN_CAPTURE' });
  const result = await s.send({ action: 'CAPTURE_VISIBLE', captureId, index: 0 });
  assert.equal(result.success, true); assert.equal(result.dataUrl, undefined);
  assert.equal(s.calls[0].windowId, 5); assert.equal(s.chunks.size, 1);
  assert.equal(s.chunks.get(captureId + ':0').type, 'image/png');
  await s.send({ action: 'SAVE_AND_OPEN_EDITOR', captureId, payload: { meta: {}, chunks: [{ index: 0, y: 0 }] } });
  assert.ok(s.calls[1].url.endsWith(captureId));
});
test('rejects tab/window changes before capture and transient changes during capture', async () => {
  for (const mode of ['tab', 'window', 'transient']) {
    const s = setup(); const { captureId } = await s.send({ action: 'BEGIN_CAPTURE' });
    if (mode === 'tab') s.state.active = 2;
    if (mode === 'window') s.state.focused = false;
    if (mode === 'transient') s.state.during = async () => s.events.activated({ windowId: 5, tabId: 2 });
    await assert.rejects(s.send({ action: 'CAPTURE_VISIBLE', captureId, index: 0 }), /chuyển|đổi/);
    assert.equal(s.chunks.size, 0);
  }
});
test('abort removes incomplete frames; other documents cannot reuse a session', async () => {
  const s = setup(); const { captureId } = await s.send({ action: 'BEGIN_CAPTURE' });
  await s.send({ action: 'CAPTURE_VISIBLE', captureId, index: 0 });
  await assert.rejects(s.context.handleMessage({ action: 'CAPTURE_VISIBLE', captureId, index: 1 }, { ...s.sender, documentId: 'other' }), /không còn hợp lệ/);
  s.state.focused = false;
  await s.send({ action: 'ABORT_CAPTURE', captureId });
  assert.equal(s.sessions.size, 0); assert.equal(s.chunks.size, 0);
});
