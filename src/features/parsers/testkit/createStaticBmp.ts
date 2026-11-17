/** 两像素 24bit BMP；是真实编码，用于验证 Skia 路径而不是仅改变扩展名。 */
export function createStaticBmp(): Buffer {
  const bytes = Buffer.alloc(62);
  bytes.write('BM'); bytes.writeUInt32LE(62, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(2, 18); bytes.writeInt32LE(1, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(8, 34);
  bytes.set([0, 0, 255, 0, 255, 0, 0, 0], 54);
  return bytes;
}
