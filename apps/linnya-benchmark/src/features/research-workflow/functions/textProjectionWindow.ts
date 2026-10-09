/**
 * 只把当前编号窗口之外的正式 ToolOutputStore 包装视为旧消息的截断证据。
 * 文档可以讨论 blob、续读或截断；这些词出现在编号正文里不改变读取状态。
 */
export function textProjectionWindow(input: {
  readonly observation: string;
  readonly offset: number;
  readonly lineCount: number;
  readonly externallyTruncated: boolean;
  readonly sources: readonly WorkspaceDocumentCitationSource[];
}): { readonly lines: readonly string[]; readonly complete: boolean } {
  const lines: string[] = [];
  const ranges: ObservationDataRange[] = verifiedCitationDataRanges(
    input.observation,
    input.sources
  );
  let position = 0;
  let inside = false;
  let ended = false;
  for (const line of input.observation.split('\n')) {
    const match = /^\s*(\d+) \| (.*)$/.exec(line);
    if (!ended && match && Number(match[1]) === input.offset + lines.length) {
      inside = true;
      lines.push(match[2] ?? '');
      ranges.push([position, position + line.length]);
      if (lines.length === input.lineCount) ended = true;
    } else {
      if (inside) ended = true;
    }
    position += line.length + 1;
  }

  // 老的 UI 消息没有结构化截断事实；仅识别 producer 的完整标记，不扫描正文关键字。
  // 即使只截去一行中的部分字符、行数仍相等，也必须拒绝把预览当成全文。
  const hasLegacyPreview = hasLegacyObservationTruncation(input.observation, ranges);
  return {
    lines,
    complete: lines.length === input.lineCount && !input.externallyTruncated && !hasLegacyPreview,
  };
}
import type { WorkspaceDocumentCitationSource } from '@app/schemas';
import {
  hasLegacyObservationTruncation,
  verifiedCitationDataRanges,
  type ObservationDataRange,
} from './observationDataRanges';
