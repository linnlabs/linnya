import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DecisionFailure, type DecisionReport } from '../../decision-record';

/** 独立会话产物，不覆盖旧快照，也不冒充Workspace文档或长期记录。 */
export async function writeDecisionReport(root: string, report: DecisionReport, signal: AbortSignal) {
  signal.throwIfAborted();
  const directory = await mkdtemp(path.join(root, 'decision-report-')).catch(() => {
    signal.throwIfAborted();
    throw new DecisionFailure('export_failed', 'Could not create a report directory in the current conversation. No report was published.');
  });
  try {
    await writeFile(path.join(directory, 'report.md'), report.markdown, { encoding: 'utf8', flag: 'wx', mode: 0o600, signal });
    signal.throwIfAborted();
  } catch (error: unknown) {
    // 只清理本次独占目录；失败/取消不能留下被当作完整报告的半份文件。
    await rm(directory, { recursive: true, force: true });
    if (signal.aborted) throw error;
    throw new DecisionFailure('export_failed', 'Could not save the report in the current conversation directory. No report was published.');
  }
  const locator = `conversation:/${path.basename(directory)}/report.md`;
  const markdownLink = `[程序报告原件](${locator})`;
  // 使用本次实际文件身份生成可直接交付的附注，避免作者再拼路径或版本。
  const deliveryNote = `记录 ${report.decisionId} · revision ${report.revision} · inputRevision ${report.inputRevision}\n原件：${markdownLink}`;
  return {
    kind: 'decision_report_export' as const,
    decisionId: report.decisionId, revision: report.revision, inputRevision: report.inputRevision,
    artifact: {
      locator, markdownLink,
      sha256: createHash('sha256').update(report.markdown, 'utf8').digest('hex'),
      bytes: Buffer.byteLength(report.markdown, 'utf8'),
    },
    deliveryNote,
    notice: '固定版本会话文件，不随条件变化更新，也未保存为Workspace文档。可用read_file读取并直接链接；hash校验该原件字节，不认证模型或建议。',
  };
}
