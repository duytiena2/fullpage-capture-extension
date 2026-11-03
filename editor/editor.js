document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const captureId = urlParams.get('id');

  const docTitle = document.getElementById('doc-title');
  const docDims = document.getElementById('doc-dims');
  const mainCanvas = document.getElementById('main-canvas');
  const ctx = mainCanvas.getContext('2d');
  const canvasContainer = document.getElementById('canvas-container');
  const workspace = document.getElementById('workspace');
  const loadingSpinner = document.getElementById('loading-spinner');
  const toastEl = document.getElementById('toast');

  // Zoom Controls
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomFit = document.getElementById('btn-zoom-fit');
  const zoomLevelText = document.getElementById('zoom-level');

  // Edit & Crop Controls
  const btnCropMode = document.getElementById('btn-crop-mode');
  const btnResetCrop = document.getElementById('btn-reset-crop');
  const cropOverlay = document.getElementById('crop-overlay');
  const cropBox = document.getElementById('crop-box');
  const cropActionsBar = document.getElementById('crop-actions-bar');
  const cropSizeText = document.getElementById('crop-size-text');
  const btnApplyCrop = document.getElementById('btn-apply-crop');
  const btnCancelCrop = document.getElementById('btn-cancel-crop');

  // Export Controls
  const btnCopy = document.getElementById('btn-copy');
  const btnDownloadPng = document.getElementById('btn-download-png');
  const btnDownloadJpg = document.getElementById('btn-download-jpg');
  const btnDownloadPdf = document.getElementById('btn-download-pdf');

  let currentZoom = 1.0;
  let originalBlob = null;
  let isCropped = false;
  let currentMeta = null;

  function showToast(message) {
    toastEl.innerText = message;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2500);
  }

  if (!captureId) {
    loadingSpinner.innerHTML = '<p style="color: #ef4444;">Không tìm thấy mã phiên chụp ảnh (captureId)!</p>';
    return;
  }

  let captureData;
  try {
    captureData = await getCaptureData(captureId);
    if (!captureData) throw new Error('Dữ liệu ảnh không tồn tại');
  } catch (err) {
    loadingSpinner.innerHTML = `<p style="color: #ef4444;">Lỗi tải ảnh: ${err.message}</p>`;
    return;
  }

  currentMeta = captureData.meta;
  const safeTitle = (currentMeta.title || 'Screenshot').replace(/[\\/:*?"<>|]/g, '_');
  docTitle.innerText = currentMeta.title || 'Screenshot';
  document.title = `${currentMeta.title || 'Screenshot'} - FullPage Editor`;

  function canvasBlob(canvas, type = 'image/png', quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Không thể tạo file ảnh.')), type, quality);
    });
  }

  async function loadChunk(chunk) {
    const blob = chunk.dataUrl ? await (await fetch(chunk.dataUrl)).blob()
      : await getCaptureChunk(captureId, chunk.index);
    return createImageBitmap(blob);
  }

  try {
    if (!captureData.chunks?.length) throw new Error('Phiên chụp chưa có ảnh.');
    let scale, stitchedBottom = 0;
    // Decode and release one frame at a time instead of retaining every bitmap.
    for (const chunk of captureData.chunks) {
      const image = await loadChunk(chunk);
      try {
        if (!scale) {
          scale = image.width / currentMeta.viewportWidth;
          const width = Math.round((currentMeta.captureWidth || currentMeta.viewportWidth) * scale);
          const height = Math.round(currentMeta.scrollHeight * scale);
          if (!Number.isFinite(width * height) || width < 1 || height < 1 ||
              width > 32767 || height > 32767 || width * height > 64 * 1024 * 1024) {
            throw new Error('Ảnh quá lớn. Hãy chụp vùng nhỏ hơn hoặc giảm zoom trình duyệt.');
          }
          mainCanvas.width = width; mainCanvas.height = height;
        }
        const clip = chunk.clip || { x: 0, y: 0, width: currentMeta.viewportWidth, height: currentMeta.viewportHeight };
        const destY = Math.round(chunk.y * scale);
        const skip = Math.max(0, stitchedBottom - destY);
        const sx = Math.round(clip.x * scale), sy = Math.round(clip.y * scale) + skip;
        const width = Math.min(mainCanvas.width, image.width - sx);
        const height = Math.min(Math.round(clip.height * scale) - skip, mainCanvas.height - destY - skip, image.height - sy);
        if (height > 0 && width > 0) {
          ctx.drawImage(image, sx, sy, width, height, 0, destY + skip, width, height);
          stitchedBottom = destY + skip + height;
        }
      } finally { image.close(); }
    }
    originalBlob = await canvasBlob(mainCanvas);
    captureData = null;
  } catch (err) {
    loadingSpinner.textContent = 'Lỗi tải/ghép ảnh: ' + err.message;
    mainCanvas.width = mainCanvas.height = 0;
    return;
  }

  loadingSpinner.style.display = 'none';
  updateDimensionsLabel();

  // Set initial zoom to fit container
  fitZoomToScreen();

  function updateDimensionsLabel() {
    docDims.innerText = `${mainCanvas.width} × ${mainCanvas.height} px`;
  }

  function setZoom(zoom) {
    const previousWidth = parseFloat(mainCanvas.style.width);
    const previousHeight = parseFloat(mainCanvas.style.height);
    currentZoom = Math.max(0.1, Math.min(3.0, zoom));
    zoomLevelText.innerText = `${Math.round(currentZoom * 100)}%`;
    mainCanvas.style.width = `${Math.round(mainCanvas.width * currentZoom)}px`;
    mainCanvas.style.height = `${Math.round(mainCanvas.height * currentZoom)}px`;
    if (cropOverlay.style.display === 'block') {
      const ratioX = parseFloat(mainCanvas.style.width) / previousWidth;
      const ratioY = parseFloat(mainCanvas.style.height) / previousHeight;
      cropState.x *= ratioX;
      cropState.y *= ratioY;
      cropState.w *= ratioX;
      cropState.h *= ratioY;
      cropState.isDragging = false;
      cropState.isResizing = false;
      updateCropOverlayBounds();
      updateCropBoxDOM();
    }
  }

  function fitZoomToScreen() {
    const workspace = document.getElementById('workspace');
    const availableWidth = workspace.clientWidth - 80;
    if (mainCanvas.width > availableWidth) {
      setZoom(availableWidth / mainCanvas.width);
    } else {
      setZoom(1.0);
    }
  }

  btnZoomIn.addEventListener('click', () => setZoom(currentZoom + 0.15));
  btnZoomOut.addEventListener('click', () => setZoom(currentZoom - 0.15));
  btnZoomFit.addEventListener('click', fitZoomToScreen);

  // Zoom with Ctrl + Wheel
  workspace.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(currentZoom + delta);
    }
  }, { passive: false });

  // --- CROP FUNCTIONALITY ---
  let isCroppingActive = false;
  let cropState = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    isDragging: false,
    isResizing: false,
    resizeDir: '',
    startX: 0,
    startY: 0
  };

  function updateCropOverlayBounds() {
    cropOverlay.style.width = mainCanvas.style.width;
    cropOverlay.style.height = mainCanvas.style.height;
  }

  function updateCropBoxDOM() {
    cropBox.style.left = `${cropState.x}px`;
    cropBox.style.top = `${cropState.y}px`;
    cropBox.style.width = `${cropState.w}px`;
    cropBox.style.height = `${cropState.h}px`;

    const { realW, realH } = getCropRectangle();
    cropSizeText.innerText = `Vùng chọn: ${realW} × ${realH} px`;
  }

  function getCropRectangle() {
    const scaleX = mainCanvas.width / parseFloat(mainCanvas.style.width);
    const scaleY = mainCanvas.height / parseFloat(mainCanvas.style.height);
    const realX = Math.max(0, Math.round(cropState.x * scaleX));
    const realY = Math.max(0, Math.round(cropState.y * scaleY));
    const right = Math.min(mainCanvas.width, Math.round((cropState.x + cropState.w) * scaleX));
    const bottom = Math.min(mainCanvas.height, Math.round((cropState.y + cropState.h) * scaleY));
    return { realX, realY, realW: right - realX, realH: bottom - realY };
  }

  btnCropMode.addEventListener('click', () => {
    if (isCroppingActive) {
      cancelCrop();
      return;
    }
    startCropMode();
  });

  function startCropMode() {
    isCroppingActive = true;
    btnCropMode.classList.add('active');
    updateCropOverlayBounds();
    cropOverlay.style.display = 'block';
    cropActionsBar.style.display = 'flex';

    // Start at the image edges, including content below the visible viewport.
    cropState.x = 0;
    cropState.y = 0;
    cropState.w = parseFloat(mainCanvas.style.width);
    cropState.h = parseFloat(mainCanvas.style.height);
    updateCropBoxDOM();
  }

  function cancelCrop() {
    isCroppingActive = false;
    cropState.isDragging = false;
    cropState.isResizing = false;
    btnCropMode.classList.remove('active');
    cropOverlay.style.display = 'none';
    cropActionsBar.style.display = 'none';
  }

  btnCancelCrop.addEventListener('click', cancelCrop);

  function getResizeDirection(e) {
    if (e.target.classList.contains('crop-handle')) return e.target.dataset.dir;
    const bounds = cropBox.getBoundingClientRect();
    const x = e.clientX - bounds.left;
    const y = e.clientY - bounds.top;
    const edgeWidth = 8;
    const horizontal = x <= Math.min(edgeWidth, bounds.width / 2) ? 'w'
      : x >= bounds.width - edgeWidth ? 'e' : '';
    const vertical = y <= Math.min(edgeWidth, bounds.height / 2) ? 'n'
      : y >= bounds.height - edgeWidth ? 's' : '';
    return vertical + horizontal;
  }

  cropBox.addEventListener('mousemove', (e) => {
    if (cropState.isDragging || cropState.isResizing) return;
    const dir = getResizeDirection(e);
    cropBox.style.cursor = dir === 'e' || dir === 'w' ? 'ew-resize'
      : dir === 'n' || dir === 's' ? 'ns-resize'
      : dir === 'ne' || dir === 'sw' ? 'nesw-resize'
      : dir ? 'nwse-resize' : 'move';
  });

  // Crop box dragging and resizing handlers
  cropBox.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const dir = getResizeDirection(e);
    cropState.isResizing = Boolean(dir);
    cropState.isDragging = !dir;
    cropState.resizeDir = dir;
    cropState.startX = e.clientX;
    cropState.startY = e.clientY;
    cropState.startScrollX = workspace.scrollLeft;
    cropState.startScrollY = workspace.scrollTop;
    cropState.origX = cropState.x;
    cropState.origY = cropState.y;
    cropState.origW = cropState.w;
    cropState.origH = cropState.h;
    e.preventDefault();
    e.stopPropagation();
    lastPointer = { clientX: e.clientX, clientY: e.clientY };
    if (!autoScrollFrame) autoScrollFrame = requestAnimationFrame(autoScroll);
  });

  let lastPointer = null, autoScrollFrame = 0;
  function updateDrag(e) {
    if (!isCroppingActive) return;
    const dx = e.clientX - cropState.startX + workspace.scrollLeft - cropState.startScrollX;
    const dy = e.clientY - cropState.startY + workspace.scrollTop - cropState.startScrollY;
    const maxW = mainCanvas.offsetWidth;
    const maxH = mainCanvas.offsetHeight;

    if (cropState.isDragging) {
      cropState.x = Math.max(0, Math.min(maxW - cropState.w, cropState.origX + dx));
      cropState.y = Math.max(0, Math.min(maxH - cropState.h, cropState.origY + dy));
      updateCropBoxDOM();
    } else if (cropState.isResizing) {
      const dir = cropState.resizeDir;
      let newX = cropState.origX;
      let newY = cropState.origY;
      let newW = cropState.origW;
      let newH = cropState.origH;

      if (dir.includes('e')) newW = Math.max(40, Math.min(maxW - newX, cropState.origW + dx));
      if (dir.includes('s')) newH = Math.max(40, Math.min(maxH - newY, cropState.origH + dy));
      if (dir.includes('w')) {
        const right = cropState.origX + cropState.origW;
        newX = Math.max(0, Math.min(right - Math.min(40, cropState.origW), cropState.origX + dx));
        newW = right - newX;
      }
      if (dir.includes('n')) {
        const bottom = cropState.origY + cropState.origH;
        newY = Math.max(0, Math.min(bottom - Math.min(40, cropState.origH), cropState.origY + dy));
        newH = bottom - newY;
      }

      cropState.x = Math.max(0, newX);
      cropState.y = Math.max(0, newY);
      cropState.w = newW;
      cropState.h = newH;
      updateCropBoxDOM();
    }
  }

  function autoScroll() {
    autoScrollFrame = 0;
    if (!lastPointer || !isCroppingActive || !(cropState.isDragging || cropState.isResizing)) return;
    const bounds = workspace.getBoundingClientRect();
    const speed = (value, min, max) => value < min + 40 ? -Math.min(24, (min + 40 - value) / 2)
      : value > max - 40 ? Math.min(24, (value - max + 40) / 2) : 0;
    workspace.scrollBy(speed(lastPointer.clientX, bounds.left, bounds.right), speed(lastPointer.clientY, bounds.top, bounds.bottom));
    updateDrag(lastPointer);
    autoScrollFrame = requestAnimationFrame(autoScroll);
  }
  window.addEventListener('mousemove', e => {
    lastPointer = { clientX: e.clientX, clientY: e.clientY };
    updateDrag(lastPointer);
  });
  workspace.addEventListener('scroll', () => {
    if (lastPointer) updateDrag(lastPointer);
  });

  function stopDrag() {
    cropState.isDragging = false;
    cropState.isResizing = false;
    cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = 0;
  }
  window.addEventListener('mouseup', stopDrag);
  window.addEventListener('blur', stopDrag);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { stopDrag(); cancelCrop(); }
  });

  // Apply Crop
  btnApplyCrop.addEventListener('click', () => {
    const { realX, realY, realW, realH } = getCropRectangle();

    if (realW <= 0 || realH <= 0) return;

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = realW;
    croppedCanvas.height = realH;
    const cropCtx = croppedCanvas.getContext('2d');
    cropCtx.drawImage(mainCanvas, realX, realY, realW, realH, 0, 0, realW, realH);

    // Update main canvas
    mainCanvas.width = realW;
    mainCanvas.height = realH;
    ctx.drawImage(croppedCanvas, 0, 0);

    isCropped = true;
    btnResetCrop.style.display = 'inline-flex';
    cancelCrop();
    setZoom(currentZoom); // re-apply current zoom size
    updateDimensionsLabel();
    showToast('Đã cắt ảnh thành công!');
  });

  // Keep the reset image compressed rather than allocating a second full canvas.
  btnResetCrop.addEventListener('click', async () => {
    if (!originalBlob) return;
    btnResetCrop.disabled = true;
    let image;
    try {
      image = await createImageBitmap(originalBlob);
      cancelCrop();
      mainCanvas.width = image.width; mainCanvas.height = image.height;
      ctx.drawImage(image, 0, 0);
      isCropped = false;
      btnResetCrop.style.display = 'none';
      setZoom(currentZoom);
      updateDimensionsLabel();
      showToast('Đã khôi phục ảnh gốc!');
    } catch (err) { showToast('Lỗi khôi phục: ' + err.message); }
    finally { image?.close(); btnResetCrop.disabled = false; }
  });

  // --- EXPORT & DOWNLOAD ACTIONS ---
  function triggerDownload(blob, extension) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle}_${Date.now()}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  let exporting = false;
  async function exportAction(action) {
    if (exporting) return;
    exporting = true;
    const buttons = [btnCopy, btnDownloadPng, btnDownloadJpg, btnDownloadPdf, btnApplyCrop, btnResetCrop];
    buttons.forEach(button => button.disabled = true);
    try { await action(); }
    catch (err) { console.error(err); showToast('Không thể xuất ảnh: ' + err.message); }
    finally { exporting = false; buttons.forEach(button => button.disabled = false); }
  }
  btnDownloadPng.addEventListener('click', () => exportAction(async () => {
    triggerDownload(await canvasBlob(mainCanvas), 'png');
    showToast('Đang tải file PNG...');
  }));
  btnDownloadJpg.addEventListener('click', () => exportAction(async () => {
    const jpg = document.createElement('canvas');
    try {
      jpg.width = mainCanvas.width; jpg.height = mainCanvas.height;
      const context = jpg.getContext('2d');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, jpg.width, jpg.height);
      context.drawImage(mainCanvas, 0, 0);
      triggerDownload(await canvasBlob(jpg, 'image/jpeg', 0.92), 'jpg');
      showToast('Đang tải file JPG...');
    } finally { jpg.width = jpg.height = 0; }
  }));
  btnCopy.addEventListener('click', () => exportAction(async () => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('Trình duyệt không hỗ trợ sao chép ảnh. Hãy tải PNG.');
    }
    // Pass the blob promise during the click, preserving user activation.
    const blob = canvasBlob(mainCanvas);
    blob.catch(() => {});
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showToast('Đã sao chép ảnh vào Clipboard!');
  }));
  btnDownloadPdf.addEventListener('click', () => exportAction(async () => {
    showToast('Đang tạo PDF...');
    const pdf = await createScreenshotPdf(mainCanvas, (page, total) => showToast('PDF: ' + page + '/' + total + ' trang'));
    triggerDownload(pdf, 'pdf');
    showToast('Đang tải PDF...');
  }));
});
