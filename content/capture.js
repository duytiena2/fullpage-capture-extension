(function () {
  if (window.__fullPageCaptureInstalled) return;
  window.__fullPageCaptureInstalled = true;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const MAX_PIXELS = 64 * 1024 * 1024;
  const MAX_EDGE = 32767;

  async function executeCapture(isFullPage = true, selectContainer = false) {
    if (window.__fullPageCaptureRunning) return;
    window.__fullPageCaptureRunning = true;
    const original = { x: scrollX, y: scrollY };
    const changes = new Map();
    const controller = new AbortController();
    let root = null, rootScroll, captureId, finished = false, error;
    const overlay = document.createElement('div');
    overlay.id = '__fullpage_capture_overlay';
    overlay.style.cssText = 'position:fixed!important;top:16px!important;right:16px!important;z-index:2147483647!important;background:#111827!important;color:white!important;padding:14px!important;border-radius:10px!important;font:13px system-ui!important;box-shadow:0 4px 24px #0006!important;';
    const status = document.createElement('div');
    const cancel = document.createElement('button');
    cancel.textContent = 'Hủy (Esc)';
    cancel.style.cssText = 'margin-top:8px;padding:6px 12px;cursor:pointer;color:white;background:#374151;border:1px solid #94a3b8;border-radius:6px;';
    overlay.append(status, cancel);
    document.documentElement.append(overlay);
    let abortReason = 'Đã hủy chụp.';
    function abort(reason) { abortReason = reason; controller.abort(); }
    function check() {
      if (controller.signal.aborted) throw new DOMException(abortReason, 'AbortError');
    }
    cancel.addEventListener('click', () => abort('Đã hủy chụp.'));
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); abort('Đã hủy chụp.'); } };
    const onVisibility = () => { if (document.hidden) abort('Đã dừng vì bạn chuyển tab.'); };
    const onBlur = () => abort('Đã dừng vì cửa sổ nguồn mất tiêu điểm.');
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    function temporary(element, property, value) {
      let saved = changes.get(element);
      if (!saved) changes.set(element, saved = new Map());
      if (!saved.has(property)) saved.set(property, [element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
      element.style.setProperty(property, value, 'important');
    }
    function preparePositioned(hideFixed) {
      const scope = root || document;
      for (const element of scope.querySelectorAll('*')) {
        if (element === overlay || overlay.contains(element)) continue;
        const position = getComputedStyle(element).position;
        if (position === 'sticky') {
          temporary(element, 'position', 'relative');
          for (const edge of ['top', 'right', 'bottom', 'left']) temporary(element, edge, 'auto');
        } else if (hideFixed && position === 'fixed') {
          temporary(element, 'transition', 'none');
          temporary(element, 'opacity', '0');
        }
      }
    }
    async function message(action, extra = {}) {
      const res = await chrome.runtime.sendMessage({ action, captureId, ...extra });
      if (!res?.success) throw new Error(res?.error || 'Không thể liên lạc với tiện ích.');
      return res;
    }
    function waitForPaint() {
      return new Promise((resolve, reject) => {
        const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', stop); resolve(); };
        const stop = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', stop); reject(new DOMException(abortReason, 'AbortError')); };
        const timer = setTimeout(finish, 150);
        controller.signal.addEventListener('abort', stop, { once: true });
        requestAnimationFrame(() => requestAnimationFrame(finish));
        if (controller.signal.aborted) stop();
      });
    }
    async function chooseContainer() {
      status.textContent = 'Bấm vào vùng có thanh cuộn cần chụp.';
      const highlight = document.createElement('div');
      highlight.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:3px solid #38bdf8;background:#38bdf822;';
      document.documentElement.append(highlight);
      return new Promise((resolve, reject) => {
        let candidate;
        const cleanup = () => {
          document.removeEventListener('mousemove', move, true);
          document.removeEventListener('click', pick, true);
          controller.signal.removeEventListener('abort', stop);
          highlight.remove();
        };
        const stop = () => { cleanup(); reject(new DOMException(abortReason, 'AbortError')); };
        const find = target => {
          for (let el = target; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
            if (el.scrollHeight > el.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el;
          }
        };
        const move = e => {
          candidate = overlay.contains(e.target) ? null : find(e.target);
          highlight.style.display = candidate ? 'block' : 'none';
          if (candidate) {
            const r = candidate.getBoundingClientRect();
            Object.assign(highlight.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
          }
        };
        const pick = e => {
          if (overlay.contains(e.target)) return;
          const target = find(e.target);
          e.preventDefault(); e.stopImmediatePropagation();
          if (target) { cleanup(); resolve(target); }
          else status.textContent = 'Vùng này không có thanh cuộn. Hãy chọn bảng/panel có thể cuộn.';
        };
        document.addEventListener('mousemove', move, true);
        document.addEventListener('click', pick, true);
        controller.signal.addEventListener('abort', stop, { once: true });
      });
    }
    const clip = () => {
      if (!root) return { x: 0, y: 0, width: innerWidth, height: innerHeight };
      const r = root.getBoundingClientRect();
      const region = { x: r.left + root.clientLeft, y: r.top + root.clientTop, width: root.clientWidth, height: root.clientHeight };
      if (region.x < 0 || region.y < 0 || region.x + region.width > innerWidth + 1 || region.y + region.height > innerHeight + 1) {
        throw new Error('Hãy đưa toàn bộ vùng cuộn vào màn hình rồi chụp lại.');
      }
      return region;
    };
    const height = () => root ? root.scrollHeight : Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, innerHeight);
    const scrollPosition = () => root ? root.scrollTop : scrollY;
    const moveTo = y => root ? root.scrollTo({ left: 0, top: y, behavior: 'instant' }) : window.scrollTo({ left: 0, top: y, behavior: 'instant' });
    const validateSize = (width, totalHeight) => {
      const scale = devicePixelRatio || 1;
      if (width * scale > MAX_EDGE || totalHeight * scale > MAX_EDGE || width * totalHeight * scale * scale > MAX_PIXELS) {
        throw new Error('Ảnh quá lớn để xử lý an toàn. Hãy chụp vùng cuộn nhỏ hơn hoặc giảm mức zoom trình duyệt.');
      }
    };
    async function waitForContent(minWait = 0) {
      const start = performance.now();
      let previous = '', stable = 0;
      while (performance.now() - start < 2500) {
        check();
        const region = clip();
        const pending = [...(root || document).querySelectorAll('img')].some(img => {
          const r = img.getBoundingClientRect();
          return !img.complete && r.bottom > region.y && r.top < region.y + region.height && r.right > region.x && r.left < region.x + region.width;
        });
        const dimensions = [height(), scrollPosition(), region.width, region.height].join(',');
        stable = dimensions === previous && !pending ? stable + 1 : 0;
        if (stable >= 5 && performance.now() - start >= minWait) return;
        previous = dimensions;
        await sleep(100);
      }
    }
    try {
      if (selectContainer) {
        root = await chooseContainer();
        rootScroll = { x: root.scrollLeft, y: root.scrollTop };
        root.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
      check();
      captureId = (await message('BEGIN_CAPTURE')).captureId;
      const style = document.createElement('style');
      style.textContent = '*::-webkit-scrollbar{display:none!important} html,body{scrollbar-width:none!important;scroll-behavior:auto!important;scroll-snap-type:none!important}';
      document.documentElement.append(style);
      // Keep style in the same restoration path as host-page modifications.
      changes.set(style, new Map([['__remove', ['', '']]]));
      if (root) {
        temporary(root, 'scroll-behavior', 'auto');
        temporary(root, 'scroll-snap-type', 'none');
        temporary(root, 'scrollbar-width', 'none');
      }
      if (isFullPage) preparePositioned(false);
      await Promise.race([document.fonts?.ready || Promise.resolve(), sleep(1500)]);
      const viewportWidth = innerWidth, viewportHeight = innerHeight;
      const firstClip = clip();
      let totalHeight = isFullPage ? height() : firstClip.height;
      const chunks = [];
      let nextY = 0, previousY = -1;
      const started = performance.now();
      do {
        check();
        if (performance.now() - started > 120000) throw new Error('Trang tiếp tục tải quá lâu. Hãy chụp một vùng nhỏ hơn.');
        if (innerWidth !== viewportWidth || innerHeight !== viewportHeight) throw new Error('Kích thước cửa sổ đã đổi. Hãy chụp lại.');
        if (isFullPage) moveTo(nextY);
        await waitForContent();
        if (isFullPage) preparePositioned(chunks.length > 0);
        const region = clip();
        if (region.width !== firstClip.width || region.height !== firstClip.height) throw new Error('Vùng cuộn đã đổi kích thước. Hãy chụp lại.');
        if (isFullPage) totalHeight = height();
        validateSize(region.width, totalHeight);
        const actualY = isFullPage ? scrollPosition() : 0;
        if (actualY <= previousY && chunks.length) throw new Error('Không thể cuộn tiếp vùng đã chọn.');
        const index = chunks.length;
        status.textContent = 'Đang chụp ' + Math.min(99, Math.round((actualY + region.height) / totalHeight * 100)) + '% · ' + (index + 1) + ' khung';
        overlay.style.setProperty('visibility', 'hidden', 'important');
        try {
          await waitForPaint();
          check();
          await message('CAPTURE_VISIBLE', { index });
          check();
        } finally { overlay.style.removeProperty('visibility'); }
        chunks.push({ index, y: actualY, clip: region });
        if (!isFullPage) break;
        // Give bottom-triggered lazy loaders one more bounded settling period.
        if (actualY + region.height >= totalHeight - 1) {
          await waitForContent(1000);
          totalHeight = height();
          validateSize(region.width, totalHeight);
          if (actualY + region.height >= totalHeight - 1) break;
        }
        previousY = actualY;
        nextY = Math.min(actualY + region.height, totalHeight - region.height);
      } while (true);
      check();
      await message('SAVE_AND_OPEN_EDITOR', { payload: {
        meta: { title: document.title || 'Screenshot', url: location.href, scrollHeight: totalHeight,
          captureWidth: firstClip.width, viewportWidth, viewportHeight, dpr: devicePixelRatio || 1,
          isFullPage, isContainer: Boolean(root), createdAt: new Date().toISOString() }, chunks
      } });
      finished = true;
    } catch (err) { error = err; }
    finally {
      for (const [element, properties] of changes) {
        if (properties.has('__remove')) { element.remove(); continue; }
        for (const [property, [value, priority]] of properties) {
          if (property === 'transition') continue;
          if (value) element.style.setProperty(property, value, priority);
          else element.style.removeProperty(property);
        }
      }
      for (const [element, properties] of changes) {
        if (!properties.has('transition')) continue;
        getComputedStyle(element).opacity;
        const [value, priority] = properties.get('transition');
        if (value) element.style.setProperty('transition', value, priority);
        else element.style.removeProperty('transition');
      }
      if (root && rootScroll) root.scrollTo({ left: rootScroll.x, top: rootScroll.y, behavior: 'instant' });
      window.scrollTo({ left: original.x, top: original.y, behavior: 'instant' });
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      overlay.remove();
      window.__fullPageCaptureRunning = false;
      if (captureId && !finished) await chrome.runtime.sendMessage({ action: 'ABORT_CAPTURE', captureId }).catch(() => {});
    }
    if (error && (error.name !== 'AbortError' || abortReason !== 'Đã hủy chụp.')) {
      console.error('FullPage Capture:', error);
      alert(error.message);
    }
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'RUN_CAPTURE') {
      executeCapture(msg.isFullPage, msg.selectContainer);
      sendResponse({ received: true });
    }
  });
})();
