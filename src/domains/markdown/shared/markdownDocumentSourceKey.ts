import { createHash } from 'node:crypto';
import type { MarkdownDocJson } from '../features/normalization';
import type { MarkdownPendingRevisionLike } from '../features/pending-revisions';
/** 正文相同不代表来源相同；结构、版本和 pending metadata 共同保护异步准备窗口。 */
export function createMarkdownFileWriteSourceKey(input: { readonly content: MarkdownDocJson; readonly pendings: readonly MarkdownPendingRevisionLike[]; readonly versionNumber: number | null }): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
