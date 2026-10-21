import type { CitationSource } from '../../../../citation';

/** 同次读取的文档事实；会话别名不进入并发基线。 */
export interface MarkdownFileWriteSnapshot {
  readonly currentText: string;
  readonly sourceKey: string;
  readonly sources: readonly CitationSource[];
  /** 包含基线和 pending 隐藏的占位，新增来源不能借走拒绝修订后会恢复的 ref。 */
  readonly reservedRefs: readonly string[];
}
