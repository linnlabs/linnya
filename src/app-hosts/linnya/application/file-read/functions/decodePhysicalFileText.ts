import path from 'node:path';

import {
  PhysicalFileReadError,
  type PhysicalTextContentType,
} from '../definitions/physicalFileRead';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const FORBIDDEN_BINARY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function contentTypeForFile(fileName: string): PhysicalTextContentType {
  switch (path.extname(fileName).toLowerCase()) {
    case '.md':
    case '.markdown':
      return 'text/markdown';
    case '.json':
      return 'application/json';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'text/plain';
  }
}

/**
 * generic Read 只承诺严格 UTF-8。编码猜测会把二进制或本地编码静默变成乱码，
 * 因此非法序列和二进制控制字符都必须要求调用方先显式转换。
 */
export function decodePhysicalFileText(input: {
  readonly bytes: Buffer;
  readonly fileName: string;
}): {
  readonly text: string;
  readonly contentType: PhysicalTextContentType;
} {
  const payload = input.bytes.subarray(input.bytes.subarray(0, 3).equals(UTF8_BOM) ? 3 : 0);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
  } catch {
    throw new PhysicalFileReadError(
      'READ_FILE_TEXT_ENCODING_UNSUPPORTED',
      '物理文件不是严格 UTF-8 文本；请先显式转换为 UTF-8。',
    );
  }

  if (FORBIDDEN_BINARY_CONTROL.test(text)) {
    throw new PhysicalFileReadError(
      'READ_FILE_UNSUPPORTED_FORMAT',
      '物理文件包含不允许的二进制控制内容，不能按文本读取。',
    );
  }

  return Object.freeze({
    text,
    contentType: contentTypeForFile(input.fileName),
  });
}
