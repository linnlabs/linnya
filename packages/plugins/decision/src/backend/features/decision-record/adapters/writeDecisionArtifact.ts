import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DecisionFailure } from '../definitions/decisionFailure';
import type { DecisionReport } from '../definitions/decisionReport';
import type { renderDecisionDelivery } from '../functions/renderDecisionDelivery';

type SavedDecisionArtifact = DecisionReport | ReturnType<typeof renderDecisionDelivery>;

/** 独立会话产物，不覆盖旧快照，也不冒充Workspace文档或长期记录。 */
export async function writeDecisionArtifact(root: string, report: SavedDecisionArtifact, signal: AbortSignal) {
  signal.throwIfAborted();
  const isDelivery = report.kind === 'decision_delivery';
  const fileName = isDelivery ? 'delivery.md' : 'report.md';
  const directory = await mkdtemp(path.join(root, 'decision-report-')).catch(() => {
    signal.throwIfAborted();
    throw new DecisionFailure('export_failed', 'Could not create a report directory in the current conversation. No report was published.');
  });
  const describe = (name: string, markdown: string, label: string) => {
    const locator = `conversation:/${path.basename(directory)}/${name}`;
    return { locator, markdownLink: `[${label}](${locator})`,
      sha256: createHash('sha256').update(markdown, 'utf8').digest('hex'),
      bytes: Buffer.byteLength(markdown, 'utf8') };
  };
  const originalArtifact = isDelivery ? describe('report.md', report.originalMarkdown, '完整决策原件') : undefined;
  const originalLink = originalArtifact?.markdownLink ?? describe(fileName, report.markdown, '程序报告原件').markdownLink;
  const deliveryNote = `记录 ${report.decisionId} · revision ${report.revision} · inputRevision ${report.inputRevision}\n原件：${originalLink}`;
  const markdown = isDelivery ? `${report.markdown}\n---\n\n${deliveryNote}` : report.markdown;
  try {
    // 两份文件属于同一交付；完整原件保存成功后才写摘要，任一失败清理整个独占目录。
    if (isDelivery) await writeFile(path.join(directory, 'report.md'), report.originalMarkdown, { encoding: 'utf8', flag: 'wx', mode: 0o600, signal });
    await writeFile(path.join(directory, fileName), markdown, { encoding: 'utf8', flag: 'wx', mode: 0o600, signal });
    signal.throwIfAborted();
  } catch (error: unknown) {
    // 只清理本次独占目录；失败/取消不能留下被当作完整报告的半份文件。
    await rm(directory, { recursive: true, force: true });
    if (signal.aborted) throw error;
    throw new DecisionFailure('export_failed', 'Could not save the report in the current conversation directory. No report was published.');
  }
  return {
    kind: isDelivery ? 'decision_delivery_export' as const : 'decision_report_export' as const,
    decisionId: report.decisionId, revision: report.revision, inputRevision: report.inputRevision,
    artifact: describe(fileName, markdown, isDelivery ? '决策交付摘要' : '程序报告原件'),
    ...(originalArtifact ? { originalArtifact } : {}),
    deliveryNote,
    notice: '固定版本会话文件，不随条件变化更新，也未保存为Workspace文档。可用read_file读取并直接链接；hash校验该原件字节，不认证模型或建议。',
  };
}
