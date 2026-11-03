const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let browser, server, base;
const root = process.cwd();
const chromePath = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const fixture = `<style>body{margin:0;padding-top:64px}header{height:64px;position:fixed;top:0;left:0;width:100%;background:#f00;z-index:5}.sticky{position:sticky;top:64px;height:40px;background:#0f0}.content{height:1100px;background:linear-gradient(#eee,#aab)}</style><header>FIXED</header><div class="sticky">STICKY</div><div class="content">CONTENT</div>`;
before(async () => {
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/slow.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      setTimeout(() => res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#00ff00"/></svg>'), 900);
      return;
    }
    if (pathname === '/fixture') { res.end(fixture); return; }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    if (pathname === '/editor/editor.html') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:");
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch(chromePath ? { executablePath: chromePath, headless: true } : { channel: 'chrome', headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

async function captureFixture(html, options = {}) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(base + '/fixture');
  if (html) await page.setContent(html);
  const frames = new Map(), alerts = [];
  let payload = null, aborted = false, fail = false;
  await page.exposeFunction('captureMessage', async msg => {
    if (msg.action === 'BEGIN_CAPTURE') return { success: true, captureId: 'fixture' };
    if (msg.action === 'ABORT_CAPTURE') { frames.clear(); aborted = true; return { success: true }; }
    if (msg.action === 'SAVE_AND_OPEN_EDITOR') { payload = msg.payload; return { success: true }; }
    assert.equal(await page.locator('#__fullpage_capture_overlay').evaluate(e => getComputedStyle(e).visibility), 'hidden');
    if (fail) return { success: false, error: 'Injected capture failure' };
    frames.set(msg.index, (await page.screenshot()).toString('base64'));
    return { success: true };
  });
  await page.exposeFunction('captureAlert', message => alerts.push(message));
  await page.evaluate(() => {
    window.chrome = { runtime: { onMessage: { addListener: fn => window.captureListener = fn }, sendMessage: msg => window.captureMessage(msg) } };
    window.alert = message => window.captureAlert(message);
  });
  await page.addScriptTag({ path: 'content/capture.js' });
  async function start(args = {}) {
    payload = null; aborted = false;
    await page.evaluate(args => window.captureListener({ action: 'RUN_CAPTURE', isFullPage: true, ...args }, {}, () => {}), args);
  }
  async function done() {
    await page.waitForFunction(() => !window.__fullPageCaptureRunning, null, { timeout: 30000 });
    return payload;
  }
  return { page, frames, alerts, start, done, get aborted() { return aborted; }, fail() { fail = true; } };
}
async function openEditor(payload, frames) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  await page.exposeFunction('readCapture', () => payload);
  await page.exposeFunction('readFrame', index => 'data:image/png;base64,' + frames.get(index));
  await page.route('**/lib/db.js', route => route.fulfill({ contentType: 'text/javascript', body:
    'async function getCaptureData(){return window.readCapture()} async function getCaptureChunk(id,index){return (await fetch(await window.readFrame(index))).blob()}' }));
  await page.goto(base + '/editor/editor.html?id=fixture');
  await page.waitForFunction(() => document.getElementById('loading-spinner').style.display === 'none');
  return page;
}
test('dynamic page: lazy growth, fixed/sticky headers, streamed frames, original scroll restored', async () => {
  const s = await captureFixture();
  await s.page.evaluate(() => {
    window.scrollTo(0, 50);
    let appended = false;
    window.addEventListener('scroll', () => {
      if (scrollY > 100 && !appended) { appended = true; setTimeout(() => {
        const node = document.createElement('div'); node.style.cssText = 'height:500px;background:#77a'; document.body.append(node);
      }, 180); }
    });
  });
  await s.start(); const payload = await s.done();
  assert.equal(payload.meta.scrollHeight, 1704); assert.equal(await s.page.evaluate(() => scrollY), 50);
  assert.ok(payload.chunks.length >= 3); assert.ok(payload.chunks.every(c => c.dataUrl === undefined));
  const editor = await openEditor(payload, s.frames);
  const stats = await editor.evaluate(() => {
    const c = document.getElementById('main-canvas'); const data = c.getContext('2d').getImageData(700, 0, 1, c.height).data;
    let red = 0, green = 0;
    for (let i = 0; i < data.length; i += 4) { if (data[i] === 255 && data[i+1] === 0) red++; if (data[i] === 0 && data[i+1] === 255) green++; }
    return { height: c.height, red, green };
  });
  assert.deepEqual(stats, { height: 1704, red: 64, green: 40 });
  await editor.close(); await s.page.close();
});
test('nested scrolling panel: selector, clipping and panel/page restoration', async () => {
  const s = await captureFixture(`<style>body{margin:0;background:#f00}.panel{position:absolute;top:80px;left:120px;width:400px;height:300px;overflow:auto;background:#fff}.sticky{height:40px;position:sticky;top:0;background:#0f0}.content{height:700px;background:#ddd}</style><div class="panel"><div class="sticky">PANEL HEADER</div><div class="content">PANEL CONTENT</div></div>`);
  await s.page.locator('.panel').evaluate(e => e.scrollTop = 90);
  await s.start({ selectContainer: true });
  await s.page.locator('.content').click({ position: { x: 100, y: 100 } });
  const payload = await s.done();
  assert.ok(payload.meta.isContainer); assert.equal(payload.meta.scrollHeight, 740);
  assert.equal(await s.page.locator('.panel').evaluate(e => e.scrollTop), 90);
  const editor = await openEditor(payload, s.frames);
  const size = await editor.locator('#main-canvas').evaluate(c => ({ width: c.width, height: c.height, pixel: [...c.getContext('2d').getImageData(100, 100, 1, 1).data] }));
  assert.equal(size.width, payload.meta.captureWidth); assert.equal(size.height, 740);
  assert.deepEqual(size.pixel, [221, 221, 221, 255]);
  await editor.close(); await s.page.close();
});
test('visible capture waits for a slow image and keeps the current scroll position', async () => {
  const s = await captureFixture('<style>body{margin:0;height:1500px;background:white}</style>');
  await s.page.evaluate(() => window.scrollTo(0, 100));
  await s.start({ isFullPage: false });
  await s.page.evaluate(base => {
    const image = document.createElement('img'); image.style.cssText = 'position:absolute;left:100px;top:300px;width:100px;height:100px';
    image.src = base + '/slow.svg'; document.body.append(image);
  }, base);
  const payload = await s.done();
  assert.equal(payload.chunks.length, 1); assert.equal(payload.meta.scrollHeight, 600);
  assert.equal(await s.page.evaluate(() => scrollY), 100);
  const editor = await openEditor(payload, s.frames);
  assert.deepEqual(await editor.locator('#main-canvas').evaluate(c => [...c.getContext('2d').getImageData(120, 220, 1, 1).data]), [0, 255, 0, 255]);
  await editor.close(); await s.page.close();
});
test('Esc, cancel, focus loss and capture errors restore the page and remove temporary frames', async () => {
  for (const mode of ['escape', 'button', 'failure', 'selection', 'blur']) {
    const s = await captureFixture();
    await s.page.evaluate(() => window.scrollTo(0, 70));
    if (mode === 'failure') s.fail();
    await s.start({ selectContainer: mode === 'selection' });
    if (mode === 'escape' || mode === 'selection') await s.page.keyboard.press('Escape');
    if (mode === 'button') await s.page.locator('#__fullpage_capture_overlay button').click();
    if (mode === 'blur') await s.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await s.done(), null);
    assert.equal(await s.page.locator('#__fullpage_capture_overlay').count(), 0);
    assert.equal(await s.page.evaluate(() => scrollY), 70);
    assert.equal(await s.page.locator('.sticky').evaluate(e => getComputedStyle(e).position), 'sticky');
    if (mode !== 'selection') assert.ok(s.aborted);
    await s.page.close();
  }
});
test('IndexedDB upgrade preserves old captures; request success does not hide a later transaction abort', async () => {
  const context = await browser.newContext();
  const page = await context.newPage(); await page.goto(base + '/fixture');
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('FullPageCaptureDB', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('captures', { keyPath: 'id' });
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction(['captures'], 'readwrite');
      tx.objectStore('captures').put({ id: 'legacy', meta: { title: 'old screenshot' }, chunks: [{ dataUrl: 'old-image' }] });
      tx.oncomplete = () => { req.result.close(); resolve(); };
    };
  }));
  await page.addScriptTag({ path: 'lib/db.js' });
  const result = await page.evaluate(async () => {
    const legacy = await getCaptureData('legacy');
    let rejected = false;
    try {
      await dbTransaction(['captures'], 'readwrite', tx => {
        const req = tx.objectStore('captures').put({ id: 'aborted' });
        req.addEventListener('success', () => tx.abort());
        return req;
      });
    } catch { rejected = true; }
    return { legacy, rejected, aborted: await getCaptureData('aborted') };
  });
  assert.equal(result.legacy.chunks[0].dataUrl, 'old-image'); assert.ok(result.rejected); assert.equal(result.aborted, undefined);
  await context.close();
});
test('editor: both crop edges, autoscroll, zoom, apply/reset, failed copy, PNG/JPG/PDF export under CSP', async () => {
  const s = await captureFixture('<style>body{margin:0;background:#eee;height:5000px}</style>');
  await s.start(); const payload = await s.done();
  const page = await openEditor(payload, s.frames);
  await page.locator('#btn-crop-mode').click();
  const original = await page.locator('#crop-box').boundingBox();
  await page.mouse.move(original.x + 2, 350); await page.mouse.down();
  await page.mouse.move(original.x + 82, 350, { steps: 6 }); await page.mouse.up();
  const left = await page.locator('#crop-box').boundingBox();
  assert.ok(Math.abs(left.width - original.width + 80) < 1);
  await page.mouse.move(left.x + left.width - 2, 350); await page.mouse.down();
  await page.mouse.move(left.x + left.width - 82, 350, { steps: 6 }); await page.mouse.up();
  const right = await page.locator('#crop-box').boundingBox(); assert.ok(right.width < left.width - 79);
  const label = await page.locator('#crop-size-text').innerText();
  await page.locator('#btn-zoom-in').click(); assert.equal(await page.locator('#crop-size-text').innerText(), label);
  const box = await page.locator('#crop-box').boundingBox();
  await page.mouse.move(box.x + 2, 350); await page.mouse.down();
  await page.mouse.move(box.x + 30, 787);
  await page.waitForTimeout(250);
  assert.ok(await page.locator('#workspace').evaluate(e => e.scrollTop) > 0, 'autoscroll while holding the edge');
  await page.mouse.up();
  const final = (await page.locator('#crop-size-text').innerText()).replace('Vùng chọn: ', '');
  await page.locator('#btn-apply-crop').click(); assert.equal(await page.locator('#doc-dims').innerText(), final);
  await page.locator('#btn-reset-crop').click();
  await page.waitForFunction(() => document.getElementById('doc-dims').innerText === '800 × 5000 px');
  await page.evaluate(() => {
    window.ClipboardItem = class { constructor(data) { this.data = data; } };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async () => { throw new Error('Permission denied fixture'); } } });
  });
  await page.locator('#btn-copy').click();
  await page.waitForFunction(() => document.getElementById('toast').innerText.includes('Permission denied fixture'));
  for (const [id, type] of [['png', 'image/png'], ['jpg', 'image/jpeg'], ['pdf', 'application/pdf']]) {
    const downloadEvent = page.waitForEvent('download'); await page.locator('#btn-download-' + id).click();
    const download = await downloadEvent;
    const bytes = fs.readFileSync(await download.path());
    if (id === 'png') assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    if (id === 'jpg') assert.equal(bytes.readUInt16BE(0), 0xffd8);
    if (id === 'pdf') {
      assert.equal(bytes.subarray(0, 8).toString(), '%PDF-1.4');
      const text = bytes.toString('latin1');
      assert.ok(/\/Count 5\b/.test(text));
      const offset = Number(text.match(/startxref\n(\d+)/)[1]); assert.equal(text.slice(offset, offset + 4), 'xref');
      fs.mkdirSync('test-results', { recursive: true }); fs.writeFileSync('test-results/export.pdf', bytes);
    }
    assert.ok(bytes.length > 100, type);
  }
  await page.close(); await s.page.close();
});
test('IndexedDB: chunk blobs persist and committed writes are immediately visible from a second connection', async () => {
  const page = await browser.newPage(); await page.goto(base + '/fixture');
  await page.addScriptTag({ path: 'lib/db.js' });
  const result = await page.evaluate(async () => {
    await saveCaptureData('db-test', { meta: { title: 'committed' }, chunks: [{ index: 0 }] });
    await saveCaptureChunk('db-test', 0, new Blob(['hello'], { type: 'image/png' }));
    const title = (await getCaptureData('db-test')).meta.title;
    const text = await (await getCaptureChunk('db-test', 0)).text();
    await deleteCaptureData('db-test');
    let missing = false; try { await getCaptureChunk('db-test', 0); } catch { missing = true; }
    return { title, text, missing, record: await getCaptureData('db-test') };
  });
  assert.deepEqual(result, { title: 'committed', text: 'hello', missing: true, record: undefined });
  await page.close();
});
