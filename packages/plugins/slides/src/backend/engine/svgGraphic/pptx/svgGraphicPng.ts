/** 只读取 PNG 签名与 IHDR；PPTX 写入前不引入图片解码器。 */
export function readSvgGraphicFallbackPngSize(
  bytes: Uint8Array,
): { readonly widthPx: number; readonly heightPx: number } {
  if (
    bytes.byteLength < 24
    || bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47
    || bytes[4] !== 0x0d
    || bytes[5] !== 0x0a
    || bytes[6] !== 0x1a
    || bytes[7] !== 0x0a
    || bytes[12] !== 0x49
    || bytes[13] !== 0x48
    || bytes[14] !== 0x44
    || bytes[15] !== 0x52
  ) {
    throw new Error('SVG Graphic fallback rasterizer returned a non-PNG payload.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const widthPx = view.getUint32(16, false);
  const heightPx = view.getUint32(20, false);
  if (widthPx <= 0 || heightPx <= 0) {
    throw new Error('SVG Graphic fallback PNG has invalid dimensions.');
  }
  return { widthPx, heightPx };
}
