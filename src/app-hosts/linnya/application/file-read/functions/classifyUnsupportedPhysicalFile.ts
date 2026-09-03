export type UnsupportedPhysicalFileKind =
  | 'pdf'
  | 'zip_or_office_container'
  | 'ole_compound_document'
  | 'sqlite_database'
  | 'executable'
  | 'compressed_archive';

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  return bytes.length >= signature.length
    && signature.every((value, index) => bytes[index] === value);
}

function isPortableExecutable(header: Buffer): boolean {
  if (!startsWith(header, [0x4d, 0x5a]) || header.length < 64) return false;
  const peOffset = header.readUInt32LE(0x3c);
  return peOffset >= 64
    && peOffset <= header.length - 4
    && startsWith(header.subarray(peOffset), [0x50, 0x45, 0x00, 0x00]);
}

/**
 * 这里只识别必须在 UTF-8 解码前截断的稳定签名，不承担通用 MIME 猜测。
 * 未命中的内容仍需通过 strict UTF-8 和控制字符门禁。
 */
export function classifyUnsupportedPhysicalFile(
  header: Buffer,
): UnsupportedPhysicalFileKind | null {
  if (header.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  if (
    startsWith(header, [0x50, 0x4b, 0x03, 0x04])
    || startsWith(header, [0x50, 0x4b, 0x05, 0x06])
    || startsWith(header, [0x50, 0x4b, 0x07, 0x08])
  ) return 'zip_or_office_container';
  if (startsWith(header, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return 'ole_compound_document';
  }
  if (header.subarray(0, 16).toString('binary') === 'SQLite format 3\0') {
    return 'sqlite_database';
  }
  if (
    startsWith(header, [0x7f, 0x45, 0x4c, 0x46])
    || isPortableExecutable(header)
    || startsWith(header, [0xfe, 0xed, 0xfa, 0xce])
    || startsWith(header, [0xfe, 0xed, 0xfa, 0xcf])
    || startsWith(header, [0xce, 0xfa, 0xed, 0xfe])
    || startsWith(header, [0xcf, 0xfa, 0xed, 0xfe])
    || startsWith(header, [0xca, 0xfe, 0xba, 0xbe])
  ) return 'executable';
  if (
    startsWith(header, [0x1f, 0x8b])
    || startsWith(header, [0x42, 0x5a, 0x68])
    || startsWith(header, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])
    || startsWith(header, [0x28, 0xb5, 0x2f, 0xfd])
    || startsWith(header, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
  ) return 'compressed_archive';
  return null;
}
