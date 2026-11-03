importScripts('lib/db.js');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'CAPTURE_VISIBLE') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, dataUrl });
      }
    });
    return true; // Keep channel open for async response
  }

  if (request.action === 'SAVE_AND_OPEN_EDITOR') {
    const captureId = 'cap_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    saveCaptureData(captureId, request.payload)
      .then(() => {
        const editorUrl = chrome.runtime.getURL(`editor/editor.html?id=${captureId}`);
        chrome.tabs.create({ url: editorUrl }, (tab) => {
          sendResponse({ success: true, captureId, tabId: tab.id });
        });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});
