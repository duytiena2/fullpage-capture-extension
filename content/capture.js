(function() {
  // Prevent double injection
  if (window.__fullPageCaptureRunning) return;
  window.__fullPageCaptureRunning = true;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Create progress indicator overlay
  function createProgressOverlay() {
    const overlay = document.createElement('div');
    overlay.id = '__fullpage_capture_overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      background: rgba(26, 32, 44, 0.95);
      color: #fff;
      padding: 14px 20px;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 240px;
      pointer-events: none;
      transition: opacity 0.3s ease;
    `;
    overlay.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 600;">
        <span style="display: flex; align-items: center; gap: 6px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #38bdf8; animation: pulse 1s infinite alternate;"></span>
          Đang chụp trang...
        </span>
        <span id="__fp_percent" style="color: #38bdf8;">0%</span>
      </div>
      <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.15); border-radius: 3px; overflow: hidden;">
        <div id="__fp_bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #38bdf8, #818cf8); transition: width 0.2s ease;"></div>
      </div>
      <div id="__fp_status" style="font-size: 11px; color: #94a3b8;">Đang tính toán kích thước...</div>
      <style>
        @keyframes pulse { from { opacity: 0.4; } to { opacity: 1; } }
      </style>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function updateProgress(percent, text) {
    const bar = document.getElementById('__fp_bar');
    const pct = document.getElementById('__fp_percent');
    const status = document.getElementById('__fp_status');
    if (bar) bar.style.width = `${percent}%`;
    if (pct) pct.innerText = `${percent}%`;
    if (status && text) status.innerText = text;
  }

  function removeOverlay() {
    const overlay = document.getElementById('__fp_overlay_style');
    if (overlay) overlay.remove();
    const el = document.getElementById('__fullpage_capture_overlay');
    if (el) el.remove();
    window.__fullPageCaptureRunning = false;
  }

  async function executeCapture(isFullPage = true) {
    const originalScrollX = window.scrollX;
    const originalScrollY = window.scrollY;

    // Hide scrollbars temporarily for clean screenshots
    const style = document.createElement('style');
    style.id = '__fp_overlay_style';
    style.textContent = `
      *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
      html, body { scrollbar-width: none !important; -ms-overflow-style: none !important; }
    `;
    document.documentElement.appendChild(style);

    const overlay = createProgressOverlay();

    try {
      const dpr = window.devicePixelRatio || 1;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const scrollWidth = Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
        document.documentElement.clientWidth,
        window.innerWidth
      );
      const scrollHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        document.documentElement.clientHeight,
        window.innerHeight
      );

      const chunks = [];

      if (!isFullPage) {
        // Just capture visible screen
        updateProgress(50, 'Đang chụp vùng nhìn thấy...');
        await sleep(150);
        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE' }, resolve);
        });
        if (!res || !res.success) throw new Error(res?.error || 'Lỗi chụp màn hình');
        chunks.push({
          y: 0,
          height: viewportHeight,
          overlap: 0,
          dataUrl: res.dataUrl
        });
        updateProgress(100, 'Hoàn thành!');
      } else {
        // Full page scrolling capture
        let currentY = 0;
        let previousY = 0;
        const totalSteps = Math.ceil(scrollHeight / viewportHeight);
        let step = 0;

        while (currentY < scrollHeight) {
          step++;
          window.scrollTo(0, currentY);
          // Wait for render / lazy loaded images
          await sleep(250);

          const percent = Math.min(95, Math.round((step / totalSteps) * 100));
          updateProgress(percent, `Đang cuộn trang (${step}/${totalSteps})...`);

          const res = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE' }, resolve);
          });
          if (!res || !res.success) throw new Error(res?.error || 'Không thể chụp ảnh tab');

          // Calculate overlap for stitching if at bottom
          const actualY = window.scrollY;
          const overlap = (currentY > 0 && actualY < currentY) ? (currentY - actualY) : 0;

          chunks.push({
            y: actualY,
            targetY: currentY,
            viewportHeight,
            viewportWidth,
            dataUrl: res.dataUrl
          });

          if (actualY + viewportHeight >= scrollHeight) {
            break; // Reached bottom
          }

          previousY = actualY;
          currentY += viewportHeight;
          if (currentY + viewportHeight > scrollHeight) {
            currentY = scrollHeight - viewportHeight;
            if (currentY <= previousY) break; // Reached bottom edge
          }
        }
        updateProgress(100, 'Đang tạo bản ảnh hoàn chỉnh...');
      }

      // Restore original scroll
      window.scrollTo(originalScrollX, originalScrollY);
      await sleep(100);

      // Send payload to background to store & open editor
      const payload = {
        meta: {
          title: document.title || 'Screenshot',
          url: window.location.href,
          scrollWidth,
          scrollHeight: isFullPage ? scrollHeight : viewportHeight,
          viewportWidth,
          viewportHeight,
          dpr,
          isFullPage,
          createdAt: new Date().toISOString()
        },
        chunks
      };

      chrome.runtime.sendMessage({
        action: 'SAVE_AND_OPEN_EDITOR',
        payload
      });

    } catch (err) {
      console.error('FullPage Capture Error:', err);
      alert('Lỗi chụp màn hình: ' + err.message);
    } finally {
      removeOverlay();
    }
  }

  // Listen for trigger command
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'RUN_CAPTURE') {
      executeCapture(msg.isFullPage);
      sendResponse({ received: true });
    }
  });
})();
