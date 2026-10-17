import type { WebAcquiredFile } from '@app/schemas';

/** 可进入 Citation 的持久身份快照；不是从文件解析出的原文或页码。 */
export function describeWebFile(file: WebAcquiredFile): string {
  return `Original ${file.format.toUpperCase()} file acquired ${file.acquiredAt}; ${file.byteLength} bytes; SHA-256 ${file.sha256}. File identity only; extracted passages and page numbers are not captured here.`;
}
