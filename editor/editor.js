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
  let originalCanvasData = null;
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

  // Load all chunk images
  const imagePromises = captureData.chunks.map(chunk => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ img, ...chunk });
      img.onerror = reject;
      img.src = chunk.dataUrl;
    });
  });

  let loadedChunks;
  try {
    loadedChunks = await Promise.all(imagePromises);
  } catch (err) {
    loadingSpinner.innerHTML = `<p style="color: #ef4444;">Lỗi ghép nối các lát cắt hình ảnh</p>`;
    return;
  }

  // Calculate dimensions
  const firstImg = loadedChunks[0].img;
  const dpr = currentMeta.dpr || (firstImg.width / currentMeta.viewportWidth) || 1;
  const scale = firstImg.width / currentMeta.viewportWidth;

  const totalCanvasWidth = firstImg.width;
  const totalCanvasHeight = Math.round(currentMeta.scrollHeight * scale);

  mainCanvas.width = totalCanvasWidth;
  mainCanvas.height = totalCanvasHeight;

  // Stitch chunks
  let stitchedBottom = 0;
  loadedChunks.forEach(chunk => {
    const destY = Math.round(chunk.y * scale);
    // The last viewport may overlap the previous one. Keep already captured
    // pixels (including the first header), and append only the new rows.
    const sourceY = Math.max(0, stitchedBottom - destY);
    const height = Math.min(chunk.img.height - sourceY, mainCanvas.height - destY - sourceY);
    if (height > 0) {
      ctx.drawImage(chunk.img, 0, sourceY, chunk.img.width, height,
        0, destY + sourceY, chunk.img.width, height);
      stitchedBottom = destY + sourceY + height;
    }
  });

  // Save original backup for reset
  originalCanvasData = document.createElement('canvas');
  originalCanvasData.width = mainCanvas.width;
  originalCanvasData.height = mainCanvas.height;
  originalCanvasData.getContext('2d').drawImage(mainCanvas, 0, 0);

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
    cropState.origX = cropState.x;
    cropState.origY = cropState.y;
    cropState.origW = cropState.w;
    cropState.origH = cropState.h;
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isCroppingActive) return;
    const dx = e.clientX - cropState.startX;
    const dy = e.clientY - cropState.startY;
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
  });

  window.addEventListener('mouseup', () => {
    cropState.isDragging = false;
    cropState.isResizing = false;
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

  // Reset Crop to Original
  btnResetCrop.addEventListener('click', () => {
    if (!originalCanvasData) return;
    mainCanvas.width = originalCanvasData.width;
    mainCanvas.height = originalCanvasData.height;
    ctx.drawImage(originalCanvasData, 0, 0);
    isCropped = false;
    btnResetCrop.style.display = 'none';
    setZoom(currentZoom);
    updateDimensionsLabel();
    showToast('Đã khôi phục ảnh gốc!');
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

  btnDownloadPng.addEventListener('click', () => {
    mainCanvas.toBlob((blob) => {
      if (blob) {
        triggerDownload(blob, 'png');
        showToast('Đang tải file PNG...');
      }
    }, 'image/png');
  });

  btnDownloadJpg.addEventListener('click', () => {
    // Create white bg canvas to avoid transparent black artifact in JPG
    const jpgCanvas = document.createElement('canvas');
    jpgCanvas.width = mainCanvas.width;
    jpgCanvas.height = mainCanvas.height;
    const jCtx = jpgCanvas.getContext('2d');
    jCtx.fillStyle = '#ffffff';
    jCtx.fillRect(0, 0, jpgCanvas.width, jpgCanvas.height);
    jCtx.drawImage(mainCanvas, 0, 0);

    jpgCanvas.toBlob((blob) => {
      if (blob) {
        triggerDownload(blob, 'jpg');
        showToast('Đang tải file JPG...');
      }
    }, 'image/jpeg', 0.92);
  });

  btnCopy.addEventListener('click', async () => {
    try {
      mainCanvas.toBlob(async (blob) => {
        if (!blob) throw new Error('Không tạo được blob');
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        showToast('Đã sao chép ảnh vào Clipboard!');
      }, 'image/png');
    } catch (err) {
      console.error(err);
      showToast('Lỗi sao chép: ' + err.message);
    }
  });

  // Multi-page or Single-page PDF Export
  btnDownloadPdf.addEventListener('click', async () => {
    showToast('Đang xuất bản PDF...');
    // Use window.print with an image-only print container for standard PDF print-to-PDF,
    // or create a data iframe
    const printWindow = window.open('', '_blank');
    const imgData = mainCanvas.toDataURL('image/png');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${safeTitle} - PDF</title>
        <style>
          @page { margin: 0; size: auto; }
          body { margin: 0; padding: 0; background: #fff; text-align: center; }
          img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
        </style>
      </head>
      <body>
        <img src="${imgData}" onload="window.print();window.close();" />
      </body>
      </html>
    `);
    printWindow.document.close();
  });
});
