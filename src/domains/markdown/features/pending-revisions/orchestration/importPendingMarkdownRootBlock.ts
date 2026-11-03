import { importMarkdownToDocJson } from '../../normalization/runtime';
import type { MarkdownImporter, MarkdownRootBlockJson } from '../definitions/pendingRevisionApply';
import { isRootBlock } from '../functions/pendingRevisionApplyRules';

/** 写入准入与接受共用正式导入链；空字符串表示空块/删除意图，不在这里伪造块身份。 */
export async function importPendingMarkdownRootBlock(
  markdown: string,
  importer: MarkdownImporter = importMarkdownToDocJson,
): Promise<MarkdownRootBlockJson | null> {
  if (!markdown.trim()) return null;
  const { docJson } = await importer(markdown);
  if (!docJson) throw new Error('Pending Markdown 解析未返回正文');
  const roots = docJson.content.filter(isRootBlock);
  if (roots.length !== 1) {
    throw new Error(`Pending 必须对应一个 rootBlock，实际为 ${roots.length}。本次写入未提交。`);
  }
  return roots[0];
}
