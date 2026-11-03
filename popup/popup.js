document.addEventListener('DOMContentLoaded', () => {
  const btnFullPage = document.getElementById('btn-fullpage');
  const btnVisible = document.getElementById('btn-visible');

  async function triggerCapture(isFullPage, selectContainer = false) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        alert('Không tìm thấy tab hoạt động.');
        return;
      }

      // Restricted chrome internal URLs check
      if (
        !tab.url || tab.url.startsWith('chrome://') ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://') ||
        tab.url.startsWith('about:') ||
        tab.url.startsWith('view-source:')
      ) {
        alert('Không thể chụp các trang nội bộ của trình duyệt (chrome://, extension...). Vui lòng mở một website thông thường.');
        return;
      }

      // Inject content script
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/capture.js']
      });

      // Send trigger message
      await chrome.tabs.sendMessage(tab.id, {
        action: 'RUN_CAPTURE',
        isFullPage,
        selectContainer
      });

      // Close popup so it doesn't stay on screen
      window.close();
    } catch (err) {
      console.error(err);
      alert('Lỗi khởi động chụp: ' + (err.message || 'Không thể tương tác với tab này'));
    }
  }

  btnFullPage.addEventListener('click', () => triggerCapture(true));
  btnVisible.addEventListener('click', () => triggerCapture(false));
  document.getElementById('btn-container').addEventListener('click', () => triggerCapture(true, true));
});
