importScripts('lib/db.js');
let captureQueue = Promise.resolve();
let lastCaptureAt = 0;
const inFlight = new Set();
chrome.tabs.onActivated.addListener(info => {
  for (const shot of inFlight) if (info.windowId === shot.windowId && info.tabId !== shot.tabId) shot.changed = true;
});
chrome.windows.onFocusChanged.addListener(windowId => {
  for (const shot of inFlight) if (windowId !== shot.windowId) shot.changed = true;
});
async function assertSource(source) {
  const [tab, window] = await Promise.all([chrome.tabs.get(source.tabId), chrome.windows.get(source.windowId)]);
  if (!tab.active || tab.windowId !== source.windowId || !window.focused) {
    throw new Error('Đã dừng vì bạn chuyển tab hoặc cửa sổ. Hãy chụp lại ở tab nguồn.');
  }
}
async function getSession(id, sender) {
  const session = await getCaptureData(id);
  if (!session?.pending || session.source.tabId !== sender.tab?.id ||
      session.source.documentId !== sender.documentId) throw new Error('Phiên chụp không còn hợp lệ.');
  return session;
}
async function handleMessage(request, sender) {
  if (!sender.tab || sender.frameId !== 0) throw new Error('Chỉ chụp từ tab nguồn.');
  if (request.action === 'BEGIN_CAPTURE') {
    const source = { tabId: sender.tab.id, windowId: sender.tab.windowId, documentId: sender.documentId };
    await assertSource(source);
    const captureId = 'cap_' + crypto.randomUUID();
    await saveCaptureData(captureId, { source, pending: true });
    return { success: true, captureId };
  }
  const session = await getSession(request.captureId, sender);
  if (request.action === 'ABORT_CAPTURE') {
    await deleteCaptureData(request.captureId);
    return { success: true };
  }
  await assertSource(session.source);
  if (request.action === 'CAPTURE_VISIBLE') {
    const task = captureQueue.then(async () => {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 550 - (Date.now() - lastCaptureAt))));
      const shot = { ...session.source, changed: false };
      inFlight.add(shot);
      try {
        await assertSource(session.source);
        if (shot.changed) throw new Error('Tab hoặc cửa sổ đã đổi. Hãy chụp lại.');
        lastCaptureAt = Date.now();
        const dataUrl = await chrome.tabs.captureVisibleTab(session.source.windowId, { format: 'png' });
        await assertSource(session.source);
        if (shot.changed) throw new Error('Tab hoặc cửa sổ đã đổi trong lúc chụp. Hãy chụp lại.');
        const blob = await (await fetch(dataUrl)).blob();
        await saveCaptureChunk(request.captureId, request.index, blob);
        return { success: true };
      } finally { inFlight.delete(shot); }
    });
    captureQueue = task.catch(() => {});
    return task;
  }
  if (request.action === 'SAVE_AND_OPEN_EDITOR') {
    await saveCaptureData(request.captureId, request.payload);
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('editor/editor.html?id=' + request.captureId) });
    return { success: true, tabId: tab.id };
  }
  throw new Error('Lệnh chụp không hợp lệ.');
}
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!['BEGIN_CAPTURE', 'CAPTURE_VISIBLE', 'SAVE_AND_OPEN_EDITOR', 'ABORT_CAPTURE'].includes(request.action)) return;
  handleMessage(request, sender).then(sendResponse, error => sendResponse({ success: false, error: error.message }));
  return true;
});
