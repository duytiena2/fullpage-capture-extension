/* Minimal image-only PDF writer: one JPEG slice per A4 page, no remote code. */
async function createScreenshotPdf(source, onProgress = () => {}) {
  const pageWidth = 595.28, pageHeight = 841.89, margin = 18;
  const printWidth = pageWidth - margin * 2;
  const rowsPerPage = Math.max(1, Math.floor(source.width * (pageHeight - margin * 2) / printWidth));
  const count = Math.ceil(source.height / rowsPerPage);
  const encoder = new TextEncoder();
  const text = value => encoder.encode(value);
  const objects = [];
  objects[1] = text('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = text('<< /Type /Pages /Count ' + count + ' /Kids [' +
    Array.from({ length: count }, (_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] >>');
  const slice = document.createElement('canvas');
  slice.width = source.width;
  try {
    for (let i = 0; i < count; i++) {
      const y = i * rowsPerPage, height = Math.min(rowsPerPage, source.height - y);
      slice.height = height;
      const ctx = slice.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, slice.width, height);
      ctx.drawImage(source, 0, y, source.width, height, 0, 0, slice.width, height);
      const jpeg = await new Promise((resolve, reject) => slice.toBlob(blob =>
        blob ? resolve(blob) : reject(new Error('Không mã hóa được trang PDF.')), 'image/jpeg', 0.92));
      const bytes = new Uint8Array(await jpeg.arrayBuffer());
      const id = 3 + i * 3;
      const printHeight = height / source.width * printWidth;
      const command = text('q\n' + printWidth + ' 0 0 ' + printHeight + ' ' + margin + ' ' +
        (pageHeight - margin - printHeight) + ' cm\n/Im0 Do\nQ\n');
      objects[id] = text('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageWidth + ' ' + pageHeight +
        '] /Resources << /XObject << /Im0 ' + (id + 2) + ' 0 R >> >> /Contents ' + (id + 1) + ' 0 R >>');
      objects[id + 1] = new Blob([text('<< /Length ' + command.length + ' >>\nstream\n'), command, text('endstream')]);
      objects[id + 2] = new Blob([text('<< /Type /XObject /Subtype /Image /Width ' + source.width + ' /Height ' + height +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + bytes.length + ' >>\nstream\n'), bytes, text('\nendstream')]);
      onProgress(i + 1, count);
    }
  } finally { slice.width = slice.height = 0; }
  const parts = [text('%PDF-1.4\n')], offsets = [0];
  let offset = parts[0].length;
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = offset;
    const prefix = text(id + ' 0 obj\n'), suffix = text('\nendobj\n'), body = objects[id];
    parts.push(prefix, body, suffix);
    offset += prefix.length + (body.size ?? body.length) + suffix.length;
  }
  const xrefOffset = offset;
  parts.push(text('xref\n0 ' + objects.length + '\n0000000000 65535 f \n' +
    offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size ' + objects.length + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n'));
  return new Blob(parts, { type: 'application/pdf' });
}
